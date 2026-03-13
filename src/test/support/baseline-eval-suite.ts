import {
  createEvaluationReport,
  evaluateDraftQuality,
  evaluateExecutionInterpretation,
  evaluateGoldenPath,
  evaluateNoGroundingFallback,
  evaluateReviewFallback,
  type EvaluationReport,
  type EvaluationScenarioReport,
} from "@/lib/agent";
import { fastPeopleSearchFixture } from "@/lib/agent/fixtures/fastpeoplesearch";
import {
  ambiguousFastPeopleSearchFixture,
  emailDraftQualityFixture,
  executionInterpretationFixtures,
  incompleteProcedureFixture,
} from "@/lib/agent/fixtures/fastpeoplesearch-negative";
import { runFixtureWorkflow } from "@/test/support/fixture-workflow";

const baselineSuiteName = "fixture-baseline-regression";

async function runGoldenPathScenario(): Promise<EvaluationScenarioReport> {
  const result = await runFixtureWorkflow({
    runId: "run_baseline_fastpeoplesearch_001",
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

  return {
    scenario_id: "fastpeoplesearch-happy-path",
    suite: baselineSuiteName,
    label: "FastPeopleSearch happy path",
    site: fastPeopleSearchFixture.site,
    evaluation_type: "golden_path",
    passed: evaluation.passed,
    checks: evaluation.checks,
    terminal_path: result.terminal_path,
    review_reasons: result.context.review_reasons,
    metrics: {
      match_confidence: result.match_decision?.confidence ?? null,
      next_status: result.interpret_result?.next_status ?? null,
      next_action: result.interpret_result?.next_action ?? null,
      prompt_trace_complete:
        result.prompt_trace.discovery_parse !== null
        && result.prompt_trace.retrieve_procedure !== null
        && result.prompt_trace.draft_optout !== null
        && result.prompt_trace.interpret_result !== null,
    },
  };
}

async function runAmbiguousMatchScenario(): Promise<EvaluationScenarioReport> {
  const result = await runFixtureWorkflow({
    runId: "run_baseline_fastpeoplesearch_ambiguous_001",
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

  return {
    scenario_id: "fastpeoplesearch-ambiguous-match",
    suite: baselineSuiteName,
    label: "FastPeopleSearch ambiguous listing block",
    site: ambiguousFastPeopleSearchFixture.site,
    evaluation_type: "review_fallback",
    passed: evaluation.passed,
    checks: evaluation.checks,
    terminal_path: result.terminal_path,
    review_reasons: result.context.review_reasons,
    metrics: {
      match_confidence: result.match_decision?.confidence ?? result.discovery_parse.candidates[0]?.match_confidence ?? null,
      draft_blocked: result.draft_optout === null,
      submission_blocked: result.plan_submission === null,
    },
  };
}

async function runNoGroundingScenario(): Promise<EvaluationScenarioReport> {
  const result = await runFixtureWorkflow({
    runId: "run_baseline_incomplete_nogrounding_001",
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

  return {
    scenario_id: "fastpeoplesearch-no-grounding-override",
    suite: baselineSuiteName,
    label: "No-grounding fallback override",
    site: fastPeopleSearchFixture.site,
    evaluation_type: "no_grounding_fallback",
    passed: evaluation.passed,
    checks: evaluation.checks,
    terminal_path: result.terminal_path,
    review_reasons: result.context.review_reasons,
    metrics: {
      procedure_type: result.retrieve_procedure?.procedure_type ?? null,
      submission_allowed: result.plan_submission !== null,
      prompt_bypassed: result.prompt_trace.retrieve_procedure === null,
    },
  };
}

async function runDraftQualityScenario(): Promise<EvaluationScenarioReport> {
  const result = await runFixtureWorkflow({
    runId: "run_baseline_radaris_draft_001",
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

  return {
    scenario_id: "radaris-email-draft-quality",
    suite: baselineSuiteName,
    label: "Radaris draft quality",
    site: emailDraftQualityFixture.site,
    evaluation_type: "draft_quality",
    passed: evaluation.passed,
    checks: evaluation.checks,
    terminal_path: result.terminal_path,
    review_reasons: result.context.review_reasons,
    metrics: {
      procedure_type: result.draft_optout?.procedure_type ?? null,
      recipient: result.draft_optout?.email?.to ?? null,
      required_field_count: result.draft_optout?.required_fields.length ?? 0,
    },
  };
}

async function runExecutionInterpretationScenario(): Promise<EvaluationScenarioReport> {
  const fixture = executionInterpretationFixtures.unclearEvidence;
  const result = await runFixtureWorkflow({
    runId: "run_baseline_execution_unclear_001",
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
    terminalPath: "await_confirmation",
  });

  return {
    scenario_id: "execution-interpretation-unclear-evidence",
    suite: baselineSuiteName,
    label: "Execution interpretation fail-closed path",
    site: fastPeopleSearchFixture.site,
    evaluation_type: "execution_interpretation",
    passed: evaluation.passed,
    checks: evaluation.checks,
    terminal_path: result.terminal_path,
    review_reasons: result.interpret_result?.review_reasons ?? [],
    metrics: {
      next_status: result.interpret_result?.next_status ?? null,
      next_action: result.interpret_result?.next_action ?? null,
      confirmation_present: Boolean(result.execution_result?.confirmation_text),
    },
  };
}

export async function runBaselineEvaluationSuite() {
  return Promise.all([
    runGoldenPathScenario(),
    runAmbiguousMatchScenario(),
    runNoGroundingScenario(),
    runDraftQualityScenario(),
    runExecutionInterpretationScenario(),
  ]);
}

export async function createBaselineEvaluationReport(): Promise<EvaluationReport> {
  return createEvaluationReport({
    suite: baselineSuiteName,
    scenarios: await runBaselineEvaluationSuite(),
  });
}

export { baselineSuiteName };
