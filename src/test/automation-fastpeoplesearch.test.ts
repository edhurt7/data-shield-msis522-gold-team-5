import { describe, expect, it } from "vitest";

import { fastPeopleSearchListingPageText } from "@/lib/agent/fixtures/fastpeoplesearch";
import { executeAutomation } from "@/lib/automation/runner";
import { createDefaultAutomationSiteRegistry, getAutomationSupportEntry } from "@/lib/automation/site-registry";
import {
  FAST_PEOPLE_SEARCH_ENTRY_URL,
  fastPeopleSearchConfirmationPhrases,
  fastPeopleSearchSelectors,
} from "@/lib/automation/sites/fastpeoplesearch";
import type { AutomationBrowser, AutomationPage } from "@/lib/automation/types";

class MockPage implements AutomationPage {
  readonly operations: string[] = [];

  constructor(private readonly pageText: string) {}

  async goto(url: string) {
    this.operations.push(`goto:${url}`);
  }

  async fill(selector: string, value: string) {
    this.operations.push(`fill:${selector}=${value}`);
  }

  async selectOption(selector: string, value: string | string[]) {
    this.operations.push(`select:${selector}=${Array.isArray(value) ? value.join("|") : value}`);
  }

  async click(selector: string) {
    this.operations.push(`click:${selector}`);
  }

  async waitForTimeout(timeout: number) {
    this.operations.push(`wait:${timeout}`);
  }

  async content() {
    return `<html><body>${this.pageText}</body></html>`;
  }

  async innerText(selector: string) {
    return selector === "body" ? this.pageText : null;
  }

  async screenshot() {
    return Buffer.from("fps-shot");
  }

  async close() {
    this.operations.push("close:page");
  }
}

class MockBrowser implements AutomationBrowser {
  constructor(private readonly page: AutomationPage) {}

  async newPage() {
    return this.page;
  }

  async close() {
    return;
  }
}

function createHandoff(overrides: Record<string, unknown> = {}) {
  return {
    handoffId: "handoff_fps_001",
    mode: "auto",
    requiresUserApproval: false,
    reviewReasons: [],
    createdAt: "2026-03-13T13:00:00.000Z",
    payload: {
      siteId: "FastPeopleSearch",
      candidateId: "cand_001",
      procedureId: "proc_fps_v1",
      procedureVersion: "v1",
      submissionChannel: "webform",
      fields: {
        full_name: "Jane Doe",
        privacy_email: "shield@example.com",
        state: "Washington",
        candidate_url: "https://fastpeoplesearch.test/listing/jane-doe-seattle-wa",
      },
      steps: [
        {
          stepId: "placeholder",
          action: "manual_review",
          instruction: "This step list should be replaced by the adapter.",
        },
      ],
      draft: {
        draftId: "draft_fps_001",
        siteId: "FastPeopleSearch",
        candidateId: "cand_001",
        submissionChannel: "webform",
        body: "Please remove my information.",
        factsUsed: [{ field: "full_name", value: "Jane Doe" }],
        procedureId: "proc_fps_v1",
        generatedAt: "2026-03-13T13:00:00.000Z",
      },
    },
    ...overrides,
  };
}

