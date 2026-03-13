import { describe, expect, it } from "vitest";

import { createAgentWorkflow } from "@/lib/agent";
import { fastPeopleSearchFixture } from "@/lib/agent/fixtures/fastpeoplesearch";
import { ambiguousFastPeopleSearchFixture } from "@/lib/agent/fixtures/fastpeoplesearch-negative";

describe("artifact-backed one-site golden path", () => {
  it("runs FastPeopleSearch end-to-end using saved listing text and backend-shaped procedure retrieval", async () => {
    const workflow = createAgentWorkflow();

    const result = await workflow.run({
      context: {
        run_id: "run_fixture_001",
        policy: {
          match_confidence_threshold: 0.75,
          max_submission_retries: 1,
          require_explicit_consent: true,
          minimize_pii: true,
          require_retrieval_grounding: true,
        },
        review_reasons: [],
        events: [],
      },
      seed_profile: fastPeopleSearchFixture.seedProfile,
      request_text: fastPeopleSearchFixture.requestText,
      site_input: {
        site: fastPeopleSearchFixture.site,
        page_text: fastPeopleSearchFixture.listingPageText,
        page_url: fastPeopleSearchFixture.candidateUrl,
        retrieved_chunks: [],
        execution_result: fastPeopleSearchFixture.executionResult,
      },
    });

    expect(result.discovery_parse.found).toBe(true);
    expect(result.discovery_parse.candidates[0]?.match_confidence).toBeGreaterThanOrEqual(
      fastPeopleSearchFixture.expected.minConfidence,
    );
    expect(result.match_decision).toMatchObject({
      decision: fastPeopleSearchFixture.expected.decision,
      confidence: result.discovery_parse.candidates[0]?.match_confidence,
    });
    expect(result.match_decision?.evidence.length).toBeGreaterThan(0);
    expect(result.retrieve_procedure?.procedure_type).toBe(fastPeopleSearchFixture.expected.procedureType);
    expect(result.retrieve_procedure?.source_chunks).toEqual(expect.arrayContaining(fastPeopleSearchFixture.procedureChunks));
    expect(result.draft_optout).toEqual({
      site: "FastPeopleSearch",
      candidate_url: fastPeopleSearchFixture.candidateUrl,
      procedure_type: "webform",
      webform: {
        fields: [
          { name: "full_name", value: fastPeopleSearchFixture.seedProfile.full_name },
          { name: "privacy_email", value: fastPeopleSearchFixture.seedProfile.privacy_email },
        ],
        consent_checkboxes: expect.arrayContaining([
          expect.stringContaining("consent checkbox"),
        ]),
      },
    });
    expect(result.draft_optout?.email).toBeUndefined();
    expect(result.interpret_result?.next_status).toBe(fastPeopleSearchFixture.expected.nextStatus);
    expect(result.interpret_result?.next_action).toBe(fastPeopleSearchFixture.expected.nextAction);
    expect(result.plan_submission).toEqual({
      action_plan: result.draft_optout,
      requires_manual_review: false,
      review_reasons: [],
    });
  });

  it("blocks drafting and planning on an ambiguous saved listing", async () => {
    const workflow = createAgentWorkflow();

    const result = await workflow.run({
      context: {
        run_id: "run_fixture_ambiguous_001",
        policy: {
          match_confidence_threshold: 0.75,
          max_submission_retries: 1,
          require_explicit_consent: true,
          minimize_pii: true,
          require_retrieval_grounding: true,
        },
        review_reasons: [],
        events: [],
      },
      seed_profile: ambiguousFastPeopleSearchFixture.seedProfile,
      request_text: ambiguousFastPeopleSearchFixture.requestText,
      site_input: {
        site: ambiguousFastPeopleSearchFixture.site,
        page_text: ambiguousFastPeopleSearchFixture.listingPageText,
        page_url: ambiguousFastPeopleSearchFixture.candidateUrl,
        retrieved_chunks: [],
      },
    });

    expect(result.discovery_parse.found).toBe(true);
    expect(result.discovery_parse.candidates[0]?.match_confidence).toBeLessThan(0.75);
    expect(result.match_decision).toMatchObject({
      decision: "possible_match",
      confidence: result.discovery_parse.candidates[0]?.match_confidence,
    });
    expect(result.draft_optout).toBeNull();
    expect(result.plan_submission).toBeNull();
    expect(result.context.review_reasons).toContain("low_confidence_match");
  });
});
