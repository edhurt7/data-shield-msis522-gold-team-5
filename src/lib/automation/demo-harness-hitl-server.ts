import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

import {
  buildDemoHarnessDashboardSnapshot,
  demoHarnessSiteIds,
  runDemoHarness,
  runDemoSiteHarness,
  summarizeDemoHarnessRun,
  type DemoHarnessCaptchaSessionSnapshot,
  type DemoHarnessRun,
  type DemoHarnessSiteId,
} from "@/lib/automation/demo-harness";
import { classifyCaptchaReviewOutcome } from "@/lib/automation/captcha-review";
import {
  createAutomationArtifact,
  createContractExecutionResult,
  createExecutionRecord,
  createStepOutcome,
} from "@/lib/automation/artifacts";
import type { ActionHandoff } from "@/lib/agent/contracts";
import type { AutomationBrowser, AutomationExecutionRecord, AutomationPage } from "@/lib/automation/types";

const PORT = Number.parseInt(process.env.AGENT_DEMO_SERVER_PORT ?? "8787", 10);
const fastPeopleSearchLatestResultPath = resolve(process.cwd(), "artifacts", "milestones", "fastpeoplesearch-latest.json");
const batchLatestResultPath = resolve(process.cwd(), "artifacts", "milestones", "demo-harness-latest.json");
const captchaSessions = new Map<string, PendingCaptchaSession>();

interface CapturedBrowserState {
  html: string;
  pageText: string;
  screenshotBase64: string;
}

