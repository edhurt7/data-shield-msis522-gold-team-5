import { z } from "zod";

import {
  type AgentRunPhase,
  type AgentRunState,
  type AgentRunStatus,
  type Evidence,
  type ExtractedField,
  type IntentAction,
  type ListingCandidate,
  type MatchDecision,
  type MonitoredTarget,
  type MonitoredTargetSet,
  type MonitoredTargetSetStatus,
  type OptOutDraft,
  type ProcedureInputRequirement,
  type ProcedureSelection,
  type ProcedureStep,
  type ReviewReason,
  type SearchTarget,
  type WorkflowEvent,
  discoveryResultSchema,
  actionHandoffSchema,
  agentRunStateSchema,
  executionResultSchema,
  monitoredTargetSchema,
  monitoredTargetSetSchema,
  procedureSourceChunkSchema,
  searchProfileSchema,
  seedProfileSchema,
  submissionPayloadSchema,
  userIntentSchema,
  workflowEventSchema,
} from "@/lib/agent/contracts";
import type { WorkflowRunOutput, WorkflowSiteRunOutput } from "@/lib/agent/workflow";

export const apiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
});

export const createRunRequestSchema = z.object({
  profile: searchProfileSchema,
  intent: userIntentSchema,
});

export const startAgentRunRequestSchema = z.object({
  seed_profile: seedProfileSchema,
  request_text: z.string().min(1),
  requested_sites: z.array(z.string().min(1)).default([]),
});

export const createRunResponseSchema = z.object({
  run: agentRunStateSchema,
});

export const startAgentRunResponseSchema = z.object({
  run: agentRunStateSchema,
  events: z.array(workflowEventSchema).default([]),
});

export const retrieveProceduresRequestSchema = z.object({
  seed_profile: seedProfileSchema,
  discovery_result: discoveryResultSchema,
  site: z.string().min(1),
});

export const backendProcedureSourceChunkSchema = procedureSourceChunkSchema.pipe(z.object({
  doc_id: z.string().min(1),
  quote: z.string().min(1),
  source_id: z.string().min(1),
  source_updated_at: z.string().datetime().nullable(),
  retrieved_at: z.string().datetime().nullable(),
}));

export const backendProcedureRecordSchema = z.object({
  procedure_id: z.string().min(1),
  site: z.string().min(1),
  updated_at: z.string().datetime(),
  channel_hint: z.enum(["email", "webform", "unknown"]),
  source_chunks: z.array(backendProcedureSourceChunkSchema).min(1),
});

export const retrieveProceduresResponseSchema = z.object({
  site: z.string().min(1),
  retrieved_at: z.string().datetime(),
  procedures: z.array(backendProcedureRecordSchema).default([]),
});

export const getRunResponseSchema = z.object({
  run: agentRunStateSchema,
});

export const listRunsResponseSchema = z.object({
  runs: z.array(agentRunStateSchema),
});

export const sendChatCommandRequestSchema = z.object({
  message: z.string().min(1),
});

export const chatMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
  createdAt: z.string().datetime(),
});

export const sendChatCommandResponseSchema = z.object({
  message: chatMessageSchema,
  run: agentRunStateSchema,
  events: z.array(workflowEventSchema).default([]),
});

export const approvalActionSchema = z.enum(["approve", "reject", "request_changes"]);

export const submitApprovalRequestSchema = z.object({
  action: approvalActionSchema,
  siteIds: z.array(z.string().min(1)).default([]),
  note: z.string().optional(),
});

export const submitApprovalResponseSchema = z.object({
  run: agentRunStateSchema,
  events: z.array(workflowEventSchema).default([]),
  handoffs: z.array(actionHandoffSchema).default([]),
});

export const triggerRescanRequestSchema = z.object({
  siteIds: z.array(z.string().min(1)).default([]),
  reason: z.string().optional(),
});

export const triggerRescanResponseSchema = z.object({
  run: agentRunStateSchema,
  events: z.array(workflowEventSchema).default([]),
});

