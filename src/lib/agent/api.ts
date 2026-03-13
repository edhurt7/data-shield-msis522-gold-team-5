import { z } from "zod";

import {
  actionHandoffSchema,
  agentRunStateSchema,
  executionResultSchema,
  searchProfileSchema,
  seedProfileSchema,
  submissionPayloadSchema,
  userIntentSchema,
  workflowEventSchema,
} from "@/lib/agent/contracts";

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

export const agentApiPaths = {
  runs: "/api/agent/runs",
  startRun: "/api/agent/runs/start",
  run: (runId: string) => `/api/agent/runs/${runId}`,
  runMessages: (runId: string) => `/api/agent/runs/${runId}/messages`,
  runChat: (runId: string) => `/api/agent/runs/${runId}/chat`,
  runApproval: (runId: string) => `/api/agent/runs/${runId}/approval`,
  runRescan: (runId: string) => `/api/agent/runs/${runId}/rescan`,
  runExecutionResults: (runId: string) => `/api/agent/runs/${runId}/execution-results`,
  runPlanSubmission: (runId: string) => `/api/agent/runs/${runId}/plan-submission`,
} as const;

export type ApiError = z.infer<typeof apiErrorSchema>;
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;
export type StartAgentRunRequest = z.infer<typeof startAgentRunRequestSchema>;
export type CreateRunResponse = z.infer<typeof createRunResponseSchema>;
export type StartAgentRunResponse = z.infer<typeof startAgentRunResponseSchema>;
export type GetRunResponse = z.infer<typeof getRunResponseSchema>;
export type ListRunsResponse = z.infer<typeof listRunsResponseSchema>;
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
