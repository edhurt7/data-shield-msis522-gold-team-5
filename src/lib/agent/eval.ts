import type { ReviewReason, WorkflowSiteRunOutput, WorkflowTerminalPath } from "@/lib/agent";

export interface GoldenPathExpectation {
  minConfidence: number;
  decision: "exact_match" | "likely_match";
  procedureType: "email" | "webform";
  requiredFieldNames: string[];
  nextStatus: "submitted" | "pending" | "failed" | "manual_required";
  nextAction: "none" | "retry" | "await_confirmation" | "request_user_review";
  terminalPath?: WorkflowTerminalPath;
  requirePromptTrace?: boolean;
}

export interface GoldenPathEvaluation {
  passed: boolean;
  checks: {
    discoveryFound: boolean;
    confidenceThreshold: boolean;
    matchDecision: boolean;
    groundedProcedure: boolean;
    procedureType: boolean;
    requiredFieldsPresent: boolean;
    cleanSubmissionPayload: boolean;
    nextStatus: boolean;
    nextAction: boolean;
    noManualReview: boolean;
    terminalPath: boolean;
    promptTrace: boolean;
  };
}

export interface ReviewFallbackExpectation {
  maxConfidence?: number;
  requiredReviewReasons: ReviewReason[];
  draftBlocked: boolean;
  submissionBlocked: boolean;
  terminalPath?: WorkflowTerminalPath;
  requireProcedurePromptBypass?: boolean;
}

export interface ReviewFallbackEvaluation {
  passed: boolean;
  checks: {
    confidenceBelowThreshold: boolean;
    requiredReasonsPresent: boolean;
    draftBlocked: boolean;
    submissionBlocked: boolean;
    terminalPath: boolean;
    procedurePromptBypassed: boolean;
  };
}

export interface DraftQualityExpectation {
  procedureType: "email" | "webform";
  requiredFieldNames: string[];
  allowedFieldNames?: string[];
  privacyEmail: string;
  forbiddenValues?: string[];
}

export interface DraftQualityEvaluation {
  passed: boolean;
  checks: {
    procedureType: boolean;
    requiredFieldsPresent: boolean;
    noUnsupportedFieldsInvented: boolean;
    privacyEmailUsedConsistently: boolean;
    unnecessaryPiiOmitted: boolean;
  };
}

export interface ExecutionInterpretationExpectation {
  nextStatus: "submitted" | "pending" | "failed" | "manual_required";
  nextAction: "none" | "retry" | "await_confirmation" | "request_user_review";
  requiredReviewReasons?: ReviewReason[];
  forbidSubmitted?: boolean;
  terminalPath?: WorkflowTerminalPath;
}

export interface ExecutionInterpretationEvaluation {
  passed: boolean;
  checks: {
    nextStatus: boolean;
    nextAction: boolean;
    requiredReasonsPresent: boolean;
    failClosedOnUnclearEvidence: boolean;
    terminalPath: boolean;
  };
}

export interface FailClosedExpectation {
  maxConfidence?: number;
  requiredReviewReasons: ReviewReason[];
  procedureUnknown?: boolean;
  draftBlocked: boolean;
  submissionBlocked: boolean;
  successNotClaimed?: boolean;
  terminalPath?: WorkflowTerminalPath;
  requireProcedurePromptBypass?: boolean;
}

export interface FailClosedEvaluation {
  passed: boolean;
  checks: {
    confidenceBelowThreshold: boolean;
    requiredReasonsPresent: boolean;
    procedureUnknown: boolean;
    draftBlocked: boolean;
    submissionBlocked: boolean;
    successNotClaimed: boolean;
    terminalPath: boolean;
    procedurePromptBypassed: boolean;
  };
}

export interface NoGroundingFallbackExpectation {
  procedureType: "email" | "webform";
  requiredFieldNames: string[];
  submissionAllowed: boolean;
  terminalPath?: WorkflowTerminalPath | null;
}