export const appendExecutionResultRequestSchema = z.intersection(
  executionResultSchema,
  z.object({
    handoffId: z.string().min(1).optional(),
  }),
);

export const appendExecutionResultResponseSchema = z.object({
  run: agentRunStateSchema,
  events: z.array(workflowEventSchema).default([]),
});

export const planSubmissionRequestSchema = z.object({
  site: z.string().min(1),
  candidate_url: z.string().url(),
  payload: submissionPayloadSchema,
});

export const planSubmissionResponseSchema = z.object({
  accepted: z.boolean(),
  handoffs: z.array(actionHandoffSchema).default([]),
});

export const createMonitoredTargetSetFromRunRequestSchema = z.object({
  profileId: z.string().min(1),
  targetSetId: z.string().min(1).optional(),
});

export const createMonitoredTargetSetFromRunResponseSchema = z.object({
  targetSet: monitoredTargetSetSchema,
});

export const getMonitoredTargetSetResponseSchema = z.object({
  targetSet: monitoredTargetSetSchema,
});

export const listMonitoredTargetSetsResponseSchema = z.object({
  targetSets: z.array(monitoredTargetSetSchema).default([]),
});

export interface WorkflowRunApiMappingOptions {
  profileId?: string;
  requestText?: string;
  requestedActions?: IntentAction[];
  requestedSites?: string[];
  geographicHint?: string;
  requiresUserApprovalBeforeSubmission?: boolean;
  currentPhase?: AgentRunPhase;
  status?: AgentRunStatus;
  createdAt?: string;
  updatedAt?: string;
  timeline?: WorkflowEvent[];
}

export interface WorkflowRunMonitoredTargetSetMappingOptions {
  profileId: string;
  targetSetId?: string;
  createdAt?: string;
  updatedAt?: string;
  status?: MonitoredTargetSetStatus;
}

function normalizeApiSiteId(site: string) {
  return site.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function dedupeReviewReasons(reasons: ReviewReason[]) {
  return [...new Set(reasons)];
}

function splitProfileName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? fullName;
  const lastName = parts.slice(1).join(" ") || fullName;

  return { firstName, lastName };
}

function collectSiteReviewReasons(siteRun: WorkflowSiteRunOutput): ReviewReason[] {
  return dedupeReviewReasons([
    ...siteRun.context.review_reasons,
    ...(siteRun.plan_submission?.review_reasons ?? []),
    ...(siteRun.interpret_result?.review_reasons ?? []),
    ...(siteRun.automation_record?.evidence.reviewReasons ?? []),
  ]);
}

function buildCandidateExtractedFields(siteRun: WorkflowSiteRunOutput): ExtractedField[] {
  const candidate = siteRun.discovery_parse.candidates[0];
  if (!candidate) {
    return [];
  }

  return [
    { field: "name", value: candidate.extracted.name },
    ...(candidate.extracted.age ? [{ field: "age", value: candidate.extracted.age }] : []),
    ...candidate.extracted.addresses.map((address) => ({ field: "address", value: address })),
    ...candidate.extracted.relatives.map((relative) => ({ field: "relative", value: relative })),
    ...candidate.extracted.phones.map((phone) => ({ field: "phone", value: phone })),
  ];
}

function buildCandidateEvidence(siteRun: WorkflowSiteRunOutput): Evidence[] {
  const candidate = siteRun.discovery_parse.candidates[0];
  if (!candidate) {
    return [
      {
        sourceType: "listing_page",
        sourceUrl: siteRun.site_input.page_artifact.url,
        excerpt: siteRun.discovery_parse.notes ?? "No likely match found in the captured page.",
        capturedAt: siteRun.discovery_parse.scan_timestamp,
        fields: [],
      },
    ];
  }

  return candidate.evidence_snippets.map((snippet) => ({
    sourceType: "listing_page" as const,
    sourceUrl: candidate.url,
    excerpt: snippet,
    capturedAt: siteRun.discovery_parse.scan_timestamp,
    fields: buildCandidateExtractedFields(siteRun),
  }));
}

