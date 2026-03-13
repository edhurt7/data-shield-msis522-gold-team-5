import { describe, expect, it } from "vitest";

import { createAgentWorkflow, type ExecutionResult, type ProcedureRetriever, type WorkflowRunOutput } from "@/lib/agent";
import {
  evaluateDraftQuality,
  evaluateExecutionInterpretation,
  evaluateFailClosed,
  evaluateGoldenPath,
  evaluateReviewFallback,
} from "@/lib/agent/eval";
import { fastPeopleSearchFixture } from "@/lib/agent/fixtures/fastpeoplesearch";
import {
  ambiguousFastPeopleSearchFixture,
  contradictoryProcedureFixture,
  emailDraftQualityFixture,
  executionInterpretationFixtures,
  incompleteProcedureFixture,
  partialNameMatchFixture,
  sameNameWrongAgeFixture,
  sameNameWrongCityFixture,
  staleProcedureFixture,
  weakEvidenceSingleFieldFixture,
} from "@/lib/agent/fixtures/fastpeoplesearch-negative";

const baseContext = {
  policy: {
    match_confidence_threshold: 0.75,
    max_submission_retries: 1,
    require_explicit_consent: true,
    minimize_pii: true,
    require_retrieval_grounding: true,
  },
  review_reasons: [],
  events: [],
};

async function runFixture(
  input: {
    runId: string;
    site: string;
    requestText: string;
    seedProfile: typeof fastPeopleSearchFixture.seedProfile;
    listingPageText: string;
    candidateUrl: string;
    retrievedChunks?: { doc_id: string; quote: string }[];
    executionResult?: ExecutionResult;
  },
  options?: {
    procedureRetriever?: ProcedureRetriever;
  },
): Promise<WorkflowRunOutput> {
  const workflow = createAgentWorkflow(options);

  return workflow.run({
    context: {
      ...baseContext,
      run_id: input.runId,
    },
    seed_profile: input.seedProfile,
    request_text: input.requestText,
    site_input: {
      site: input.site,
      page_text: input.listingPageText,
      page_url: input.candidateUrl,
      retrieved_chunks: input.retrievedChunks ?? [],
      execution_result: input.executionResult,
    },
  });
}

