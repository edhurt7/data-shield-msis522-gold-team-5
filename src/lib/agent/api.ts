import { z } from "zod";

import {
  actionHandoffSchema,
  agentRunStateSchema,
  discoveryResultSchema,
  executionResultSchema,
  procedureSourceChunkSchema,
  searchProfileSchema,
  seedProfileSchema,
  submissionPayloadSchema,
  userIntentSchema,
  workflowEventSchema,
} from "@/lib/agent/contracts";
import type { WorkflowRunOutput } from "@/lib/agent/workflow";

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

export const getRunResponseSchema = z.object({
  run: agentRunStateSchema,
});

export const listRunsResponseSchema = z.object({
  runs: z.array(agentRunStateSchema),
});

export const retrieveProceduresRequestSchema = z.object({
  seed_profile: seedProfileSchema,
  discovery_result: discoveryResultSchema,
  site: z.string().min(1),
  provided_chunks: z.array(procedureSourceChunkSchema).default([]),
  registry_chunks: z.array(procedureSourceChunkSchema).default([]),
});

export const backendProcedureSourceChunkSchema = z.object({
  doc_id: z.string().min(1),
  quote: z.string().min(1),
  source_id: z.string().min(1).optional(),
  source_updated_at: z.string().datetime().nullable().optional(),
  retrieved_at: z.string().datetime().nullable().optional(),
});

export const backendProcedureRecordSchema = z.object({
  procedure_id: z.string().min(1),
  site: z.string().min(1),
  updated_at: z.string().datetime(),
  channel_hint: z.enum(["email", "webform", "unknown"]),
  source_chunks: z.array(backendProcedureSourceChunkSchema).default([]),
  score: z.number().optional(),
  lexical_score: z.number().optional(),
  embedding_score: z.number().optional(),
  freshness_days: z.number().int().nonnegative().optional(),
  summary: z.string().optional(),
});