function mapSiteRunToListingCandidate(siteRun: WorkflowSiteRunOutput): ListingCandidate | null {
  const candidate = siteRun.discovery_parse.candidates[0];
  if (!candidate) {
    return null;
  }

  return {
    candidateId: siteRun.match_decision?.candidateId ?? candidate.url,
    siteId: normalizeApiSiteId(siteRun.site_input.site),
    siteName: siteRun.site_input.site,
    listingUrl: candidate.url,
    displayName: candidate.extracted.name,
    extractedFields: buildCandidateExtractedFields(siteRun),
    evidence: buildCandidateEvidence(siteRun),
  };
}

function inferProcedureInputSource(key: string): ProcedureInputRequirement["source"] {
  if (key === "privacy_email") return "system";
  if (["full_name", "approx_age"].includes(key)) return "profile";
  if (["candidate_url", "address", "phone_last4"].includes(key)) return "listing";
  return "user";
}

function inferProcedureStepAction(instruction: string): ProcedureStep["action"] {
  const normalized = instruction.toLowerCase();

  if (normalized.includes("navigate") || normalized.includes("open ")) return "navigate";
  if (normalized.includes("search")) return "search";
  if (normalized.includes("fill") || normalized.includes("enter")) return "fill";
  if (normalized.includes("select") || normalized.includes("choose")) return "select";
  if (normalized.includes("submit")) return "submit";
  if (normalized.includes("click") || normalized.includes("check the consent checkbox")) return "click";
  if (normalized.includes("wait")) return "wait";
  if (normalized.includes("email")) return "check_email";
  return "manual_review";
}

function mapSiteRunToProcedureSelection(siteRun: WorkflowSiteRunOutput): ProcedureSelection | null {
  const procedure = siteRun.retrieve_procedure;
  if (!procedure || procedure.procedure_type === "procedure_unknown") {
    return null;
  }
  const steps = (procedure.steps.length > 0 ? procedure.steps : [`Review ${siteRun.site_input.site} procedure manually.`])
    .map((instruction, index) => ({
      stepId: `${normalizeApiSiteId(siteRun.site_input.site)}_step_${index + 1}`,
      action: inferProcedureStepAction(instruction),
      instruction,
      required: true,
    }));

  const retrievedAt = procedure.source_chunks[0]?.retrieved_at
    ?? procedure.source_chunks[0]?.source_updated_at
    ?? siteRun.discovery_parse.scan_timestamp;
  const sourceUpdatedAt = procedure.source_chunks[0]?.source_updated_at;
  const freshnessDays = sourceUpdatedAt
    ? Math.max(
      0,
      Math.floor((Date.parse(retrievedAt) - Date.parse(sourceUpdatedAt)) / (24 * 60 * 60 * 1000)),
    )
    : 0;

  return {
    siteId: normalizeApiSiteId(siteRun.site_input.site),
    procedureId: `${normalizeApiSiteId(siteRun.site_input.site)}_procedure`,
    source: procedure.source_chunks.length > 0 ? "rag" : "manual",
    sourceDocumentUri: procedure.source_chunks[0]?.source_id ?? procedure.source_chunks[0]?.doc_id ?? "workflow://generated",
    sourceVersion: sourceUpdatedAt ?? "workflow-v1",
    retrievedAt,
    submissionChannel: procedure.procedure_type,
    freshnessDays,
    isComplete: procedure.required_fields.length > 0 && procedure.steps.length > 0,
    requiredInputs: procedure.required_fields.map((key) => ({
      key,
      label: key.replace(/_/g, " "),
      required: true,
      source: inferProcedureInputSource(key),
    })),
    steps,
    reviewReasons: collectSiteReviewReasons(siteRun),
  };
}