interface PendingCaptchaSession {
  sessionId: string;
  runId: string;
  siteId: DemoHarnessSiteId;
  siteName: string;
  createdAt: string;
  updatedAt: string;
  instruction: string;
  browserHint: string;
  handoff: ActionHandoff;
  browserSession: InteractiveBrowserSession;
  record: AutomationExecutionRecord;
  snapshot: DemoHarnessCaptchaSessionSnapshot;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];

    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => {
      resolveBody(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

function toErrorDetails(error) {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  const details = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };

  if ("promptName" in error) {
    details.promptName = error.promptName;
  }
  if ("issues" in error) {
    details.issues = error.issues;
  }
  if ("rawOutput" in error) {
    details.rawOutput = error.rawOutput;
  }
  if ("cause" in error && error.cause !== undefined) {
    details.cause = toErrorDetails(error.cause);
  }

  return details;
}

function normalizeSiteIds(value: unknown): DemoHarnessSiteId[] {
  if (!Array.isArray(value) || value.length === 0) {
    return demoHarnessSiteIds;
  }

  return value.filter((siteId): siteId is DemoHarnessSiteId =>
    typeof siteId === "string" && demoHarnessSiteIds.includes(siteId as DemoHarnessSiteId),
  );
}

function buildSingleSitePayload(startedAt: string, completedAt: string, result: Awaited<ReturnType<typeof runDemoSiteHarness>>) {
  return {
    startedAt,
    completedAt,
    summary: result.summary,
    output: {
      handoff: result.handoff,
      automation_record: result.automationRecord,
    },
    dashboard: {
      runId: result.summary.runId,
      brokerSites: [
        {
          id: result.siteId,
          name: result.siteName,
          url: `${result.siteId}.com`,
          status: result.summary.automationStatus === "pending" || result.summary.automationStatus === "submitted"
            ? "found"
            : "failed",
          foundData: {
            fields: Object.keys(result.handoff.payload.fields).filter((field) => field !== "candidate_url"),
            optOutMessage: result.automationRecord.executionResult.confirmation_text ?? undefined,
            failureReason: result.summary.automationStatus === "failed"
              ? result.automationRecord.executionResult.error_text ?? "Scan completed with a failure or manual follow-up required."
              : undefined,
          },
        },
      ],
      history: [{
        id: result.summary.runId,
        date: completedAt.slice(0, 10),
        site: result.siteName,
        action: `Demo run completed with ${result.summary.automationStatus ?? "unknown"} status via ${result.summary.browserMode}.`,
        status: result.summary.automationStatus === "pending" || result.summary.automationStatus === "submitted"
          ? "confirmed"
          : "pending",
      }],
      chatMessages: [{
        id: `demo_${result.summary.runId}`,
        role: "assistant",
        content: `${result.siteName} finished with ${result.summary.automationStatus}. Next action: ${result.summary.interpretResult?.next_action ?? "n/a"}.`,
        timestamp: completedAt,
      }],
    },
  };
}

class InteractiveAutomationPage implements AutomationPage {
  constructor(private readonly page: Page) {}

  async goto(url: string, options?: { timeout?: number }) {
    await this.page.goto(url, options);
  }

  async fill(selector: string, value: string, options?: { timeout?: number }) {
    await this.page.fill(selector, value, options);
  }

  async selectOption(selector: string, value: string | string[], options?: { timeout?: number }) {
    await this.page.selectOption(selector, value, options);
  }

  async click(selector: string, options?: { timeout?: number }) {
    await this.page.click(selector, options);
  }

  async waitForTimeout(timeout: number) {
    await this.page.waitForTimeout(timeout);
  }

  async content() {
    return this.page.content();
  }

  async innerText(selector: string) {
    return this.page.locator(selector).first().innerText();
  }

  async screenshot(options?: { type?: "png" }) {
    return Buffer.from(await this.page.screenshot(options));
  }

  async close() {
    return;
  }
}

class InteractiveBrowserSession implements AutomationBrowser {
  private constructor(
    private readonly browser: Browser,
    private readonly page: Page,
  ) {}

  static async create() {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    await page.bringToFront();
    return new InteractiveBrowserSession(browser, page);
  }

  async newPage() {
    return new InteractiveAutomationPage(this.page);
  }

  async captureState(): Promise<CapturedBrowserState> {
    const [html, pageText, screenshot] = await Promise.all([
      this.page.content(),
      this.page.locator("body").first().innerText().catch(() => ""),
      this.page.screenshot({ type: "png" }),
    ]);

    return {
      html,
      pageText,
      screenshotBase64: Buffer.from(screenshot).toString("base64"),
    };
  }

  async close() {
    if (!this.page.isClosed()) {
      await this.page.close();
    }
    await this.browser.close();
  }
}

function createCaptchaInstruction(siteName: string) {
  return `A live browser window is paused on ${siteName}. Solve the CAPTCHA there, then return here and click Resume.`;
}

function createCaptchaSnapshot(input: {
  sessionId: string;
  runId: string;
  siteId: DemoHarnessSiteId;
  siteName: string;
  createdAt: string;
  updatedAt: string;
  captured: CapturedBrowserState;
}): DemoHarnessCaptchaSessionSnapshot {
  return {
    sessionId: input.sessionId,
    runId: input.runId,
    siteId: input.siteId,
    siteName: input.siteName,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    instruction: createCaptchaInstruction(input.siteName),
    browserHint: "Complete the CAPTCHA in the Playwright browser window opened on your desktop.",
    screenshotBase64: input.captured.screenshotBase64,
    pageText: input.captured.pageText,
  };
}

function listCaptchaSessionSnapshots(runId?: string) {
  return [...captchaSessions.values()]
    .filter((session) => !runId || session.runId === runId)
    .map((session) => session.snapshot);
}

async function disposeCaptchaSession(sessionId: string) {
  const session = captchaSessions.get(sessionId);
  if (!session) return;

  captchaSessions.delete(sessionId);
  await session.browserSession.close().catch(() => undefined);
}

async function disposeAllCaptchaSessions() {
  await Promise.all([...captchaSessions.keys()].map((sessionId) => disposeCaptchaSession(sessionId)));
}

async function readLatestBatchPayload() {
  const raw = await readFile(batchLatestResultPath, "utf8");
  return JSON.parse(raw);
}

async function persistBatchPayload(payload) {
  await mkdir(resolve(process.cwd(), "artifacts", "milestones"), { recursive: true });
  await writeFile(batchLatestResultPath, JSON.stringify(payload, null, 2));
}

function buildCaptchaResumeRecord(input: {
  session: PendingCaptchaSession;
  captured: CapturedBrowserState;
  completedAt: string;
}) {
  const { session, captured, completedAt } = input;
  const outcome = classifyCaptchaReviewOutcome(session.siteId, captured.pageText);
  const artifactSuffix = `captcha-resume-${Date.parse(completedAt)}`;
  const screenshotArtifact = createAutomationArtifact({
    handoff: session.handoff,
    kind: "screenshot",
    suffix: `${artifactSuffix}-screenshot`,
    createdAt: completedAt,
    label: "CAPTCHA resume screenshot",
    contentType: "image/png",
    content: captured.screenshotBase64,
  });
  const htmlArtifact = createAutomationArtifact({
    handoff: session.handoff,
    kind: "html_snapshot",
    suffix: `${artifactSuffix}-html`,
    createdAt: completedAt,
    label: "CAPTCHA resume HTML snapshot",
    contentType: "text/html",
    content: captured.html,
  });
  const textArtifact = createAutomationArtifact({
    handoff: session.handoff,
    kind: "page_text",
    suffix: `${artifactSuffix}-text`,
    createdAt: completedAt,
    label: "CAPTCHA resume page text",
    contentType: "text/plain",
    content: captured.pageText,
  });
  const logArtifact = createAutomationArtifact({
    handoff: session.handoff,
    kind: "execution_log",
    suffix: `${artifactSuffix}-log`,
    createdAt: completedAt,
    label: "CAPTCHA resume review log",
    contentType: "text/plain",
    content: outcome.status === "pending"
      ? "Human review cleared the CAPTCHA and the confirmation page now matches the expected success pattern."
      : outcome.failureCode === "captcha"
        ? "CAPTCHA is still visible after the requested human review."
        : outcome.errorText ?? "Manual review is still required after the CAPTCHA step.",
  });
  const executionResult = createContractExecutionResult({
    handoff: session.handoff,
    status: outcome.status,
    manualReviewRequired: outcome.manualReviewRequired,
    confirmationText: outcome.confirmationText,
    errorText: outcome.errorText,
    screenshotRef: screenshotArtifact.ref,
  });
  const stepOutcome = createStepOutcome({
    step: {
      stepId: "captcha_resume_review",
      action: "manual_review",
      instruction: "Pause for a human to solve the CAPTCHA and review the resulting page.",
    },
    startedAt: session.updatedAt,
    completedAt,
    status: outcome.status === "pending" ? "completed" : "manual_review_required",
    artifactIds: [logArtifact.artifactId, textArtifact.artifactId, htmlArtifact.artifactId, screenshotArtifact.artifactId],
    notes: logArtifact.content,
  });

  return createExecutionRecord({
    handoff: session.handoff,
    executorId: `${session.record.evidence.executorId}:captcha-resume`,
    startedAt: session.record.evidence.startedAt,
    completedAt,
    executionResult,
    failureCode: outcome.failureCode,
    reviewReasons: outcome.reviewReasons,
    artifacts: [...session.record.evidence.artifacts, logArtifact, textArtifact, htmlArtifact, screenshotArtifact],
    stepOutcomes: [...session.record.evidence.stepOutcomes, stepOutcome],
  });
}

function updatePayloadRun(payload, siteId: DemoHarnessSiteId, nextRecord: AutomationExecutionRecord, completedAt: string) {
  const runs: DemoHarnessRun[] = payload.runs.map((run: DemoHarnessRun) => (
    run.siteId === siteId
      ? {
        ...run,
        automationRecord: nextRecord,
        summary: summarizeDemoHarnessRun(run.siteId, run.summary.runId, run.summary.browserMode, run.handoff, nextRecord),
      }
      : run
  ));

  return {
    ...payload,
    completedAt,
    runs,
    dashboard: buildDemoHarnessDashboardSnapshot(runs, completedAt, payload.summary.runId),
    captchaSessions: listCaptchaSessionSnapshots(payload.summary.runId),
  };
}

const server = createServer(async (request, response) => {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);

  if (method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    response.end();
    return;
  }

  if (method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok", port: PORT });
    return;
  }

  if (method === "GET" && url.pathname === "/demo/run-fastpeoplesearch/latest") {
    try {
      const raw = await readFile(fastPeopleSearchLatestResultPath, "utf8");
      sendJson(response, 200, JSON.parse(raw));
    } catch {
      sendJson(response, 404, {
        status: "missing",
        message: "No FastPeopleSearch demo run has been recorded yet.",
      });
    }
    return;
  }

  if (method === "POST" && url.pathname === "/demo/run-fastpeoplesearch") {
    try {
      const rawBody = await readRequestBody(request);
      const parsedBody = rawBody.trim().length > 0 ? JSON.parse(rawBody) : {};
      const browserMode = parsedBody.browserMode === "live_browser" ? "live_browser" : "fixture_confirmation";
      const startedAt = new Date().toISOString();
      const result = await runDemoSiteHarness({
        siteId: "fastpeoplesearch",
        browserMode,
      });
      const completedAt = new Date().toISOString();
      const payload = buildSingleSitePayload(startedAt, completedAt, result);

      await mkdir(resolve(process.cwd(), "artifacts", "milestones"), { recursive: true });
      await writeFile(fastPeopleSearchLatestResultPath, JSON.stringify(payload, null, 2));

      sendJson(response, 200, payload);
    } catch (error) {
      sendJson(response, 500, {
        status: "error",
        error: toErrorDetails(error),
      });
    }
    return;
  }

  if (method === "GET" && url.pathname === "/demo/runs/latest") {
    try {
      const payload = await readLatestBatchPayload();
      payload.captchaSessions = listCaptchaSessionSnapshots(payload.summary?.runId);
      sendJson(response, 200, payload);
    } catch {
      sendJson(response, 404, {
        status: "missing",
        message: "No multi-site demo harness run has been recorded yet.",
      });
    }
    return;
  }

  if (method === "POST" && url.pathname === "/demo/runs") {
    try {
      const rawBody = await readRequestBody(request);
      const parsedBody = rawBody.trim().length > 0 ? JSON.parse(rawBody) : {};
      const browserMode = parsedBody.browserMode === "live_browser" ? "live_browser" : "fixture_confirmation";
      const siteIds = normalizeSiteIds(parsedBody.siteIds);
      await disposeAllCaptchaSessions();
      const liveBrowsers = new Map<DemoHarnessSiteId, InteractiveBrowserSession>();
      const payload = await runDemoHarness({
        browserMode,
        siteIds,
        resolveBrowser: async (siteId, requestedMode) => {
          if (requestedMode !== "live_browser" || siteId === "radaris") {
            return undefined;
          }

          const browser = await InteractiveBrowserSession.create();
          liveBrowsers.set(siteId, browser);
          return browser;
        },
      });
      const captchaSnapshots: DemoHarnessCaptchaSessionSnapshot[] = [];

      for (const run of payload.runs) {
        const browserSession = liveBrowsers.get(run.siteId);
        if (!browserSession) continue;

        if (run.automationRecord.evidence.failureCode === "captcha") {
          const createdAt = new Date().toISOString();
          const sessionId = `${payload.summary.runId}_${run.siteId}_captcha`;
          const captured = await browserSession.captureState();
          const snapshot = createCaptchaSnapshot({
            sessionId,
            runId: payload.summary.runId,
            siteId: run.siteId,
            siteName: run.siteName,
            createdAt,
            updatedAt: createdAt,
            captured,
          });

          captchaSessions.set(sessionId, {
            sessionId,
            runId: payload.summary.runId,
            siteId: run.siteId,
            siteName: run.siteName,
            createdAt,
            updatedAt: createdAt,
            instruction: snapshot.instruction,
            browserHint: snapshot.browserHint,
            handoff: run.handoff,
            browserSession,
            record: run.automationRecord,
            snapshot,
          });
          captchaSnapshots.push(snapshot);
          continue;
        }

        await browserSession.close();
      }

      payload.captchaSessions = captchaSnapshots;
      await persistBatchPayload(payload);

      sendJson(response, 200, payload);
    } catch (error) {
      sendJson(response, 500, {
        status: "error",
        error: toErrorDetails(error),
      });
    }
    return;
  }

  if (method === "POST" && /^\/demo\/captcha-sessions\/[^/]+\/resume$/.test(url.pathname)) {
    const sessionId = url.pathname.split("/")[3] ?? "";

    try {
      const session = captchaSessions.get(sessionId);
      if (!session) {
        sendJson(response, 404, {
          status: "missing",
          message: "No paused CAPTCHA session was found for this id.",
        });
        return;
      }

      const captured = await session.browserSession.captureState();
      const completedAt = new Date().toISOString();
      const nextRecord = buildCaptchaResumeRecord({
        session,
        captured,
        completedAt,
      });

      session.updatedAt = completedAt;
      session.record = nextRecord;
      session.snapshot = createCaptchaSnapshot({
        sessionId: session.sessionId,
        runId: session.runId,
        siteId: session.siteId,
        siteName: session.siteName,
        createdAt: session.createdAt,
        updatedAt: completedAt,
        captured,
      });

      const payload = updatePayloadRun(await readLatestBatchPayload(), session.siteId, nextRecord, completedAt);

      if (nextRecord.evidence.failureCode !== "captcha") {
        await disposeCaptchaSession(sessionId);
        payload.captchaSessions = listCaptchaSessionSnapshots(payload.summary.runId);
      } else {
        captchaSessions.set(sessionId, session);
      }

      await persistBatchPayload(payload);
      sendJson(response, 200, payload);
    } catch (error) {
      sendJson(response, 500, {
        status: "error",
        error: toErrorDetails(error),
      });
    }
    return;
  }

  sendJson(response, 404, {
    status: "not_found",
    path: url.pathname,
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`demo server listening on http://127.0.0.1:${PORT}`);
});
