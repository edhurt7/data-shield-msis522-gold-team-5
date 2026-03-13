import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  demoHarnessSiteIds,
  runDemoHarness,
  runDemoSiteHarness,
  type DemoHarnessSiteId,
} from "@/lib/automation/demo-harness";

const PORT = Number.parseInt(process.env.AGENT_DEMO_SERVER_PORT ?? "8787", 10);
const fastPeopleSearchLatestResultPath = resolve(process.cwd(), "artifacts", "milestones", "fastpeoplesearch-latest.json");
const batchLatestResultPath = resolve(process.cwd(), "artifacts", "milestones", "demo-harness-latest.json");

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
      const raw = await readFile(batchLatestResultPath, "utf8");
      sendJson(response, 200, JSON.parse(raw));
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
      const payload = await runDemoHarness({
        browserMode,
        siteIds,
      });

      await mkdir(resolve(process.cwd(), "artifacts", "milestones"), { recursive: true });
      await writeFile(batchLatestResultPath, JSON.stringify(payload, null, 2));

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