export interface NoGroundingFallbackEvaluation {
  passed: boolean;
  checks: {
    fallbackProcedureRecovered: boolean;
    requiredFieldsRecovered: boolean;
    procedureUnknownCleared: boolean;
    submissionAllowed: boolean;
    procedurePromptBypassed: boolean;
    terminalPath: boolean;
  };
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function allEmails(text: string) {
  return unique(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []);
}

export function evaluateGoldenPath(output: WorkflowSiteRunOutput, expected: GoldenPathExpectation): GoldenPathEvaluation {
  const candidate = output.discovery_parse.candidates[0];
  const webformFields = output.draft_optout?.webform?.fields.map((field) => field.name) ?? [];
  const fieldEntries = output.draft_optout?.webform?.fields ?? [];
  const requiredFields = output.draft_optout?.required_fields ?? [];
  const uniqueFieldNames = new Set(fieldEntries.map((field) => field.name));
  const cleanSubmissionPayload = output.draft_optout?.procedure_type === "webform"
    ? output.draft_optout.submission_channel === "webform"
      && output.draft_optout.email === undefined
      && fieldEntries.length > 0
      && requiredFields.length > 0
      && requiredFields.every((field) => field.required)
      && fieldEntries.every((field) => field.name.trim().length > 0 && field.value.trim().length > 0)
      && uniqueFieldNames.size === fieldEntries.length
    : output.draft_optout?.procedure_type === "email"
      ? output.draft_optout.submission_channel === "email"
        && output.draft_optout.webform === undefined
        && requiredFields.length > 0
        && requiredFields.every((field) => field.required)
      : false;

  const checks = {
    discoveryFound: output.discovery_parse.found,
    confidenceThreshold: Boolean(candidate && candidate.match_confidence >= expected.minConfidence),
    matchDecision: output.match_decision?.decision === expected.decision
      && output.match_decision?.confidence === candidate?.match_confidence
      && (output.match_decision?.evidence.length ?? 0) > 0,
    groundedProcedure:
      output.retrieve_procedure?.procedure_type === expected.procedureType
      && (output.retrieve_procedure?.source_chunks.length ?? 0) > 0,
    procedureType: output.retrieve_procedure?.procedure_type === expected.procedureType,
    requiredFieldsPresent: expected.requiredFieldNames.every((field) => webformFields.includes(field)),
    cleanSubmissionPayload,
    nextStatus: output.interpret_result?.next_status === expected.nextStatus,
    nextAction: output.interpret_result?.next_action === expected.nextAction,
    noManualReview: output.plan_submission?.requires_manual_review === false,
    terminalPath: expected.terminalPath === undefined ? true : output.terminal_path === expected.terminalPath,
    promptTrace: expected.requirePromptTrace === undefined
      ? true
      : expected.requirePromptTrace
        ? output.prompt_trace.discovery_parse !== null
          && output.prompt_trace.retrieve_procedure !== null
          && output.prompt_trace.draft_optout !== null
          && output.prompt_trace.interpret_result !== null
        : true,
  };

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
  };
}

export function evaluateReviewFallback(
  output: WorkflowSiteRunOutput,
  expected: ReviewFallbackExpectation,
): ReviewFallbackEvaluation {
  const failClosed = evaluateFailClosed(output, {
    maxConfidence: expected.maxConfidence,
    requiredReviewReasons: expected.requiredReviewReasons,
    draftBlocked: expected.draftBlocked,
    submissionBlocked: expected.submissionBlocked,
  });

  return {
    passed: failClosed.passed,
    checks: {
      confidenceBelowThreshold: failClosed.checks.confidenceBelowThreshold,
      requiredReasonsPresent: failClosed.checks.requiredReasonsPresent,
      draftBlocked: failClosed.checks.draftBlocked,
      submissionBlocked: failClosed.checks.submissionBlocked,
      terminalPath: failClosed.checks.terminalPath,
      procedurePromptBypassed: failClosed.checks.procedurePromptBypassed,
    },
  };
}

