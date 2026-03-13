import { describe, expect, it } from "vitest";

import { executeAutomation } from "@/lib/automation/runner";
import type { AutomationBrowser, AutomationPage } from "@/lib/automation/types";

class MockPage implements AutomationPage {
  readonly operations: string[] = [];
  readonly failures = new Map<string, number>();

  constructor(private readonly options: { html?: string; text?: string; screenshot?: string } = {}) {}

  fail(action: string, times: number) {
    this.failures.set(action, times);
  }

  private maybeFail(action: string) {
    const remaining = this.failures.get(action) ?? 0;
    if (remaining > 0) {
      this.failures.set(action, remaining - 1);
      throw new Error(`${action} failed`);
    }
  }

  async goto(url: string) {
    this.maybeFail("goto");
    this.operations.push(`goto:${url}`);
  }

  async fill(selector: string, value: string) {
    this.maybeFail(`fill:${selector}`);
    this.operations.push(`fill:${selector}=${value}`);
  }

  async selectOption(selector: string, value: string | string[]) {
    this.maybeFail(`select:${selector}`);
    this.operations.push(`select:${selector}=${Array.isArray(value) ? value.join("|") : value}`);
  }

  async click(selector: string) {
    this.maybeFail(`click:${selector}`);
    this.operations.push(`click:${selector}`);
  }

  async waitForTimeout(timeout: number) {
    this.maybeFail("wait");
    this.operations.push(`wait:${timeout}`);
  }

  async content() {
    return this.options.html ?? "<html><body>Complete</body></html>";
  }

  async innerText(selector: string) {
    if (selector !== "body") {
      return null;
    }

    return this.options.text ?? "Complete";
  }

  async screenshot() {
    return Buffer.from(this.options.screenshot ?? "mock-screenshot");
  }

  async close() {
    this.operations.push("close:page");
  }
}

class MockBrowser implements AutomationBrowser {
  closed = false;

  constructor(readonly page: MockPage) {}

  async newPage() {
    return this.page;
  }

  async close() {
    this.closed = true;
  }
}

function createHandoff(overrides: Record<string, unknown> = {}) {
  return {
    handoffId: "handoff_001",
    mode: "auto",
    requiresUserApproval: false,
    reviewReasons: [],
    createdAt: "2026-03-13T12:00:00.000Z",
    payload: {
      siteId: "GenericBroker",
      candidateId: "cand_001",
      procedureId: "proc_001",
      procedureVersion: "v1",
      submissionChannel: "webform",
      fields: {
        candidate_url: "https://example.test/listing/jane-doe",
        full_name: "Jane Doe",
        state: "Washington",
        wait_ms: 250,
      },
      steps: [
        {
          stepId: "step_1",
          action: "navigate",
          instruction: "Open the opt-out page.",
          targetUrl: "https://example.test/opt-out",
        },
        {
          stepId: "step_2",
          action: "fill",
          instruction: "Fill the full name field.",
          selector: "#full_name",
          inputKey: "full_name",
        },
        {
          stepId: "step_3",
          action: "select",
          instruction: "Select the state.",
          selector: "#state",
          inputKey: "state",
        },
        {
          stepId: "step_4",
          action: "wait",
          instruction: "Wait for dynamic validation.",
          inputKey: "wait_ms",
        },
        {
          stepId: "step_5",
          action: "click",
          instruction: "Submit the form.",
          selector: "#submit",
        },
      ],
      draft: {
        draftId: "draft_001",
        siteId: "GenericBroker",
        candidateId: "cand_001",
        submissionChannel: "webform",
        body: "Please remove my information.",
        factsUsed: [{ field: "full_name", value: "Jane Doe" }],
        procedureId: "proc_001",
        generatedAt: "2026-03-13T12:00:00.000Z",
      },
    },
    ...overrides,
  };
}