export const retrieveProceduresResponseSchema = z.object({
  site: z.string().min(1),
  retrieved_at: z.string().datetime(),
  procedures: z.array(backendProcedureRecordSchema).default([]),
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

export const listChatMessagesResponseSchema = z.object({
  messages: z.array(chatMessageSchema).default([]),
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

export const monitoredTargetSchema = z.object({
  siteId: z.string().min(1),
  candidateId: z.string().min(1),
  candidateUrl: z.string().url(),
  monitoringStatus: z.enum(["active", "awaiting_confirmation", "needs_attention", "suppressed"]),
  latestStatus: z.string().min(1),
  triggerNewRemovalCycle: z.boolean(),
});

export const monitoringPolicySchema = z.object({
  cadenceDays: z.number().int().positive(),
  reReviewCooldownDays: z.number().int().positive(),
  reReviewListingReappearanceThreshold: z.number().int().positive(),
});

export const monitoredTargetSetSchema = z.object({
  targetSetId: z.string().min(1),
  sourceRunId: z.string().min(1),
  profileId: z.string().min(1),
  profileName: z.string().min(1),
  status: z.enum(["active", "needs_attention", "completed"]),
  monitoringPolicy: monitoringPolicySchema,
  targetCount: z.number().int().nonnegative(),
  activeTargetCount: z.number().int().nonnegative(),
  needsAttentionCount: z.number().int().nonnegative(),
  targets: z.array(monitoredTargetSchema).default([]),
  materializedFromRunAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  storageBacked: z.boolean().default(false),
});

export const createMonitoredTargetSetFromRunRequestSchema = z.object({
  profileId: z.string().min(1),
});

export const createMonitoredTargetSetFromRunResponseSchema = z.object({
  targetSet: monitoredTargetSetSchema,
});

export const listMonitoredTargetSetsResponseSchema = z.object({
  targetSets: z.array(monitoredTargetSetSchema).default([]),
});

export const getMonitoredTargetSetResponseSchema = z.object({
  targetSet: monitoredTargetSetSchema,
});

export const agentApiPaths = {
  runs: "/api/agent/runs",
  startRun: "/api/agent/runs/start",
  retrieveProcedures: "/api/procedures/retrieve",
  monitoredTargetSets: "/api/monitoring/target-sets",
  run: (runId: string) => `/api/agent/runs/${runId}`,
  runMessages: (runId: string) => `/api/agent/runs/${runId}/messages`,
  runChat: (runId: string) => `/api/agent/runs/${runId}/chat`,
  runApproval: (runId: string) => `/api/agent/runs/${runId}/approval`,
  runRescan: (runId: string) => `/api/agent/runs/${runId}/rescan`,
  runExecutionResults: (runId: string) => `/api/agent/runs/${runId}/execution-results`,
  runPlanSubmission: (runId: string) => `/api/agent/runs/${runId}/plan-submission`,
  runMonitoredTargetSet: (runId: string) => `/api/monitoring/runs/${runId}/target-set`,
} as const;

function toSiteId(site: string) {
  return site.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function buildWorkflowEvent(output: WorkflowRunOutput) {
  const phase = output.plan_submission
    ? "approval"
    : output.retrieve_procedure
      ? "retrieve_procedure"
      : output.match_decision
        ? "match"
        : "scan";
  const status = output.plan_submission
    ? "awaiting_user"
    : output.discovery_parse.found
      ? "completed"
      : "in_progress";
  const siteId = toSiteId(output.discovery_parse.site);
  const candidateId = output.discovery_parse.candidates[0]?.url;

  return workflowEventSchema.parse({
    eventId: `evt_${output.context.run_id}_${phase}`,
    runId: output.context.run_id,
    phase,
    status,
    message: output.plan_submission
      ? `Submission plan ready for ${output.discovery_parse.site}.`
      : output.discovery_parse.found
        ? `Processed discovery results for ${output.discovery_parse.site}.`
        : `No likely listing found for ${output.discovery_parse.site}.`,
    createdAt: new Date().toISOString(),
    siteId,
    candidateId,
    reviewReasons: output.context.review_reasons,
  });
}

export function mapWorkflowRunOutputToWorkflowEvents(output: WorkflowRunOutput) {
  return [buildWorkflowEvent(output)];
}

export function mapWorkflowRunOutputToAgentRunState(
  output: WorkflowRunOutput,
  metadata: {
    profileId: string;
    requestText: string;
    requestedSites: string[];
  },
) {
  const siteId = toSiteId(output.discovery_parse.site);
  const candidate = output.discovery_parse.candidates[0];
  const timeline = mapWorkflowRunOutputToWorkflowEvents(output);
  const submissionChannel = output.retrieve_procedure?.procedure_type === "email" ? "email" : "webform";
  const currentPhase = output.plan_submission
    ? "approval"
    : output.retrieve_procedure
      ? "draft"
      : output.match_decision
        ? "match"
        : "scan";
  const status = output.plan_submission ? "awaiting_user" : output.discovery_parse.found ? "in_progress" : "completed";

  return agentRunStateSchema.parse({
    runId: output.context.run_id,
    profile: {
      profileId: metadata.profileId,
      firstName: output.validate_consent.seed_profile.full_name.split(" ")[0] ?? output.validate_consent.seed_profile.full_name,
      lastName: output.validate_consent.seed_profile.full_name.split(" ").slice(1).join(" ") || output.validate_consent.seed_profile.full_name,
      city: output.validate_consent.seed_profile.location.city,
      state: output.validate_consent.seed_profile.location.state,
      proxyEmail: output.validate_consent.seed_profile.privacy_email,
    },
    intent: {
      requestText: metadata.requestText,
      requestedActions: ["scan_only", "submit_opt_out"],
      requestedSites: metadata.requestedSites,
      geographicHint: output.validate_consent.seed_profile.location.city,
      requiresUserApprovalBeforeSubmission: true,
    },
    currentPhase,
    status,
    consentConfirmed: output.validate_consent.approved_for_submission,
    targets: [
      {
        siteId,
        siteName: output.discovery_parse.site,
        query: output.validate_consent.normalized_query,
      },
    ],
    candidates: candidate
      ? [
          {
            candidateId: candidate.url,
            siteId,
            siteName: output.discovery_parse.site,
            listingUrl: candidate.url,
            displayName: candidate.extracted.name,
            extractedFields: [
              { field: "Full Name", value: candidate.extracted.name },
              ...(candidate.extracted.age ? [{ field: "Age", value: candidate.extracted.age }] : []),
              ...candidate.extracted.addresses.map((address) => ({ field: "Address", value: address })),
              ...candidate.extracted.phones.map((phone) => ({ field: "Phone", value: phone })),
            ],
            evidence: (output.match_decision?.evidence ?? []).length > 0
              ? output.match_decision?.evidence
              : [
                  {
                    sourceType: "listing_page",
                    sourceUrl: candidate.url,
                    excerpt: candidate.evidence_snippets[0] ?? `${candidate.extracted.name} listing`,
                    capturedAt: output.discovery_parse.scan_timestamp,
                    fields: [],
                  },
                ],
          },
        ]
      : [],
    matchDecisions: output.match_decision ? [output.match_decision] : [],
    procedures: output.retrieve_procedure
      ? [
          {
            siteId,
            procedureId: `${siteId}-workflow`,
            source: "rag",
            sourceDocumentUri: `${siteId}-workflow`,
            sourceVersion: "workflow",
            retrievedAt: new Date().toISOString(),
            submissionChannel,
            freshnessDays: 0,
            isComplete: output.retrieve_procedure.procedure_type !== "procedure_unknown",
            requiredInputs: output.retrieve_procedure.required_fields.map((field) => ({
              key: field,
              label: field.replace(/_/g, " "),
              required: true,
              source: field === "privacy_email" ? "system" : "profile",
            })),
            steps: output.retrieve_procedure.steps.map((step, index) => ({
              stepId: `step_${siteId}_${index + 1}`,
              action: submissionChannel === "email" ? "manual_review" : index === 0 ? "navigate" : index === output.retrieve_procedure.steps.length - 1 ? "submit" : "fill",
              instruction: step,
              required: true,
            })),
            reviewReasons: output.context.review_reasons,
          },
        ]
      : [],
    drafts: output.draft_optout && candidate
      ? [
          {
            draftId: `draft_${siteId}`,
            siteId,
            candidateId: candidate.url,
            submissionChannel,
            subject: output.draft_optout.email?.subject,
            body: output.draft_optout.email?.body ?? JSON.stringify(output.draft_optout.webform ?? {}, null, 2),
            factsUsed: output.draft_optout.required_fields.map((field) => ({
              field: field.name,
              value: field.value,
            })),
            procedureId: `${siteId}-workflow`,
            generatedAt: new Date().toISOString(),
          },
        ]
      : [],
    handoffs: output.plan_submission && candidate
      ? [
          {
            handoffId: `handoff_${siteId}`,
            mode: output.plan_submission.requires_manual_review ? "human_assisted" : "auto",
            requiresUserApproval: true,
            reviewReasons: output.plan_submission.review_reasons,
            payload: {
              siteId,
              candidateId: candidate.url,
              procedureId: `${siteId}-workflow`,
              procedureVersion: "workflow",
              submissionChannel,
              fields: Object.fromEntries(output.plan_submission.action_plan.required_fields.map((field) => [field.name, field.value])),
              steps: (output.retrieve_procedure?.steps ?? []).map((step, index) => ({
                stepId: `step_${siteId}_${index + 1}`,
                action: submissionChannel === "email" ? "manual_review" : index === 0 ? "navigate" : index === (output.retrieve_procedure?.steps.length ?? 1) - 1 ? "submit" : "fill",
                instruction: step,
                required: true,
              })),
              draft: {
                draftId: `draft_${siteId}`,
                siteId,
                candidateId: candidate.url,
                submissionChannel,
                subject: output.draft_optout?.email?.subject,
                body: output.draft_optout?.email?.body ?? JSON.stringify(output.draft_optout?.webform ?? {}, null, 2),
                factsUsed: output.draft_optout?.required_fields.map((field) => ({ field: field.name, value: field.value })) ?? [],
                procedureId: `${siteId}-workflow`,
                generatedAt: new Date().toISOString(),
              },
            },
            createdAt: new Date().toISOString(),
          },
        ]
      : [],
    outcomes: output.interpret_result && candidate
      ? [
          {
            siteId,
            candidateId: candidate.url,
            status: output.interpret_result.next_status === "pending" ? "needs_follow_up" : output.interpret_result.next_status,
            confirmationId: null,
            observedAt: new Date().toISOString(),
            evidence: [],
            reviewReasons: output.interpret_result.review_reasons,
          },
        ]
      : [],
    pendingReviewReasons: output.context.review_reasons,
    timeline,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export function mapWorkflowRunOutputToMonitoredTargetSet(
  output: WorkflowRunOutput,
  metadata: {
    profileId: string;
  },
) {
  const runState = mapWorkflowRunOutputToAgentRunState(output, {
    profileId: metadata.profileId,
    requestText: output.validate_consent.normalized_query,
    requestedSites: [toSiteId(output.discovery_parse.site)],
  });
  const candidate = runState.candidates[0];
  const now = new Date().toISOString();

  return monitoredTargetSetSchema.parse({
    targetSetId: `mts_${runState.runId}`,
    sourceRunId: runState.runId,
    profileId: metadata.profileId,
    profileName: `${runState.profile.firstName} ${runState.profile.lastName}`.trim(),
    status: runState.pendingReviewReasons.length > 0 ? "needs_attention" : "active",
    monitoringPolicy: {
      cadenceDays: 30,
      reReviewCooldownDays: 30,
      reReviewListingReappearanceThreshold: 1,
    },
    targetCount: candidate ? 1 : 0,
    activeTargetCount: candidate ? 1 : 0,
    needsAttentionCount: runState.pendingReviewReasons.length > 0 ? 1 : 0,
    targets: candidate
      ? [
          {
            siteId: candidate.siteId,
            candidateId: candidate.candidateId,
            candidateUrl: candidate.listingUrl,
            monitoringStatus: runState.pendingReviewReasons.length > 0 ? "awaiting_confirmation" : "active",
            latestStatus: runState.status,
            triggerNewRemovalCycle: false,
          },
        ]
      : [],
    materializedFromRunAt: now,
    createdAt: now,
    updatedAt: now,
    storageBacked: false,
  });
}

export type ApiError = z.infer<typeof apiErrorSchema>;
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;
export type StartAgentRunRequest = z.infer<typeof startAgentRunRequestSchema>;
export type CreateRunResponse = z.infer<typeof createRunResponseSchema>;
export type StartAgentRunResponse = z.infer<typeof startAgentRunResponseSchema>;
export type GetRunResponse = z.infer<typeof getRunResponseSchema>;
export type ListRunsResponse = z.infer<typeof listRunsResponseSchema>;
export type RetrieveProceduresRequest = z.infer<typeof retrieveProceduresRequestSchema>;
export type RetrieveProceduresResponse = z.infer<typeof retrieveProceduresResponseSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type SendChatCommandRequest = z.infer<typeof sendChatCommandRequestSchema>;
export type SendChatCommandResponse = z.infer<typeof sendChatCommandResponseSchema>;
export type ListChatMessagesResponse = z.infer<typeof listChatMessagesResponseSchema>;
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
export type ListMonitoredTargetSetsResponse = z.infer<typeof listMonitoredTargetSetsResponseSchema>;
export type GetMonitoredTargetSetResponse = z.infer<typeof getMonitoredTargetSetResponseSchema>;