describe("agent evaluation harness", () => {
  it("evaluates the FastPeopleSearch fixture against expected workflow outputs", async () => {
    const result = await runFixture({
      runId: "run_eval_001",
      site: fastPeopleSearchFixture.site,
      requestText: fastPeopleSearchFixture.requestText,
      seedProfile: fastPeopleSearchFixture.seedProfile,
      listingPageText: fastPeopleSearchFixture.listingPageText,
      candidateUrl: fastPeopleSearchFixture.candidateUrl,
      executionResult: fastPeopleSearchFixture.executionResult,
    });

    const evaluation = evaluateGoldenPath(result, fastPeopleSearchFixture.expected);

    expect(evaluation.passed).toBe(true);
    expect(evaluation.checks.discoveryFound).toBe(true);
    expect(evaluation.checks.matchDecision).toBe(true);
    expect(evaluation.checks.groundedProcedure).toBe(true);
    expect(evaluation.checks.requiredFieldsPresent).toBe(true);
    expect(evaluation.checks.cleanSubmissionPayload).toBe(true);
    expect(evaluation.checks.noManualReview).toBe(true);
  });

  it("evaluates an ambiguous listing fixture as a review fallback", async () => {
    const result = await runFixture({
      runId: "run_eval_ambiguous_001",
      site: ambiguousFastPeopleSearchFixture.site,
      requestText: ambiguousFastPeopleSearchFixture.requestText,
      seedProfile: ambiguousFastPeopleSearchFixture.seedProfile,
      listingPageText: ambiguousFastPeopleSearchFixture.listingPageText,
      candidateUrl: ambiguousFastPeopleSearchFixture.candidateUrl,
    });

    const evaluation = evaluateReviewFallback(result, {
      maxConfidence: ambiguousFastPeopleSearchFixture.expected.maxConfidence,
      requiredReviewReasons: [ambiguousFastPeopleSearchFixture.expected.requiredReviewReason],
      draftBlocked: true,
      submissionBlocked: true,
    });

    expect(evaluation.passed).toBe(true);
  });

  it.each([
    ["same name wrong city", sameNameWrongCityFixture],
    ["same name wrong age", sameNameWrongAgeFixture],
    ["partial name match", partialNameMatchFixture],
    ["weak evidence one field only", weakEvidenceSingleFieldFixture],
  ])("measures fail-closed identity behavior for %s", async (_label, fixture) => {
    const result = await runFixture({
      runId: `run_eval_identity_${fixture.candidateUrl}`,
      site: fixture.site,
      requestText: fixture.requestText,
      seedProfile: fixture.seedProfile,
      listingPageText: fixture.listingPageText,
      candidateUrl: fixture.candidateUrl,
    });

    const evaluation = evaluateFailClosed(result, {
      maxConfidence: fixture.expected.maxConfidence,
      requiredReviewReasons: [fixture.expected.requiredReviewReason],
      draftBlocked: true,
      submissionBlocked: true,
    });

    expect(evaluation.passed).toBe(true);
  });

  it.each([
    ["missing retrieval", {
      runId: "run_eval_missing_retrieval_001",
      site: "UnknownBroker",
      requestText: "Find me and remove the listing.",
      seedProfile: fastPeopleSearchFixture.seedProfile,
      listingPageText: "Jane Doe, age 35, Seattle, Washington",
      candidateUrl: "https://unknownbroker.test/listing/jane-doe-seattle-wa",
    }, undefined, ["missing_procedure", "procedure_unknown"]],
    ["contradictory retrieval", {
      runId: "run_eval_contradictory_retrieval_001",
      site: fastPeopleSearchFixture.site,
      requestText: fastPeopleSearchFixture.requestText,
      seedProfile: fastPeopleSearchFixture.seedProfile,
      listingPageText: fastPeopleSearchFixture.listingPageText,
      candidateUrl: fastPeopleSearchFixture.candidateUrl,
    }, (() => contradictoryProcedureFixture) satisfies ProcedureRetriever, ["contradictory_procedure", "procedure_unknown"]],
    ["stale retrieval", {
      runId: "run_eval_stale_retrieval_001",
      site: fastPeopleSearchFixture.site,
      requestText: fastPeopleSearchFixture.requestText,
      seedProfile: fastPeopleSearchFixture.seedProfile,
      listingPageText: fastPeopleSearchFixture.listingPageText,
      candidateUrl: fastPeopleSearchFixture.candidateUrl,
    }, (() => staleProcedureFixture) satisfies ProcedureRetriever, ["stale_procedure", "procedure_unknown"]],
  ])("measures fail-closed retrieval behavior for %s", async (_label, fixture, procedureRetriever, requiredReviewReasons) => {
    const result = await runFixture(fixture, procedureRetriever ? { procedureRetriever } : undefined);

    const evaluation = evaluateFailClosed(result, {
      requiredReviewReasons,
      procedureUnknown: true,
      draftBlocked: true,
      submissionBlocked: true,
    });

    expect(evaluation.passed).toBe(true);
  });

  it("measures fail-closed behavior for incomplete procedure docs with missing required fields", async () => {
    const result = await runFixture({
      runId: "run_eval_incomplete_retrieval_001",
      site: fastPeopleSearchFixture.site,
      requestText: fastPeopleSearchFixture.requestText,
      seedProfile: fastPeopleSearchFixture.seedProfile,
      listingPageText: fastPeopleSearchFixture.listingPageText,
      candidateUrl: fastPeopleSearchFixture.candidateUrl,
      retrievedChunks: incompleteProcedureFixture.chunks,
    });

    const evaluation = evaluateFailClosed(result, {
      requiredReviewReasons: ["procedure_unknown"],
      procedureUnknown: true,
      draftBlocked: true,
      submissionBlocked: true,
    });

    expect(evaluation.passed).toBe(true);
  });

  it("measures draft completeness, grounding, and PII minimization", async () => {
    const result = await runFixture({
      runId: "run_eval_draft_quality_001",
      site: emailDraftQualityFixture.site,
      requestText: emailDraftQualityFixture.requestText,
      seedProfile: emailDraftQualityFixture.seedProfile,
      listingPageText: emailDraftQualityFixture.listingPageText,
      candidateUrl: emailDraftQualityFixture.candidateUrl,
      retrievedChunks: emailDraftQualityFixture.procedureChunks,
    });

    const evaluation = evaluateDraftQuality(result, {
      procedureType: "email",
      requiredFieldNames: ["full_name", "privacy_email"],
      privacyEmail: emailDraftQualityFixture.seedProfile.privacy_email,
      forbiddenValues: [
        emailDraftQualityFixture.seedProfile.location.city,
        emailDraftQualityFixture.seedProfile.location.state,
        emailDraftQualityFixture.seedProfile.approx_age ?? "",
        emailDraftQualityFixture.seedProfile.optional.phone_last4 ?? "",
      ].filter(Boolean),
    });

    expect(evaluation.passed).toBe(true);
  });

  it.each([
    ["clear success", executionInterpretationFixtures.clearSuccess],
    ["pending confirmation", executionInterpretationFixtures.pendingConfirmation],
    ["failure with retry", executionInterpretationFixtures.failureWithRetry],
    ["CAPTCHA manual path", executionInterpretationFixtures.captchaRequired],
    ["unclear evidence", executionInterpretationFixtures.unclearEvidence],
  ])("measures execution interpretation for %s", async (_label, fixture) => {
    const result = await runFixture({
      runId: `run_eval_execution_${fixture.status}`,
      site: fastPeopleSearchFixture.site,
      requestText: fastPeopleSearchFixture.requestText,
      seedProfile: fastPeopleSearchFixture.seedProfile,
      listingPageText: fastPeopleSearchFixture.listingPageText,
      candidateUrl: fastPeopleSearchFixture.candidateUrl,
      executionResult: {
        site: fastPeopleSearchFixture.site,
        candidate_url: fastPeopleSearchFixture.candidateUrl,
        status: fixture.status,
        confirmation: fixture.confirmation,
        error: fixture.error,
      },
    });

    const evaluation = evaluateExecutionInterpretation(result, fixture.expected);

    expect(evaluation.passed).toBe(true);
  });
});
