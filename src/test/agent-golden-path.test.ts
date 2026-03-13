import { describe, expect, it } from "vitest";

import { fastPeopleSearchFixture } from "@/lib/agent/fixtures/fastpeoplesearch";
import { ambiguousFastPeopleSearchFixture } from "@/lib/agent/fixtures/fastpeoplesearch-negative";
import { createFixtureBackedWorkflow } from "@/test/support/fixture-workflow";

describe("artifact-backed one-site golden path", () => {
  it("runs FastPeopleSearch end-to-end using saved listing text and backend-shaped procedure retrieval", async () => {
    const workflow = createFixtureBackedWorkflow();

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
        page_artifact: fastPeopleSearchFixture.pageArtifact,
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
    expect(result.retrieve_procedure?.source_chunks).toEqual(expect.arrayContaining(
      fastPeopleSearchFixture.procedureChunks.map((chunk) => expect.objectContaining({
        ...chunk,
        source_id: "fastpeoplesearch-procedure-v1",
        source_updated_at: "2026-03-10T00:00:00.000Z",
        retrieved_at: "2026-03-12T12:00:00.000Z",
      })),
    ));
    expect(result.draft_optout).toEqual({
      site: "FastPeopleSearch",
      candidate_url: fastPeopleSearchFixture.candidateUrl,
      submission_channel: "webform",
      procedure_type: "webform",
      required_fields: [
        { name: "full_name", value: fastPeopleSearchFixture.seedProfile.full_name, required: true },
        { name: "privacy_email", value: fastPeopleSearchFixture.seedProfile.privacy_email, required: true },
      ],
      optional_fields: [],
      manual_review_required: false,
      review_reasons: [],
      webform: {
        fields: [
          { name: "full_name", value: fastPeopleSearchFixture.seedProfile.full_name },
          { name: "privacy_email", value: fastPeopleSearchFixture.seedProfile.privacy_email },
        ],
        consent_checkboxes: expect.arrayContaining([
          expect.objectContaining({
            instruction: expect.stringContaining("consent checkbox"),
          }),
        ]),
      },
    });
    expect(result.draft_optout?.email).toBeUndefined();
    expect(result.interpret_result?.next_status).toBe(fastPeopleSearchFixture.expected.nextStatus);
    expect(result.interpret_result?.next_action).toBe(fastPeopleSearchFixture.expected.nextAction);
    expect(result.plan_submission).toEqual({
      action_plan: {
        ...result.draft_optout,
        manual_review_required: false,
        review_reasons: [],
      },
      requires_manual_review: false,
      review_reasons: [],
    });
  });

  it("blocks drafting and planning on an ambiguous saved listing", async () => {
    const workflow = createFixtureBackedWorkflow();

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
        page_artifact: ambiguousFastPeopleSearchFixture.pageArtifact,
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