function buildDraftBody(siteRun: WorkflowSiteRunOutput) {
  if (siteRun.draft_optout?.email) {
    return siteRun.draft_optout.email.body;
  }

  if (siteRun.draft_optout?.webform) {
    return [
      `Webform draft for ${siteRun.site_input.site}:`,
      ...siteRun.draft_optout.webform.fields.map((field) => `${field.name}: ${field.value}`),
    ].join("\n");
  }

  return `Workflow-generated draft for ${siteRun.site_input.site}.`;
}

function mapSiteRunToDraft(siteRun: WorkflowSiteRunOutput): OptOutDraft | null {
  if (!siteRun.draft_optout) {
    return null;
  }

  const candidateId = siteRun.match_decision?.candidateId
    ?? siteRun.discovery_parse.candidates[0]?.url
    ?? siteRun.site_input.page_artifact.url;

  return {
    draftId: `${normalizeApiSiteId(siteRun.site_input.site)}_draft`,
    siteId: normalizeApiSiteId(siteRun.site_input.site),
    candidateId,
    submissionChannel: siteRun.draft_optout.submission_channel,
    subject: siteRun.draft_optout.email?.subject,
    body: buildDraftBody(siteRun),
    factsUsed: [
      ...siteRun.draft_optout.required_fields.map((field) => ({ field: field.name, value: field.value })),
      ...siteRun.draft_optout.optional_fields.map((field) => ({ field: field.name, value: field.value })),
    ],
    procedureId: `${normalizeApiSiteId(siteRun.site_input.site)}_procedure`,
    generatedAt: siteRun.discovery_parse.scan_timestamp,
  };
}

function mapExecutionStatus(status: "submitted" | "pending" | "failed" | "manual_required") {
  if (status === "failed") return "failed" as const;
  if (status === "submitted") return "submitted" as const;
  return "needs_follow_up" as const;
}

function mapSiteRunToOutcome(siteRun: WorkflowSiteRunOutput) {
  const executionResult = siteRun.automation_record?.executionResult ?? siteRun.site_input.execution_result;
  if (!executionResult) {
    return null;
  }

  const candidateId = siteRun.match_decision?.candidateId
    ?? siteRun.discovery_parse.candidates[0]?.url
    ?? executionResult.candidate_url;
  const excerpt = executionResult.error_text
    ?? executionResult.confirmation_text
    ?? `Execution result recorded for ${siteRun.site_input.site}.`;

  return {
    siteId: normalizeApiSiteId(siteRun.site_input.site),
    candidateId,
    status: mapExecutionStatus(executionResult.status),
    confirmationId: executionResult.ticket_ids[0],
    observedAt: siteRun.automation_record?.evidence.completedAt ?? siteRun.discovery_parse.scan_timestamp,
    evidence: [
      {
        sourceType: "execution_log" as const,
        excerpt,
        capturedAt: siteRun.automation_record?.evidence.completedAt ?? siteRun.discovery_parse.scan_timestamp,
        sourceUrl: executionResult.candidate_url,
        fields: [],
      },
    ],
    reviewReasons: collectSiteReviewReasons(siteRun),
  };
}

function deriveRequestedActions(output: WorkflowRunOutput, options: WorkflowRunApiMappingOptions): IntentAction[] {
  if (options.requestedActions && options.requestedActions.length > 0) {
    return options.requestedActions;
  }

  const hasSubmissionArtifacts = output.site_runs.some((siteRun) => (
    siteRun.draft_optout !== null
    || siteRun.plan_submission !== null
    || siteRun.interpret_result !== null
    || siteRun.site_input.execution_result !== undefined
  ));

  return hasSubmissionArtifacts ? ["scan_only", "submit_opt_out"] : ["scan_only"];
}

