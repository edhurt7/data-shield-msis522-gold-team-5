import type {
  ActionHandoff,
  ExecutionResult,
  ProcedureStep,
  ReviewReason,
} from "@/lib/agent/contracts";

import type {
  AutomationArtifact,
  AutomationArtifactKind,
  AutomationEvidence,
  AutomationExecutionRecord,
  AutomationPage,
  AutomationStepLog,
  AutomationStepOutcome,
} from "@/lib/automation/types";
import type { AutomationErrorCode } from "@/lib/automation/errors";

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createArtifactId(handoff: ActionHandoff, suffix: string) {
  return `${slugify(handoff.payload.siteId)}-${slugify(handoff.handoffId)}-${slugify(suffix)}`;
}

export function createArtifactRef(handoff: ActionHandoff, suffix: string) {
  return `automation/${slugify(handoff.payload.siteId)}/${slugify(handoff.handoffId)}/${slugify(suffix)}`;
}

export function createAutomationArtifact(input: {
  handoff: ActionHandoff;
  kind: AutomationArtifactKind;
  suffix: string;
  createdAt: string;
  label: string;
  ref?: string | null;
  contentType?: string;
  content?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}): AutomationArtifact {
  return {
    artifactId: createArtifactId(input.handoff, input.suffix),
    kind: input.kind,
    label: input.label,
    createdAt: input.createdAt,
    ref: input.ref ?? createArtifactRef(input.handoff, input.suffix),
    contentType: input.contentType,
    content: input.content,
    metadata: input.metadata,
  };
}

export function createStepOutcome(input: {
  step: ProcedureStep;
  startedAt: string;
  completedAt: string;
  status: AutomationStepOutcome["status"];
  artifactIds?: string[];
  notes?: string;
}): AutomationStepOutcome {
  return {
    stepId: input.step.stepId,
    action: input.step.action,
    instruction: input.step.instruction,
    status: input.status,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    selector: input.step.selector,
    targetUrl: input.step.targetUrl,
    artifactIds: input.artifactIds ?? [],
    notes: input.notes,
  };
}

export function createContractExecutionResult(input: {
  handoff: ActionHandoff;
  status: ExecutionResult["status"];
  manualReviewRequired?: boolean;
  confirmationText?: string | null;
  screenshotRef?: string | null;
  errorText?: string | null;
  ticketIds?: string[];
}): ExecutionResult {
  return {
    site: input.handoff.payload.siteId,
    candidate_url: inferCandidateUrl(input.handoff),
    status: input.status,
    manual_review_required: input.manualReviewRequired ?? input.status === "manual_required",
    confirmation_text: input.confirmationText ?? null,
    ticket_ids: input.ticketIds ?? [],
    screenshot_ref: input.screenshotRef ?? null,
    error_text: input.errorText ?? null,
  };
}

export function inferCandidateUrl(handoff: ActionHandoff) {
  const candidateUrlField = handoff.payload.fields.candidate_url;
  if (typeof candidateUrlField === "string" && /^https?:\/\//.test(candidateUrlField)) {
    return candidateUrlField;
  }

  const listingUrlField = handoff.payload.fields.listing_url;
  if (typeof listingUrlField === "string" && /^https?:\/\//.test(listingUrlField)) {
    return listingUrlField;
  }

  const targetStep = handoff.payload.steps.find((step) => step.targetUrl);
  if (targetStep?.targetUrl) {
    return targetStep.targetUrl;
  }

  throw new Error(`Automation handoff ${handoff.handoffId} is missing a candidate URL field or target step URL.`);
}

export function createExecutionRecord(input: {
  handoff: ActionHandoff;
  executorId: string;
  startedAt: string;
  completedAt: string;
  executionResult: ExecutionResult;
  failureCode?: AutomationErrorCode | null;
  reviewReasons?: ReviewReason[];
  artifacts?: AutomationArtifact[];
  stepOutcomes?: AutomationStepOutcome[];
}): AutomationExecutionRecord {
  return {
    handoff: input.handoff,
    executionResult: input.executionResult,
    evidence: {
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      siteId: input.handoff.payload.siteId,
      handoffId: input.handoff.handoffId,
      executorId: input.executorId,
      failureCode: input.failureCode ?? null,
      reviewReasons: input.reviewReasons ?? [],
      artifacts: input.artifacts ?? [],
      stepOutcomes: input.stepOutcomes ?? [],
    } satisfies AutomationEvidence,
  };
}

export async function capturePageScreenshot(input: {
  handoff: ActionHandoff;
  page: AutomationPage;
  createdAt: string;
  suffix: string;
  label: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}) {
  const screenshot = await input.page.screenshot({ type: "png" });

  return createAutomationArtifact({
    handoff: input.handoff,
    kind: "screenshot",
    suffix: input.suffix,
    createdAt: input.createdAt,
    label: input.label,
    contentType: "image/png",
    content: screenshot.toString("base64"),
    metadata: input.metadata,
  });
}

export async function capturePageHtml(input: {
  handoff: ActionHandoff;
  page: AutomationPage;
  createdAt: string;
  suffix: string;
  label: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}) {
  const html = await input.page.content();

  return createAutomationArtifact({
    handoff: input.handoff,
    kind: "html_snapshot",
    suffix: input.suffix,
    createdAt: input.createdAt,
    label: input.label,
    contentType: "text/html",
    content: html,
    metadata: input.metadata,
  });
}

export async function capturePageText(input: {
  handoff: ActionHandoff;
  page: AutomationPage;
  createdAt: string;
  suffix: string;
  label: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}) {
  const text = await input.page.innerText("body");

  return createAutomationArtifact({
    handoff: input.handoff,
    kind: "page_text",
    suffix: input.suffix,
    createdAt: input.createdAt,
    label: input.label,
    contentType: "text/plain",
    content: text ?? "",
    metadata: input.metadata,
  });
}

export function createStepLogArtifact(input: {
  handoff: ActionHandoff;
  createdAt: string;
  stepLogs: AutomationStepLog[];
  suffix?: string;
  label?: string;
}) {
  return createAutomationArtifact({
    handoff: input.handoff,
    kind: "execution_log",
    suffix: input.suffix ?? "step-log",
    createdAt: input.createdAt,
    label: input.label ?? "Automation step log",
    contentType: "application/json",
    content: JSON.stringify(input.stepLogs, null, 2),
    metadata: {
      step_count: input.stepLogs.length,
    },
  });
}
