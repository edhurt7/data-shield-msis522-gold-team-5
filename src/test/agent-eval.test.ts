import { describe, expect, it } from "vitest";

import { type ProcedureRetriever } from "@/lib/agent";
import {
  evaluateDraftQuality,
  evaluateExecutionInterpretation,
  evaluateFailClosed,
  evaluateGoldenPath,
  evaluateNoGroundingFallback,
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
import { runFixtureWorkflow } from "@/test/support/fixture-workflow";

describe("agent evaluation harness", () => {
  it("evaluates the FastPeopleSearch fixture against expected workflow outputs", async () => {
    const result = await runFixtureWorkflow({
      runId: "run_eval_001",
      site: fastPeopleSearchFixture.site,
      requestText: fastPeopleSearchFixture.requestText,
      seedProfile: fastPeopleSearchFixture.seedProfile,
      listingPageText: fastPeopleSearchFixture.listingPageText,
      pageArtifact: fastPeopleSearchFixture.pageArtifact,
      candidateUrl: fastPeopleSearchFixture.candidateUrl,
      executionResult: fastPeopleSearchFixture.executionResult,
    });

    const evaluation = evaluateGoldenPath(result, {
      ...fastPeopleSearchFixture.expected,
      terminalPath: "await_confirmation",
      requirePromptTrace: true,
    });

    expect(evaluation.passed).toBe(true);
    expect(evaluation.checks.discoveryFound).toBe(true);
    expect(evaluation.checks.matchDecision).toBe(true);
    expect(evaluation.checks.groundedProcedure).toBe(true);
    expect(evaluation.checks.requiredFieldsPresent).toBe(true);
    expect(evaluation.checks.cleanSubmissionPayload).toBe(true);
    expect(evaluation.checks.noManualReview).toBe(true);
    expect(evaluation.checks.terminalPath).toBe(true);
    expect(evaluation.checks.promptTrace).toBe(true);
  });

  it("evaluates an ambiguous listing fixture as a review fallback", async () => {
    const result = await runFixtureWorkflow({
      runId: "run_eval_ambiguous_001",
      site: ambiguousFastPeopleSearchFixture.site,
      requestText: ambiguousFastPeopleSearchFixture.requestText,
      seedProfile: ambiguousFastPeopleSearchFixture.seedProfile,
      listingPageText: ambiguousFastPeopleSearchFixture.listingPageText,
      pageArtifact: ambiguousFastPeopleSearchFixture.pageArtifact,
      candidateUrl: ambiguousFastPeopleSearchFixture.candidateUrl,
    });

    const evaluation = evaluateReviewFallback(result, {
      maxConfidence: ambiguousFastPeopleSearchFixture.expected.maxConfidence,
      requiredReviewReasons: [ambiguousFastPeopleSearchFixture.expected.requiredReviewReason],
      draftBlocked: true,
      submissionBlocked: true,
      terminalPath: "low_confidence_match_blocked",
      requireProcedurePromptBypass: true,
    });

    expect(evaluation.passed).toBe(true);
  });

  it.each([
    ["same name wrong city", sameNameWrongCityFixture],
    ["same name wrong age", sameNameWrongAgeFixture],
    ["partial name match", partialNameMatchFixture],
    ["weak evidence one field only", weakEvidenceSingleFieldFixture],
  ])("measures fail-closed identity behavior for %s", async (_label, fixture) => {
    const result = await runFixtureWorkflow({
      runId: `run_eval_identity_${fixture.candidateUrl}`,
      site: fixture.site,
      requestText: fixture.requestText,
      seedProfile: fixture.seedProfile,
      listingPageText: fixture.listingPageText,
      pageArtifact: fixture.pageArtifact,
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
    }, undefined, ["missing_procedure", "procedure_unknown"], "missing_procedure"],
    ["contradictory retrieval", {
      runId: "run_eval_contradictory_retrieval_001",
      site: fastPeopleSearchFixture.site,
      requestText: fastPeopleSearchFixture.requestText,
      seedProfile: fastPeopleSearchFixture.seedProfile,
      listingPageText: fastPeopleSearchFixture.listingPageText,
      pageArtifact: fastPeopleSearchFixture.pageArtifact,
      candidateUrl: fastPeopleSearchFixture.candidateUrl,
    }, (() => contradictoryProcedureFixture) satisfies ProcedureRetriever, ["contradictory_procedure", "procedure_unknown"], "contradictory_procedure"],
    ["stale retrieval", {
      runId: "run_eval_stale_retrieval_001",
      site: fastPeopleSearchFixture.site,
      requestText: fastPeopleSearchFixture.requestText,
      seedProfile: fastPeopleSearchFixture.seedProfile,
      listingPageText: fastPeopleSearchFixture.listingPageText,
      pageArtifact: fastPeopleSearchFixture.pageArtifact,
      candidateUrl: fastPeopleSearchFixture.candidateUrl,
    }, (() => staleProcedureFixture) satisfies ProcedureRetriever, ["stale_procedure", "procedure_unknown"], "stale_procedure"],
  ])("measures fail-closed retrieval behavior for %s", async (_label, fixture, procedureRetriever, requiredReviewReasons, terminalPath) => {
    const result = await runFixtureWorkflow(fixture, procedureRetriever ? { procedureRetriever } : undefined);

    const evaluation = evaluateFailClosed(result, {
      requiredReviewReasons,
      procedureUnknown: true,
      draftBlocked: true,
      submissionBlocked: true,
      terminalPath,
      requireProcedurePromptBypass: true,
    });

    expect(evaluation.passed).toBe(true);
  });

  it("measures fail-closed behavior for incomplete procedure docs with missing required fields", async () => {
    const result = await runFixtureWorkflow({
      runId: "run_eval_incomplete_retrieval_001",
      site: fastPeopleSearchFixture.site,
      requestText: fastPeopleSearchFixture.requestText,
      seedProfile: fastPeopleSearchFixture.seedProfile,
      listingPageText: fastPeopleSearchFixture.listingPageText,
      pageArtifact: fastPeopleSearchFixture.pageArtifact,
      candidateUrl: fastPeopleSearchFixture.candidateUrl,
      retrievedChunks: incompleteProcedureFixture.chunks,
    });

    const evaluation = evaluateFailClosed(result, {
      requiredReviewReasons: ["procedure_unknown"],
      procedureUnknown: true,
      draftBlocked: true,
      submissionBlocked: true,
      terminalPath: "missing_procedure",
    });

    expect(evaluation.passed).toBe(true);
  });

  it("measures no-grounding fallback behavior for incomplete procedure docs when policy allows it", async () => {
    const result = await runFixtureWorkflow({
      runId: "run_eval_incomplete_retrieval_noground_001",
      site: fastPeopleSearchFixture.site,
      requestText: fastPeopleSearchFixture.requestText,
      seedProfile: fastPeopleSearchFixture.seedProfile,
      listingPageText: fastPeopleSearchFixture.listingPageText,
      pageArtifact: fastPeopleSearchFixture.pageArtifact,
      candidateUrl: fastPeopleSearchFixture.candidateUrl,
      retrievedChunks: incompleteProcedureFixture.chunks,
    }, {
      policyOverrides: {
        require_retrieval_grounding: false,
      },
    });

    const evaluation = evaluateNoGroundingFallback(result, {
      procedureType: "webform",
      requiredFieldNames: ["full_name", "privacy_email"],
      submissionAllowed: true,
      terminalPath: "completed",
    });

    expect(evaluation.passed).toBe(true);
  });

  it("measures draft completeness, grounding, and PII minimization", async () => {
    const result = await runFixtureWorkflow({
      runId: "run_eval_draft_quality_001",
      site: emailDraftQualityFixture.site,
      requestText: emailDraftQualityFixture.requestText,
      seedProfile: emailDraftQualityFixture.seedProfile,
      listingPageText: emailDraftQualityFixture.listingPageText,
      pageArtifact: emailDraftQualityFixture.pageArtifact,
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
    ["clear success", executionInterpretationFixtures.clearSuccess, "completed"],
    ["pending confirmation", executionInterpretationFixtures.pendingConfirmation, "await_confirmation"],
    ["failure with retry", executionInterpretationFixtures.failureWithRetry, "retry_scheduled"],
    ["CAPTCHA manual path", executionInterpretationFixtures.captchaRequired, "captcha_review"],
    ["unclear evidence", executionInterpretationFixtures.unclearEvidence, "await_confirmation"],
  ] as const)("measures execution interpretation for %s", async (_label, fixture, terminalPath) => {
    const result = await runFixtureWorkflow({
      runId: `run_eval_execution_${fixture.status}`,
      site: fastPeopleSearchFixture.site,
      requestText: fastPeopleSearchFixture.requestText,
      seedProfile: fastPeopleSearchFixture.seedProfile,
      listingPageText: fastPeopleSearchFixture.listingPageText,
      pageArtifact: fastPeopleSearchFixture.pageArtifact,
      candidateUrl: fastPeopleSearchFixture.candidateUrl,
      executionResult: {
        site: fastPeopleSearchFixture.site,
        candidate_url: fastPeopleSearchFixture.candidateUrl,
        status: fixture.status,
        manual_review_required: fixture.manual_review_required,
        confirmation_text: fixture.confirmation_text,
        ticket_ids: fixture.ticket_ids,
        screenshot_ref: fixture.screenshot_ref,
        error_text: fixture.error_text,
      },
    });

    const evaluation = evaluateExecutionInterpretation(result, {
      ...fixture.expected,
      terminalPath,
    });

    expect(evaluation.passed).toBe(true);
  });
});