function deriveCurrentPhase(output: WorkflowRunOutput): AgentRunPhase {
  if (output.site_runs.some((siteRun) => siteRun.terminal_path === null)) {
    if (output.site_runs.some((siteRun) => siteRun.plan_submission !== null)) return "approval";
    if (output.site_runs.some((siteRun) => siteRun.draft_optout !== null)) return "draft";
    if (output.site_runs.some((siteRun) => siteRun.retrieve_procedure !== null)) return "retrieve_procedure";
    if (output.site_runs.some((siteRun) => siteRun.match_decision?.decision !== "no_match")) return "match";
    return "scan";
  }

  if (output.site_runs.some((siteRun) => siteRun.interpret_result !== null || siteRun.site_input.execution_result !== undefined)) {
    return "verification";
  }

  if (output.site_runs.some((siteRun) => siteRun.plan_submission !== null)) return "approval";
  if (output.site_runs.some((siteRun) => siteRun.draft_optout !== null)) return "draft";
  if (output.site_runs.some((siteRun) => siteRun.retrieve_procedure !== null)) return "retrieve_procedure";
  if (output.site_runs.some((siteRun) => siteRun.match_decision?.decision !== "no_match")) return "match";
  return "completed";
}

function deriveStatus(output: WorkflowRunOutput): AgentRunStatus {
  if (output.site_runs.some((siteRun) => siteRun.terminal_path === null)) {
    return "in_progress";
  }

  if (
    output.run_summary.overall_status === "awaiting_review"
    || output.site_runs.some((siteRun) => siteRun.plan_submission?.requires_manual_review)
    || output.site_runs.some((siteRun) => siteRun.terminal_path === "await_confirmation")
  ) {
    return "awaiting_user";
  }

  if (output.run_summary.overall_status === "partial_success" && output.run_summary.blocked_sites > 0) {
    return "blocked";
  }

  if (output.run_summary.overall_status === "completed" || output.run_summary.overall_status === "partial_success") {
    return "completed";
  }

  return "in_progress";
}

function buildSearchTargets(output: WorkflowRunOutput, requestedSites: string[]): SearchTarget[] {
  const seedProfile = output.validate_consent.seed_profile;
  const query = `${seedProfile.full_name} ${seedProfile.location.city} ${seedProfile.location.state}`.trim();
  const sites = requestedSites.length > 0
    ? requestedSites
    : output.site_runs.map((siteRun) => siteRun.site_input.site);

  return sites.map((site) => ({
    siteId: normalizeApiSiteId(site),
    siteName: site,
    query,
    jurisdictionHint: seedProfile.location.state,
  }));
}

function buildSyntheticWorkflowEvents(output: WorkflowRunOutput): WorkflowEvent[] {
  return output.site_runs.map((siteRun, index) => {
    const siteId = normalizeApiSiteId(siteRun.site_input.site);
    const phase = siteRun.interpret_result
      ? "verification"
      : siteRun.plan_submission
        ? "approval"
        : siteRun.draft_optout
          ? "draft"
          : siteRun.retrieve_procedure
            ? "retrieve_procedure"
            : siteRun.match_decision?.decision !== "no_match"
              ? "match"
              : "scan";
    const status = siteRun.terminal_path === null
      ? "in_progress"
      : siteRun.terminal_path === "await_confirmation" || siteRun.plan_submission?.requires_manual_review
        ? "awaiting_user"
        : siteRun.terminal_path === "site_unreachable" || siteRun.terminal_path === "blocked"
          ? "failed"
          : "completed";
    const message = siteRun.interpret_result?.next_status === "submitted"
      ? `Opt-out submitted for ${siteRun.site_input.site}.`
      : siteRun.interpret_result?.next_status === "pending"
        ? `Opt-out submitted for ${siteRun.site_input.site}; awaiting confirmation.`
        : siteRun.discovery_parse.found
          ? `Listing found on ${siteRun.site_input.site}.`
          : `Scan complete - not found on ${siteRun.site_input.site}.`;

    return {
      eventId: `evt_${phase}_${siteId}_${index + 1}`,
      runId: output.context.run_id,
      phase,
      status,
      message,
      createdAt: siteRun.automation_record?.evidence.completedAt ?? siteRun.discovery_parse.scan_timestamp,
      siteId,
      candidateId: siteRun.match_decision?.candidateId,
      reviewReasons: collectSiteReviewReasons(siteRun),
    };
  });
}

