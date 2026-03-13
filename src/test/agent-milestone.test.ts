import { describe, expect, it } from "vitest";

import { createFixtureLlmAdapter } from "@/lib/agent";
import { runFastPeopleSearchMilestone } from "@/lib/agent/milestone";

const fixtureAdapter = createFixtureLlmAdapter({
  listing_classifier_extractor: {
    site: "FastPeopleSearch",
    scan_timestamp: "2026-03-13T12:00:00.000Z",
    found: true,
    candidates: [
      {
        url: "https://fastpeoplesearch.test/listing/jane-doe-seattle-wa",
        extracted: {
          name: "Jane Doe",
          age: "35",
          addresses: ["123 Pine St, Seattle, WA"],
          relatives: ["John Doe"],
          phones: ["206-555-0114"],
        },
        match_confidence: 0.95,
        evidence_snippets: ["Jane Doe, Seattle, WA"],
      },
    ],
    notes: null,
  },
  procedure_selector: {
    site: "FastPeopleSearch",
    procedure_type: "webform",
    required_fields: ["full_name", "privacy_email"],
    steps: ["Open the removal page.", "Submit the form."],
    source_chunks: [
      {
        doc_id: "fps-proc-1",
        quote: "Use the FastPeopleSearch removal webform to request record suppression.",
      },
    ],
  },
  draft_generator: {
    site: "FastPeopleSearch",
    candidate_url: "https://fastpeoplesearch.test/listing/jane-doe-seattle-wa",
    submission_channel: "webform",
    procedure_type: "webform",
    required_fields: [
      { name: "full_name", value: "Jane Doe", required: true },
      { name: "privacy_email", value: "shield-abc123@detraceme.io", required: true },
    ],
    optional_fields: [],
    manual_review_required: false,
    review_reasons: [],
    webform: {
      fields: [
        { name: "full_name", value: "Jane Doe" },
        { name: "privacy_email", value: "shield-abc123@detraceme.io" },
      ],
      consent_checkboxes: [
        {
          label: "I confirm this is my information",
          instruction: "Check the consent box.",
          required: true,
        },
      ],
    },
  },
  post_execution_verifier: {
    next_status: "pending",
    next_action: "await_confirmation",
    review_reasons: [],
  },
});

describe("FastPeopleSearch milestone runner", () => {
  it("runs the local milestone path with fixture confirmation browser", async () => {
    const result = await runFastPeopleSearchMilestone({
      llmAdapter: fixtureAdapter,
      browserMode: "fixture_confirmation",
    });

    expect(result.summary.browserMode).toBe("fixture_confirmation");
    expect(result.summary.usedFixtureBrowser).toBe(true);
    expect(result.summary.site).toBe("FastPeopleSearch");
    expect(result.summary.procedureType).toBe("webform");
    expect(result.summary.draftChannel).toBe("webform");
    expect(result.summary.handoffMode).toBe("auto");
    expect(result.summary.automationStatus).toBe("pending");
    expect(result.summary.manualReviewRequired).toBe(false);
    expect(result.summary.terminalPath).toBe("await_confirmation");
    expect(result.output.automation_record?.executionResult.confirmation_text?.toLowerCase()).toContain("pending review");
  });
});
