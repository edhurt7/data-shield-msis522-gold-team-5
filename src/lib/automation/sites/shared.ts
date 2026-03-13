import type { ActionHandoff, ReviewReason } from "@/lib/agent/contracts";

import {
  createAutomationArtifact,
  createContractExecutionResult,
  createExecutionRecord,
  createStepOutcome,
} from "@/lib/automation/artifacts";
import { ManualReviewRequiredAutomationError } from "@/lib/automation/errors";
import type { AutomationErrorCode } from "@/lib/automation/errors";
import type { AutomationExecutionRecord, AutomationSiteExecutor } from "@/lib/automation/types";

export function getRequiredStringField(handoff: ActionHandoff, key: string, site: string) {
  const value = handoff.payload.fields[key];

  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  throw new ManualReviewRequiredAutomationError(
    `${site} automation requires a non-empty "${key}" field.`,
  );
}

export function getOptionalStringField(handoff: ActionHandoff, key: string) {
  const value = handoff.payload.fields[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function requireSubmissionChannel(
  handoff: ActionHandoff,
  submissionChannel: ActionHandoff["payload"]["submissionChannel"],
  site: string,
) {
  if (handoff.payload.submissionChannel !== submissionChannel) {
    throw new ManualReviewRequiredAutomationError(
      `${site} automation currently supports only ${submissionChannel} submission handoffs.`,
    );
  }
}

export function findFinalPageText(record: AutomationExecutionRecord) {
  return record.evidence.artifacts
    .find((artifact) => artifact.kind === "page_text" && artifact.label === "Final page text capture")
    ?.content ?? "";
}

export function passthroughGenericFailure(input: {
  handoff: ActionHandoff;
  executorId: string;
  startedAt: string;
  completedAt: string;
  genericRecord: AutomationExecutionRecord;
}) {
  return buildGenericAdapterResult({
    handoff: input.handoff,
    executorId: input.executorId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    status: input.genericRecord.executionResult.status,
    manualReviewRequired: input.genericRecord.executionResult.manual_review_required,
    confirmationText: input.genericRecord.executionResult.confirmation_text,
    errorText: input.genericRecord.executionResult.error_text,
    failureCode: input.genericRecord.evidence.failureCode,
    reviewReasons: input.genericRecord.evidence.reviewReasons,
    genericRecord: input.genericRecord,
  });
}

export function hasAnyPhrase(text: string, phrases: readonly string[]) {
  const normalizedText = text.toLowerCase();
  return phrases.some((phrase) => normalizedText.includes(phrase));
}

export function normalizeCapturedText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function hasBlockedAccessSignal(text: string) {
  const normalized = normalizeCapturedText(text);
  const signals = [
    "403 forbidden",
    "forbidden",
    "access denied",
    "just a moment",
    "verify you are human",
    "unusual traffic",
    "too many requests",
    "temporarily blocked",
    "request blocked",
    "security check",
    "cf-browser-verification",
    "attention required",
  ];

  return signals.some((signal) => normalized.includes(signal));
}

export function hasAntiBotInterstitialSignal(text: string) {
  const normalized = normalizeCapturedText(text);
  const signals = [
    "px-captcha-modal",
    "captcha.px-cloud.net",
    "_pxappid",
    "_pxhosturl",
    "_pxjclientsrc",
    "perimeterx",
    "human verification",
  ];

  return signals.some((signal) => normalized.includes(signal));
}

export function hasEmailConfirmationSignal(text: string) {
  const normalized = normalizeCapturedText(text);
  const signals = [
    "check your inbox",
    "check your email",
    "confirmation email",
    "email confirmation",
    "verification email",
    "verify your email",
    "confirm your email",
    "click the link in the email",
    "we sent an email",
    "sent you an email",
  ];

  return signals.some((signal) => normalized.includes(signal));
}

export function hasRemovalSubmissionSignal(text: string) {
  const normalized = normalizeCapturedText(text);
  const signals = [
    "request has been received",
    "removal request has been received",
    "received your request",
    "pending review",
    "request submitted",
    "submission received",
    "opt out request",
    "suppression request",
  ];

  return signals.some((signal) => normalized.includes(signal));
}

export function matchesConfirmationText(
  text: string,
  phrases: readonly string[],
  mode: "email_confirmation" | "submission_received",
) {
  if (hasAnyPhrase(text, phrases)) {
    return true;
  }

  return mode === "email_confirmation"
    ? hasEmailConfirmationSignal(text)
    : hasRemovalSubmissionSignal(text);
}

export function buildGenericAdapterResult(input: {
  handoff: ActionHandoff;
  executorId: string;
  startedAt: string;
  completedAt: string;
  status: "pending" | "failed" | "manual_required";
  manualReviewRequired: boolean;
  confirmationText: string | null;
  errorText: string | null;
  failureCode?: AutomationErrorCode | null;
  reviewReasons?: ReviewReason[];
  genericRecord: Awaited<ReturnType<AutomationSiteExecutor["execute"]>>;
  extraArtifacts?: ReturnType<typeof createAutomationArtifact>[];
  extraStepOutcomes?: ReturnType<typeof createStepOutcome>[];
}) {
  const screenshotArtifact = [...input.genericRecord.evidence.artifacts]
    .reverse()
    .find((artifact) => artifact.kind === "screenshot");
  const executionResult = createContractExecutionResult({
    handoff: input.handoff,
    status: input.status,
    manualReviewRequired: input.manualReviewRequired,
    screenshotRef: screenshotArtifact?.ref ?? null,
    confirmationText: input.confirmationText,
    errorText: input.errorText,
  });

  return createExecutionRecord({
    handoff: input.handoff,
    executorId: input.executorId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    executionResult,
    failureCode: input.failureCode ?? null,
    reviewReasons: input.reviewReasons ?? [],
    artifacts: [...input.genericRecord.evidence.artifacts, ...(input.extraArtifacts ?? [])],
    stepOutcomes: [...input.genericRecord.evidence.stepOutcomes, ...(input.extraStepOutcomes ?? [])],
  });
}
