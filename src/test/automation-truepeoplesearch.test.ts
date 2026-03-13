import { describe, expect, it } from "vitest";

import { executeAutomation } from "@/lib/automation/runner";
import { createDefaultAutomationSiteRegistry, getAutomationSupportEntry } from "@/lib/automation/site-registry";
import {
  TRUE_PEOPLE_SEARCH_ENTRY_URL,
  truePeopleSearchConfirmationPhrases,
  truePeopleSearchSelectors,
} from "@/lib/automation/sites/truepeoplesearch";
import type { AutomationBrowser, AutomationPage } from "@/lib/automation/types";
import { MockBrowser, MockPage } from "@/test/support/automation-site-mocks";

class BlockedTruePeopleSearchPage implements AutomationPage {
  readonly operations: string[] = [];

  async goto(url: string) {
    this.operations.push(`goto:${url}`);
  }

  async fill(selector: string, value: string) {
    if (selector === truePeopleSearchSelectors.name) {
      const error = new Error("Timeout 10000ms exceeded");
      error.name = "TimeoutError";
      throw error;
    }

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
    return "<html><body><div id='px-captcha-modal'></div><script>window._pxAppId='PX1234';</script><script src='https://captcha.px-cloud.net/PX1234/captcha.js'></script></body></html>";
  }

  async innerText(selector: string) {
    return selector === "body"
      ? "TruePeopleSearch Name Search Phone Search Address Search Email Search"
      : null;
  }

  async screenshot() {
    return Buffer.from("tps-blocked-shot");
  }

  async close() {
    this.operations.push("close:page");
  }
}

class BlockedTruePeopleSearchBrowser implements AutomationBrowser {
  constructor(private readonly page: AutomationPage) {}

  async newPage() {
    return this.page;
  }

  async close() {
    return;
  }
}

function createHandoff() {
  return {
    handoffId: "handoff_truepeoplesearch_001",
    mode: "auto",
    requiresUserApproval: false,
    reviewReasons: [],
    createdAt: "2026-03-13T13:00:00.000Z",
    payload: {
      siteId: "TruePeopleSearch",
      candidateId: "cand_truepeoplesearch_001",
      procedureId: "proc_truepeoplesearch_v1",
      procedureVersion: "v1",
      submissionChannel: "webform",
      fields: {
        full_name: "Jane Doe",
        privacy_email: "shield@example.com",
        city_state: "Seattle, Washington",
        candidate_url: "https://www.truepeoplesearch.com/find/person/Jane-Doe/Seattle-WA",
      },
      steps: [{
        stepId: "placeholder",
        action: "manual_review",
        instruction: "This step list should be replaced by the adapter.",
      }],
      draft: {
        draftId: "draft_truepeoplesearch_001",
        siteId: "TruePeopleSearch",
        candidateId: "cand_truepeoplesearch_001",
        submissionChannel: "webform",
        body: "Please remove my information.",
        factsUsed: [{ field: "full_name", value: "Jane Doe" }],
        procedureId: "proc_truepeoplesearch_v1",
        generatedAt: "2026-03-13T13:00:00.000Z",
      },
    },
  };
}

describe("TruePeopleSearch automation site", () => {
  it("is registered in the default automation site registry", () => {
    const registry = createDefaultAutomationSiteRegistry();

    expect(registry.has("TruePeopleSearch")).toBe(true);
    expect(registry.get("TruePeopleSearch")?.id).toBe("truepeoplesearch-site-adapter");
    expect(getAutomationSupportEntry("TruePeopleSearch")?.status).toBe("partial");
  });

  it("uses site-specific entry URL, selectors, and confirmation detection", async () => {
    const confirmationText = "Check your inbox for an email confirmation to complete the removal request.";
    const page = new MockPage(confirmationText);

    const result = await executeAutomation(createHandoff(), {
      browser: new MockBrowser(page),
      now: () => new Date("2026-03-13T13:06:00.000Z"),
    });

    expect(page.operations).toEqual([
      `goto:${TRUE_PEOPLE_SEARCH_ENTRY_URL}`,
      `fill:${truePeopleSearchSelectors.name}=Jane Doe`,
      `fill:${truePeopleSearchSelectors.cityState}=Seattle, Washington`,
      `click:${truePeopleSearchSelectors.searchButton}`,
      `click:${truePeopleSearchSelectors.firstResultButton}`,
      `fill:${truePeopleSearchSelectors.email}=shield@example.com`,
      `click:${truePeopleSearchSelectors.submitButton}`,
      "close:page",
    ]);
    expect(result.executionResult.status).toBe("pending");
    expect(result.executionResult.confirmation_text?.toLowerCase()).toContain(truePeopleSearchConfirmationPhrases[1]);
    expect(result.evidence.executorId).toBe("truepeoplesearch-site-adapter");
  });

  it("classifies anti-bot challenge pages as blocked", async () => {
    const result = await executeAutomation(createHandoff(), {
      browser: new BlockedTruePeopleSearchBrowser(new BlockedTruePeopleSearchPage()),
      maxStepRetries: 1,
      now: () => new Date("2026-03-13T13:16:00.000Z"),
    });

    expect(result.executionResult).toMatchObject({
      site: "TruePeopleSearch",
      status: "manual_required",
      manual_review_required: true,
    });
    expect(result.executionResult.error_text?.toLowerCase()).toContain("blocked the automated browser session");
    expect(result.evidence.executorId).toBe("truepeoplesearch-site-adapter");
    expect(result.evidence.failureCode).toBe("rate_limited");
    expect(result.evidence.reviewReasons).toContain("rate_limited");
  });
});