function collectWorkflowTimestamps(output: WorkflowRunOutput) {
  const values = [
    ...output.site_runs.map((siteRun) => siteRun.discovery_parse.scan_timestamp),
    ...output.site_runs.flatMap((siteRun) => [
      siteRun.automation_record?.evidence.startedAt,
      siteRun.automation_record?.evidence.completedAt,
    ].filter((value): value is string => Boolean(value))),
    ...output.context.events.map((event) => event.createdAt),
  ].sort((left, right) => left.localeCompare(right));

  return {
    createdAt: values[0] ?? new Date().toISOString(),
    updatedAt: values.at(-1) ?? new Date().toISOString(),
  };
}

function mapMonitoringStatusToTargetStatus(siteRun: WorkflowSiteRunOutput): MonitoredTarget["monitoringStatus"] | null {
  switch (siteRun.monitoring.status) {
    case "scheduled":
      return "scheduled";
    case "awaiting_confirmation":
      return "awaiting_confirmation";
    case "rescan_due":
      return "rescan_due";
    case "manual_review":
      return "manual_review";
    default:
      return null;
  }
}

function mapSiteRunToMonitoredTarget(siteRun: WorkflowSiteRunOutput, runId: string): MonitoredTarget | null {
  const monitoringStatus = mapMonitoringStatusToTargetStatus(siteRun);
  if (!monitoringStatus) {
    return null;
  }

  const outcome = mapSiteRunToOutcome(siteRun);
  const candidateId = siteRun.match_decision?.candidateId ?? siteRun.discovery_parse.candidates[0]?.url ?? null;
  const candidateUrl = siteRun.discovery_parse.candidates[0]?.url
    ?? siteRun.site_input.execution_result?.candidate_url
    ?? null;
  const updatedAt = outcome?.observedAt ?? siteRun.monitoring.last_scan_at;

  return monitoredTargetSchema.parse({
    targetId: `${runId}:${normalizeApiSiteId(siteRun.site_input.site)}`,
    siteId: normalizeApiSiteId(siteRun.site_input.site),
    siteName: siteRun.site_input.site,
    sourceRunId: runId,
    sourceSiteRunId: normalizeApiSiteId(siteRun.site_input.site),
    candidateId,
    candidateUrl,
    lastScanAt: siteRun.monitoring.last_scan_at,
    nextScanAt: siteRun.monitoring.next_scan_at,
    cooldownEndsAt: siteRun.monitoring.cooldown_ends_at,
    monitoringStatus,
    reviewReasons: collectSiteReviewReasons(siteRun),
    triggerNewRemovalCycle: siteRun.monitoring.trigger_new_removal_cycle,
    reappearanceCount: siteRun.monitoring.reappearance_count,
    latestOutcome: outcome
      ? {
        status: outcome.status,
        confirmationId: outcome.confirmationId,
        observedAt: outcome.observedAt,
        reviewReasons: outcome.reviewReasons,
      }
      : null,
    createdAt: siteRun.monitoring.last_scan_at,
    updatedAt,
  });
}

export function mapWorkflowRunOutputToWorkflowEvents(
  output: WorkflowRunOutput,
  options: WorkflowRunApiMappingOptions = {},
): WorkflowEvent[] {
  return (options.timeline && options.timeline.length > 0 ? options.timeline : buildSyntheticWorkflowEvents(output))
    .map((event) => workflowEventSchema.parse(event));
}