describe("FastPeopleSearch automation site", () => {
  it("is registered in the default automation site registry", () => {
    const registry = createDefaultAutomationSiteRegistry();

    expect(registry.has("FastPeopleSearch")).toBe(true);
    expect(registry.get("FastPeopleSearch")?.id).toBe("fastpeoplesearch-site-adapter");
    expect(getAutomationSupportEntry("FastPeopleSearch")?.status).toBe("partial");
  });

  it("uses site-specific entry URL, selectors, and confirmation detection", async () => {
    const confirmationText = "Your removal request has been received and is pending review.";
    const page = new MockPage(confirmationText);

    const result = await executeAutomation(createHandoff(), {
      browser: new MockBrowser(page),
      now: () => new Date("2026-03-13T13:06:00.000Z"),
    });

    expect(page.operations).toEqual([
      `goto:${FAST_PEOPLE_SEARCH_ENTRY_URL}`,
      `fill:${fastPeopleSearchSelectors.email}=shield@example.com`,
      `fill:${fastPeopleSearchSelectors.name}=Jane Doe`,
      `select:${fastPeopleSearchSelectors.state}=Washington`,
      `click:${fastPeopleSearchSelectors.searchButton}`,
      `click:${fastPeopleSearchSelectors.firstResultCheckbox}`,
      `select:${fastPeopleSearchSelectors.removalReason}=This is my personal information`,
      `click:${fastPeopleSearchSelectors.submitButton}`,
      "close:page",
    ]);
    expect(result.executionResult).toMatchObject({
      site: "FastPeopleSearch",
      status: "pending",
      manual_review_required: false,
      candidate_url: "https://fastpeoplesearch.test/listing/jane-doe-seattle-wa",
      confirmation_text: confirmationText,
    });
    expect(result.executionResult.screenshot_ref).toContain("success-screenshot");
    expect(result.executionResult.confirmation_text?.toLowerCase()).toContain(fastPeopleSearchConfirmationPhrases[0]);
    expect(result.evidence.executorId).toBe("fastpeoplesearch-site-adapter");
    expect(result.evidence.failureCode).toBeNull();
    expect(result.evidence.reviewReasons).toEqual([]);
  });

  it("falls back to manual review when confirmation text is not detected", async () => {
    const result = await executeAutomation(createHandoff(), {
      browser: new MockBrowser(new MockPage(fastPeopleSearchListingPageText)),
      now: () => new Date("2026-03-13T13:06:00.000Z"),
    });

    expect(result.executionResult).toMatchObject({
      site: "FastPeopleSearch",
      status: "manual_required",
      manual_review_required: true,
    });
    expect(result.executionResult.error_text).toContain("confirmation page did not match expected text");
    expect(result.executionResult.confirmation_text).toBeNull();
    expect(result.executionResult.screenshot_ref).toContain("success-screenshot");
    expect(result.evidence.failureCode).toBe("manual_review_required");
    expect(result.evidence.reviewReasons).toContain("manual_submission_required");
    expect(result.evidence.stepOutcomes.at(-1)).toMatchObject({
      stepId: "fps_confirmation_review",
      status: "manual_review_required",
    });
  });

  it("converts CAPTCHA pages into manual review", async () => {
    const result = await executeAutomation(createHandoff(), {
      browser: new MockBrowser(new MockPage("Please complete the CAPTCHA to continue. Verify you are human.")),
      now: () => new Date("2026-03-13T13:06:00.000Z"),
    });

    expect(result.executionResult).toMatchObject({
      site: "FastPeopleSearch",
      status: "manual_required",
      manual_review_required: true,
    });
    expect(result.executionResult.error_text?.toLowerCase()).toContain("captcha");
    expect(result.executionResult.confirmation_text?.toLowerCase()).toContain("captcha");
    expect(result.evidence.failureCode).toBe("captcha");
    expect(result.evidence.reviewReasons).toContain("captcha");
  });

  it("detects blocked pages and fails closed with evidence", async () => {
    const result = await executeAutomation(createHandoff(), {
      browser: new MockBrowser(new MockPage("Access denied due to unusual traffic from your network.")),
      now: () => new Date("2026-03-13T13:06:00.000Z"),
    });

    expect(result.executionResult).toMatchObject({
      site: "FastPeopleSearch",
      status: "failed",
      manual_review_required: false,
    });
    expect(result.executionResult.error_text?.toLowerCase()).toContain("blocked");
    expect(result.executionResult.confirmation_text?.toLowerCase()).toContain("access denied");
    expect(result.executionResult.screenshot_ref).toBeTruthy();
    expect(result.evidence.failureCode).toBe("rate_limited");
    expect(result.evidence.reviewReasons).toContain("rate_limited");
  });

  it("rejects unsupported submission channels", async () => {
    const result = await executeAutomation(createHandoff({
      payload: {
        ...createHandoff().payload,
        submissionChannel: "email",
      },
    }), {
      browser: new MockBrowser(new MockPage("unused")),
      now: () => new Date("2026-03-13T13:06:00.000Z"),
    });

    expect(result.executionResult).toMatchObject({
      site: "FastPeopleSearch",
      status: "manual_required",
      manual_review_required: true,
    });
    expect(result.executionResult.error_text).toContain("supports only webform");
  });
});