export function evaluateDraftQuality(
  output: WorkflowSiteRunOutput,
  expected: DraftQualityExpectation,
): DraftQualityEvaluation {
  const draft = output.draft_optout;
  const allowedFieldNames = expected.allowedFieldNames ?? expected.requiredFieldNames;
  const webformFields = draft?.webform?.fields ?? [];
  const fieldNames = webformFields.map((field) => field.name);
  const draftText = [
    draft?.email?.to,
    draft?.email?.subject,
    draft?.email?.body,
    ...webformFields.flatMap((field) => [field.name, field.value]),
  ].filter(Boolean).join("\n");
  const bodyEmails = allEmails(draft?.email?.body ?? "");

  const checks = {
    procedureType: draft?.procedure_type === expected.procedureType,
    requiredFieldsPresent: expected.procedureType === "webform"
      ? expected.requiredFieldNames.every((field) => fieldNames.includes(field))
      : expected.requiredFieldNames.every((field) => {
          switch (field) {
            case "full_name":
              return draftText.includes(output.validate_consent.seed_profile.full_name);
            case "privacy_email":
              return draftText.includes(expected.privacyEmail);
            case "approx_age":
              return draftText.includes(output.validate_consent.seed_profile.approx_age ?? "");
            case "address":
              return draftText.includes(output.validate_consent.seed_profile.location.city)
                || draftText.includes(output.validate_consent.seed_profile.location.state);
            default:
              return true;
          }
        }),
    noUnsupportedFieldsInvented: expected.procedureType === "webform"
      ? fieldNames.every((field) => allowedFieldNames.includes(field))
      : true,
    privacyEmailUsedConsistently: expected.procedureType === "webform"
      ? webformFields
          .filter((field) => field.name === "privacy_email")
          .every((field) => field.value === expected.privacyEmail)
      : bodyEmails.every((email) => email === expected.privacyEmail),
    unnecessaryPiiOmitted: (expected.forbiddenValues ?? []).every((value) => !draftText.includes(value)),
  };

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
  };
}

export function evaluateExecutionInterpretation(
  output: WorkflowSiteRunOutput,
  expected: ExecutionInterpretationExpectation,
): ExecutionInterpretationEvaluation {
  const checks = {
    nextStatus: output.interpret_result?.next_status === expected.nextStatus,
    nextAction: output.interpret_result?.next_action === expected.nextAction,
    requiredReasonsPresent: (expected.requiredReviewReasons ?? []).every((reason) =>
      output.interpret_result?.review_reasons.includes(reason),
    ),
    failClosedOnUnclearEvidence: expected.forbidSubmitted ? output.interpret_result?.next_status !== "submitted" : true,
    terminalPath: expected.terminalPath === undefined ? true : output.terminal_path === expected.terminalPath,
  };

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
  };
}

export function evaluateFailClosed(
  output: WorkflowSiteRunOutput,
  expected: FailClosedExpectation,
): FailClosedEvaluation {
  const candidate = output.discovery_parse.candidates[0];
  const checks = {
    confidenceBelowThreshold:
      expected.maxConfidence === undefined ? true : Boolean(candidate && candidate.match_confidence <= expected.maxConfidence),
    requiredReasonsPresent: expected.requiredReviewReasons.every((reason) => output.context.review_reasons.includes(reason)),
    procedureUnknown: expected.procedureUnknown === undefined
      ? true
      : expected.procedureUnknown
        ? output.retrieve_procedure?.procedure_type === "procedure_unknown"
        : output.retrieve_procedure?.procedure_type !== "procedure_unknown",
    draftBlocked: expected.draftBlocked ? output.draft_optout === null : output.draft_optout !== null,
    submissionBlocked: expected.submissionBlocked ? output.plan_submission === null : output.plan_submission !== null,
    successNotClaimed: expected.successNotClaimed ? output.interpret_result?.next_status !== "submitted" : true,
    terminalPath: expected.terminalPath === undefined ? true : output.terminal_path === expected.terminalPath,
    procedurePromptBypassed: expected.requireProcedurePromptBypass === undefined
      ? true
      : expected.requireProcedurePromptBypass
        ? output.prompt_trace.retrieve_procedure === null
        : output.prompt_trace.retrieve_procedure !== null,
  };

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
  };
}

export function evaluateNoGroundingFallback(
  output: WorkflowSiteRunOutput,
  expected: NoGroundingFallbackExpectation,
): NoGroundingFallbackEvaluation {
  const requiredFields = output.retrieve_procedure?.required_fields ?? [];
  const checks = {
    fallbackProcedureRecovered: output.retrieve_procedure?.procedure_type === expected.procedureType,
    requiredFieldsRecovered: expected.requiredFieldNames.every((field) => requiredFields.includes(field)),
    procedureUnknownCleared: !output.context.review_reasons.includes("procedure_unknown"),
    submissionAllowed: expected.submissionAllowed ? output.plan_submission !== null : output.plan_submission === null,
    procedurePromptBypassed: output.prompt_trace.retrieve_procedure === null,
    terminalPath: expected.terminalPath === undefined ? true : output.terminal_path === expected.terminalPath,
  };

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
  };
}
