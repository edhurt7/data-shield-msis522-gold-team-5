import { describe, expect, it } from "vitest";

import { executeAutomation } from "@/lib/automation/runner";
import { createDefaultAutomationSiteRegistry, getAutomationSupportEntry } from "@/lib/automation/site-registry";
import {
  WHITEPAGES_ENTRY_URL,
  whitePagesConfirmationPhrases,
  whitePagesSelectors,
} from "@/lib/automation/sites/whitepages";
import { MockBrowser, MockPage } from "@/test/support/automation-site-mocks";

function createHandoff() {
  return {
    handoffId: "handoff_whitepages_001",
    mode: "auto",
    requiresUserApproval: false,
    reviewReasons: [],
    createdAt: "2026-03-13T13:00:00.000Z",
    payload: {
      siteId: "WhitePages",
      candidateId: "cand_whitepages_001",
      procedureId: "proc_whitepages_v1",
      procedureVersion: "v1",
      submissionChannel: "webform",
      fields: {
        listing_url: "https://www.whitepages.com/name/Jane-Doe/Seattle-WA/123456789",
        privacy_email: "shield@example.com",
        candidate_url: "https://www.whitepages.com/name/Jane-Doe/Seattle-WA/123456789",
      },
      steps: [{
        stepId: "placeholder",
        action: "manual_review",
        instruction: "This step list should be replaced by the adapter.",
      }],
      draft: {
        draftId: "draft_whitepages_001",
        siteId: "WhitePages",
        candidateId: "cand_whitepages_001",
        submissionChannel: "webform",
        body: "Please remove my information.",
        factsUsed: [{ field: "full_name", value: "Jane Doe" }],
        procedureId: "proc_whitepages_v1",
        generatedAt: "2026-03-13T13:00:00.000Z",
      },
    },
  };
}

describe("WhitePages automation site", () => {
  it("is registered in the default automation site registry", () => {
    const registry = createDefaultAutomationSiteRegistry();

    expect(registry.has("WhitePages")).toBe(true);
    expect(registry.get("WhitePages")?.id).toBe("whitepages-site-adapter");
    expect(getAutomationSupportEntry("WhitePages")?.status).toBe("partial");
  });

  it("uses site-specific entry URL, selectors, and confirmation detection", async () => {
    const confirmationText = "Check your email for a verification email to complete your suppression request.";
    const page = new MockPage(confirmationText);

    const result = await executeAutomation(createHandoff(), {
      browser: new MockBrowser(page),
      now: () => new Date("2026-03-13T13:06:00.000Z"),
    });

    expect(page.operations).toEqual([
      `goto:${WHITEPAGES_ENTRY_URL}`,
      `fill:${whitePagesSelectors.listingUrl}=https://www.whitepages.com/name/Jane-Doe/Seattle-WA/123456789`,
      `fill:${whitePagesSelectors.email}=shield@example.com`,
      `click:${whitePagesSelectors.consentCheckbox}`,
      `click:${whitePagesSelectors.submitButton}`,
      "close:page",
    ]);
    expect(result.executionResult.status).toBe("pending");
    expect(result.executionResult.confirmation_text?.toLowerCase()).toContain(whitePagesConfirmationPhrases[0]);
    expect(result.evidence.executorId).toBe("whitepages-site-adapter");
  });
});