export function mapWorkflowRunOutputToAgentRunState(
  output: WorkflowRunOutput,
  options: WorkflowRunApiMappingOptions = {},
): AgentRunState {
  const seedProfile = output.validate_consent.seed_profile;
  const { firstName, lastName } = splitProfileName(seedProfile.full_name);
  const requestedSites = options.requestedSites && options.requestedSites.length > 0
    ? options.requestedSites
    : output.run_summary.requested_sites.length > 0
      ? output.run_summary.requested_sites
      : output.site_runs.map((siteRun) => siteRun.site_input.site);
  const timestamps = collectWorkflowTimestamps(output);
  const timeline = mapWorkflowRunOutputToWorkflowEvents(output, options);
  const candidates = output.site_runs
    .map(mapSiteRunToListingCandidate)
    .filter((candidate): candidate is ListingCandidate => candidate !== null);
  const matchDecisions = output.site_runs
    .map((siteRun) => siteRun.match_decision)
    .filter((decision): decision is MatchDecision => decision !== null);
  const procedures = output.site_runs
    .map(mapSiteRunToProcedureSelection)
    .filter((procedure): procedure is ProcedureSelection => procedure !== null);
  const drafts = output.site_runs
    .map(mapSiteRunToDraft)
    .filter((draft): draft is OptOutDraft => draft !== null);
  const outcomes = output.site_runs
    .map(mapSiteRunToOutcome)
    .filter((outcome): outcome is NonNullable<ReturnType<typeof mapSiteRunToOutcome>> => outcome !== null);
  const handoffs = output.site_runs
    .flatMap((siteRun) => siteRun.automation_record?.handoff ? [siteRun.automation_record.handoff] : []);

  return agentRunStateSchema.parse({
    runId: output.context.run_id,
    profile: {
      profileId: options.profileId ?? `profile_${output.context.run_id}`,
      firstName,
      lastName,
      city: seedProfile.location.city,
      state: seedProfile.location.state,
      proxyEmail: seedProfile.privacy_email,
    },
    intent: {
      requestText: options.requestText ?? output.validate_consent.normalized_query,
      requestedActions: deriveRequestedActions(output, options),
      requestedSites,
      geographicHint: options.geographicHint ?? seedProfile.location.city,
      requiresUserApprovalBeforeSubmission: options.requiresUserApprovalBeforeSubmission ?? true,
    },
    currentPhase: options.currentPhase ?? deriveCurrentPhase(output),
    status: options.status ?? deriveStatus(output),
    consentConfirmed: output.validate_consent.approved_for_submission,
    targets: buildSearchTargets(output, requestedSites),
    candidates,
    matchDecisions,
    procedures,
    drafts,
    handoffs,
    outcomes,
    pendingReviewReasons: dedupeReviewReasons(output.site_runs.flatMap((siteRun) => collectSiteReviewReasons(siteRun))),
    timeline,
    createdAt: options.createdAt ?? timestamps.createdAt,
    updatedAt: options.updatedAt ?? timestamps.updatedAt,
  });
}

export function mapWorkflowRunOutputToMonitoredTargetSet(
  output: WorkflowRunOutput,
  options: WorkflowRunMonitoredTargetSetMappingOptions,
): MonitoredTargetSet {
  const targets = output.site_runs
    .map((siteRun) => mapSiteRunToMonitoredTarget(siteRun, output.context.run_id))
    .filter((target): target is MonitoredTarget => target !== null);
  const timestamps = collectWorkflowTimestamps(output);
  const activeTargetCount = targets.filter((target) => target.monitoringStatus === "scheduled").length;
  const needsAttentionCount = targets.filter((target) => (
    target.monitoringStatus === "awaiting_confirmation"
    || target.monitoringStatus === "rescan_due"
    || target.monitoringStatus === "manual_review"
  )).length;
  const derivedStatus: MonitoredTargetSetStatus = needsAttentionCount > 0 ? "needs_attention" : "active";

  return monitoredTargetSetSchema.parse({
    targetSetId: options.targetSetId ?? `mts_${output.context.run_id}`,
    sourceRunId: output.context.run_id,
    profileId: options.profileId,
    profileName: output.validate_consent.seed_profile.full_name,
    status: options.status ?? derivedStatus,
    monitoringPolicy: {
      cadenceDays: output.context.policy.monitoring_cadence_days,
      reReviewCooldownDays: output.context.policy.re_review_cooldown_days,
      reReviewListingReappearanceThreshold: output.context.policy.re_review_listing_reappearance_threshold,
    },
    targetCount: targets.length,
    activeTargetCount,
    needsAttentionCount,
    targets,
    materializedFromRunAt: timestamps.updatedAt,
    createdAt: options.createdAt ?? timestamps.updatedAt,
    updatedAt: options.updatedAt ?? timestamps.updatedAt,
    storageBacked: false,
  });
}