describe("automation runner", () => {
  it("short-circuits non-auto handoffs into manual review", async () => {
    const result = await executeAutomation(createHandoff({
      mode: "human_assisted",
      reviewReasons: ["manual_submission_required"],
    }));

    expect(result.executionResult).toMatchObject({
      site: "GenericBroker",
      status: "manual_required",
      manual_review_required: true,
    });
    expect(result.evidence.executorId).toBe("automation-runner");
    expect(result.evidence.failureCode).toBe("manual_review_required");
    expect(result.evidence.reviewReasons).toContain("manual_submission_required");
    expect(result.evidence.artifacts[0]?.content).toContain("handoff mode is human_assisted");
  });

  it("executes generic navigate/fill/select/wait/click steps", async () => {
    const page = new MockPage({
      html: "<html><body>Request submitted</body></html>",
      text: "Request submitted",
    });
    const browser = new MockBrowser(page);

    const result = await executeAutomation(createHandoff(), {
      browser,
      now: () => new Date("2026-03-13T12:30:00.000Z"),
    });

    expect(result.executionResult).toMatchObject({
      site: "GenericBroker",
      candidate_url: "https://example.test/listing/jane-doe",
      status: "submitted",
      manual_review_required: false,
      confirmation_text: "Request submitted",
    });
    expect(result.executionResult.screenshot_ref).toContain("success-screenshot");
    expect(page.operations).toEqual([
      "goto:https://example.test/opt-out",
      "fill:#full_name=Jane Doe",
      "select:#state=Washington",
      "wait:250",
      "click:#submit",
      "close:page",
    ]);
    expect(result.evidence.executorId).toBe("generic-playwright-runner");
    expect(result.evidence.stepOutcomes).toHaveLength(5);
    expect(result.evidence.artifacts.some((artifact) => artifact.kind === "execution_log")).toBe(true);
    expect(result.evidence.artifacts.some((artifact) => artifact.kind === "page_text")).toBe(true);
    expect(result.evidence.artifacts.some((artifact) => artifact.kind === "screenshot")).toBe(true);
    expect(browser.closed).toBe(false);
  });

  it("retries a failing step before succeeding", async () => {
    const page = new MockPage();
    page.fail("click:#submit", 1);

    const result = await executeAutomation(createHandoff(), {
      browser: new MockBrowser(page),
      maxStepRetries: 1,
      now: () => new Date("2026-03-13T12:45:00.000Z"),
    });

    expect(result.executionResult.status).toBe("submitted");
    expect(page.operations.filter((entry) => entry === "click:#submit")).toHaveLength(1);

    const stepLogArtifact = result.evidence.artifacts.find((artifact) => artifact.kind === "execution_log");
    expect(stepLogArtifact?.content).toContain("\"attempt\": 1");
    expect(stepLogArtifact?.content).toContain("\"attempt\": 2");
  });

  it("captures screenshot/html/text artifacts when a step exhausts retries", async () => {
    const page = new MockPage({
      html: "<html><body>Broken form</body></html>",
      text: "Broken form",
      screenshot: "failure-shot",
    });
    page.fail("click:#submit", 2);

    const result = await executeAutomation(createHandoff(), {
      browser: new MockBrowser(page),
      maxStepRetries: 1,
      now: () => new Date("2026-03-13T13:00:00.000Z"),
    });

    expect(result.executionResult).toMatchObject({
      status: "failed",
      manual_review_required: false,
      confirmation_text: "Broken form",
    });
    expect(result.executionResult.screenshot_ref).toContain("step-5-failure-screenshot");
    expect(result.evidence.failureCode).toBeNull();
    expect(result.evidence.stepOutcomes.at(-1)).toMatchObject({
      stepId: "step_5",
      status: "failed",
    });
    expect(result.evidence.artifacts.some((artifact) => artifact.kind === "screenshot")).toBe(true);
    expect(result.evidence.artifacts.some((artifact) => artifact.kind === "html_snapshot")).toBe(true);
    expect(result.evidence.artifacts.some((artifact) => artifact.kind === "page_text")).toBe(true);
  });

  it("converts missing selectors into manual review with evidence", async () => {
    const result = await executeAutomation(createHandoff({
      payload: {
        ...createHandoff().payload,
        steps: [
          {
            stepId: "step_1",
            action: "fill",
            instruction: "Fill without a selector.",
            inputKey: "full_name",
          },
        ],
      },
    }), {
      browser: new MockBrowser(new MockPage({ text: "Missing selector page" })),
      now: () => new Date("2026-03-13T13:10:00.000Z"),
    });

    expect(result.executionResult).toMatchObject({
      status: "manual_required",
      manual_review_required: true,
    });
    expect(result.executionResult.error_text).toContain("missing a selector");
    expect(result.executionResult.confirmation_text).toBe("Missing selector page");
    expect(result.evidence.failureCode).toBe("selector_missing");
    expect(result.evidence.reviewReasons).toContain("manual_submission_required");
    expect(result.evidence.artifacts.some((artifact) => artifact.kind === "screenshot")).toBe(true);
  });

  it("fails closed on timeouts and preserves failure evidence", async () => {
    const page = new MockPage({
      html: "<html><body>Timeout page</body></html>",
      text: "Timeout page",
    });
    page.fail("click:#submit", 2);
    page.failures.set("click:#submit", 0);
    page.click = async (selector: string) => {
      page.operations.push(`click:${selector}`);
      const error = new Error("Timeout 10000ms exceeded");
      error.name = "TimeoutError";
      throw error;
    };

    const result = await executeAutomation(createHandoff(), {
      browser: new MockBrowser(page),
      maxStepRetries: 0,
      now: () => new Date("2026-03-13T13:20:00.000Z"),
    });

    expect(result.executionResult).toMatchObject({
      status: "failed",
      manual_review_required: false,
      confirmation_text: "Timeout page",
    });
    expect(result.executionResult.error_text).toContain("Timeout");
    expect(result.evidence.failureCode).toBe("timeout");
    expect(result.evidence.artifacts.some((artifact) => artifact.kind === "screenshot")).toBe(true);
  });

  it("classifies anti-bot interstitial timeouts as rate_limited", async () => {
    const page = new MockPage({
      html: "<html><body>Just a moment... Attention required. Security check in progress.</body></html>",
      text: "Just a moment... Attention required. Security check in progress.",
    });
    page.click = async (selector: string) => {
      page.operations.push(`click:${selector}`);
      const error = new Error("Timeout 10000ms exceeded");
      error.name = "TimeoutError";
      throw error;
    };

    const result = await executeAutomation(createHandoff(), {
      browser: new MockBrowser(page),
      maxStepRetries: 0,
      now: () => new Date("2026-03-13T13:25:00.000Z"),
    });

    expect(result.executionResult).toMatchObject({
      status: "manual_required",
      manual_review_required: true,
    });
    expect(result.executionResult.error_text?.toLowerCase()).toContain("blocked the automated browser session");
    expect(result.evidence.failureCode).toBe("rate_limited");
    expect(result.evidence.reviewReasons).toContain("rate_limited");
  });

  it("classifies PerimeterX challenge pages as rate_limited instead of captcha", async () => {
    const page = new MockPage({
      html: "<html><body><div id='px-captcha-modal'></div><script>window._pxAppId='PX1234';</script><script src='https://captcha.px-cloud.net/PX1234/captcha.js'></script></body></html>",
      text: "TruePeopleSearch Name Search Phone Search Address Search Email Search",
    });
    page.fill = async (_selector: string, _value: string) => {
      const error = new Error("Timeout 10000ms exceeded");
      error.name = "TimeoutError";
      throw error;
    };

    const result = await executeAutomation(createHandoff(), {
      browser: new MockBrowser(page),
      maxStepRetries: 0,
      now: () => new Date("2026-03-13T13:27:00.000Z"),
    });

    expect(result.executionResult.error_text?.toLowerCase()).toContain("blocked the automated browser session");
    expect(result.evidence.failureCode).toBe("rate_limited");
    expect(result.evidence.reviewReasons).toContain("rate_limited");
  });

  it("classifies layout drift as site_changed", async () => {
    const page = new MockPage({
      html: "<html><body>Layout changed</body></html>",
      text: "Layout changed",
    });
    page.click = async (selector: string) => {
      page.operations.push(`click:${selector}`);
      throw new Error("Detached element after layout change");
    };

    const result = await executeAutomation(createHandoff(), {
      browser: new MockBrowser(page),
      maxStepRetries: 0,
      now: () => new Date("2026-03-13T13:30:00.000Z"),
    });

    expect(result.executionResult).toMatchObject({
      status: "manual_required",
      manual_review_required: true,
    });
    expect(result.evidence.failureCode).toBe("site_changed");
    expect(result.evidence.reviewReasons).toContain("manual_submission_required");
  });
});
