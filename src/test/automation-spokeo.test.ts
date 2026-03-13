import { describe, expect, it } from "vitest";

import { executeAutomation } from "@/lib/automation/runner";
import { createDefaultAutomationSiteRegistry, getAutomationSupportEntry } from "@/lib/automation/site-registry";
import {
  SPOKEO_ENTRY_URL,
  spokeoConfirmationPhrases,
  spokeoSelectors,
} from "@/lib/automation/sites/spokeo";
import type { AutomationBrowser, AutomationPage } from "@/lib/automation/types";
import { MockBrowser, MockPage } from "@/test/support/automation-site-mocks";

class FailingSpokeoPage implements AutomationPage {
  readonly operations: string[] = [];

  async goto(url: string) {
    this.operations.push(`goto:${url}`);
  }

  async fill(selector: string, value: string) {
    if (selector === spokeoSelectors.listingUrl) {
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
    return "<html><body>Just a moment... Attention required. Security check in progress.</body></html>";
  }

  async innerText(selector: string) {
    return selector === "body" ? "Just a moment... Attention required. Security check in progress." : null;
  }

  async screenshot() {
    return Buffer.from("spokeo-blocked-shot");
  }

  async close() {
    this.operations.push("close:page");
  }
}

class FailingSpokeoBrowser implements AutomationBrowser {
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
    handoffId: "handoff_spokeo_001",
    mode: "auto",
    requiresUserApproval: false,
    reviewReasons: [],
    createdAt: "2026-03-13T13:00:00.000Z",
    payload: {
      siteId: "Spokeo",
      candidateId: "cand_spokeo_001",
      procedureId: "proc_spokeo_v1",
      procedureVersion: "v1",
      submissionChannel: "webform",
      fields: {
        listing_url: "https://www.spokeo.com/Jane-Doe/Seattle-WA/p123456789",
        privacy_email: "shield@example.com",
        candidate_url: "https://www.spokeo.com/Jane-Doe/Seattle-WA/p123456789",
      },
      steps: [{
        stepId: "placeholder",
        action: "manual_review",
        instruction: "This step list should be replaced by the adapter.",
      }],
      draft: {
        draftId: "draft_spokeo_001",
        siteId: "Spokeo",
        candidateId: "cand_spokeo_001",
        submissionChannel: "webform",
        body: "Please remove my information.",
        factsUsed: [{ field: "full_name", value: "Jane Doe" }],
        procedureId: "proc_spokeo_v1",
        generatedAt: "2026-03-13T13:00:00.000Z",
      },
    },
  };
}

describe("Spokeo automation site", () => {
  it("is registered in the default automation site registry", () => {
    const registry = createDefaultAutomationSiteRegistry();

    expect(registry.has("Spokeo")).toBe(true);
    expect(registry.get("Spokeo")?.id).toBe("spokeo-site-adapter");
    expect(getAutomationSupportEntry("Spokeo")?.status).toBe("partial");
  });

  it("uses site-specific entry URL, selectors, and confirmation detection", async () => {
    const confirmationText = "Check your inbox for a confirmation email to complete your opt out.";
    const page = new MockPage(confirmationText);

    const result = await executeAutomation(createHandoff(), {
      browser: new MockBrowser(page),
      now: () => new Date("2026-03-13T13:06:00.000Z"),
    });

    expect(page.operations).toEqual([
      `goto:${SPOKEO_ENTRY_URL}`,
      `fill:${spokeoSelectors.listingUrl}=https://www.spokeo.com/Jane-Doe/Seattle-WA/p123456789`,
      `fill:${spokeoSelectors.email}=shield@example.com`,
      `click:${spokeoSelectors.searchButton}`,
      `click:${spokeoSelectors.submitButton}`,
      "close:page",
    ]);
    expect(result.executionResult.status).toBe("pending");
    expect(result.executionResult.confirmation_text?.toLowerCase()).toContain(spokeoConfirmationPhrases[0]);
    expect(result.evidence.executorId).toBe("spokeo-site-adapter");
  });

  it("preserves blocked generic failures instead of downgrading them to manual review", async () => {
    const result = await executeAutomation(createHandoff(), {
      browser: new FailingSpokeoBrowser(new FailingSpokeoPage()),
      maxStepRetries: 1,
      now: () => new Date("2026-03-13T13:16:00.000Z"),
    });

    expect(result.executionResult).toMatchObject({
      site: "Spokeo",
      status: "manual_required",
      manual_review_required: true,
    });
    expect(result.executionResult.error_text?.toLowerCase()).toContain("blocked the automated browser session");
    expect(result.evidence.executorId).toBe("spokeo-site-adapter");
    expect(result.evidence.failureCode).toBe("rate_limited");
    expect(result.evidence.reviewReasons).toContain("rate_limited");
  });
});