export const agentApiPaths = {
  runs: "/api/agent/runs",
  startRun: "/api/agent/runs/start",
  retrieveProcedures: "/api/agent/procedures/retrieve",
  monitoredTargetSets: "/api/agent/monitoring/target-sets",
  run: (runId: string) => `/api/agent/runs/${runId}`,
  runChat: (runId: string) => `/api/agent/runs/${runId}/chat`,
  runApproval: (runId: string) => `/api/agent/runs/${runId}/approval`,
  runRescan: (runId: string) => `/api/agent/runs/${runId}/rescan`,
  runMonitoredTargetSet: (runId: string) => `/api/agent/runs/${runId}/monitored-target-set`,
  runExecutionResults: (runId: string) => `/api/agent/runs/${runId}/execution-results`,
  runPlanSubmission: (runId: string) => `/api/agent/runs/${runId}/plan-submission`,
  monitoredTargetSet: (targetSetId: string) => `/api/agent/monitoring/target-sets/${targetSetId}`,
} as const;

export type ApiError = z.infer<typeof apiErrorSchema>;
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;
export type StartAgentRunRequest = z.infer<typeof startAgentRunRequestSchema>;
export type CreateRunResponse = z.infer<typeof createRunResponseSchema>;
export type StartAgentRunResponse = z.infer<typeof startAgentRunResponseSchema>;
export type RetrieveProceduresRequest = z.infer<typeof retrieveProceduresRequestSchema>;
export type BackendProcedureSourceChunk = z.infer<typeof backendProcedureSourceChunkSchema>;
export type BackendProcedureRecord = z.infer<typeof backendProcedureRecordSchema>;
export type RetrieveProceduresResponse = z.infer<typeof retrieveProceduresResponseSchema>;
export type GetRunResponse = z.infer<typeof getRunResponseSchema>;
export type ListRunsResponse = z.infer<typeof listRunsResponseSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type SendChatCommandRequest = z.infer<typeof sendChatCommandRequestSchema>;
export type SendChatCommandResponse = z.infer<typeof sendChatCommandResponseSchema>;
export type ApprovalAction = z.infer<typeof approvalActionSchema>;
export type SubmitApprovalRequest = z.infer<typeof submitApprovalRequestSchema>;
export type SubmitApprovalResponse = z.infer<typeof submitApprovalResponseSchema>;
export type TriggerRescanRequest = z.infer<typeof triggerRescanRequestSchema>;
export type TriggerRescanResponse = z.infer<typeof triggerRescanResponseSchema>;
export type AppendExecutionResultRequest = z.infer<typeof appendExecutionResultRequestSchema>;
export type AppendExecutionResultResponse = z.infer<typeof appendExecutionResultResponseSchema>;
export type PlanSubmissionRequest = z.infer<typeof planSubmissionRequestSchema>;
export type PlanSubmissionResponse = z.infer<typeof planSubmissionResponseSchema>;
export type CreateMonitoredTargetSetFromRunRequest = z.infer<typeof createMonitoredTargetSetFromRunRequestSchema>;
export type CreateMonitoredTargetSetFromRunResponse = z.infer<typeof createMonitoredTargetSetFromRunResponseSchema>;
export type GetMonitoredTargetSetResponse = z.infer<typeof getMonitoredTargetSetResponseSchema>;
export type ListMonitoredTargetSetsResponse = z.infer<typeof listMonitoredTargetSetsResponseSchema>;
