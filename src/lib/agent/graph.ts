import { z } from "zod";

import {
  agentPolicyOverrideSchema,
  agentPolicySchema,
  defaultAgentPolicy,
  discoveryResultSchema,
  executionResultSchema,
  procedureRetrievalSchema,
  resolveAgentPolicy,
  reviewReasonSchema,
  seedProfileSchema,
  submissionPayloadSchema,
  workflowEventSchema,
} from "@/lib/agent/contracts";

export const agentNodeNameSchema = z.enum([
  "validate_consent",
  "discovery_parse",
  "retrieve_procedure",
  "draft_optout",
  "plan_submission",
  "interpret_result",
]);

export const graphContextSchema = z.object({
  run_id: z.string().min(1),
  policy_defaults: agentPolicySchema.default(defaultAgentPolicy),
  policy_overrides: agentPolicyOverrideSchema.default({}),
  policy: agentPolicySchema.optional(),
  review_reasons: z.array(reviewReasonSchema).default([]),
  events: z.array(workflowEventSchema).default([]),
}).transform((value) => {
  const policy_defaults = agentPolicySchema.parse(value.policy_defaults);
  const legacyOverrides = value.policy ? agentPolicyOverrideSchema.parse(value.policy) : {};
  const policy_overrides = agentPolicyOverrideSchema.parse({
    ...legacyOverrides,
    ...value.policy_overrides,
  });

  return {
    ...value,
    policy_defaults,
    policy_overrides,
    policy: resolveAgentPolicy(policy_overrides, policy_defaults),
  };
});

export const validateConsentInputSchema = z.object({
  seed_profile: seedProfileSchema,
  request_text: z.string().min(1),
});

export const validateConsentOutputSchema = z.object({
  seed_profile: seedProfileSchema,
  normalized_query: z.string().min(1),
  approved_for_submission: z.boolean(),
});

export const discoveryParseInputSchema = z.object({
  seed_profile: seedProfileSchema,
  site: z.string().min(1),
  page_text: z.string().min(1),
  page_url: z.string().url().optional(),
});

export const discoveryParseOutputSchema = discoveryResultSchema;

export const retrieveProcedureInputSchema = z.object({
  seed_profile: seedProfileSchema,
  discovery_result: discoveryResultSchema,
  site: z.string().min(1),
  retrieved_chunks: z.array(z.object({
    doc_id: z.string().min(1),
    quote: z.string().min(1),
  })).default([]),
});

export const retrieveProcedureOutputSchema = procedureRetrievalSchema;

export const draftOptOutInputSchema = z.object({
  seed_profile: seedProfileSchema,
  site: z.string().min(1),
  candidate_url: z.string().url(),
  procedure: procedureRetrievalSchema,
});

export const draftOptOutOutputSchema = submissionPayloadSchema;

export const planSubmissionInputSchema = z.object({
  seed_profile: seedProfileSchema,
  discovery_result: discoveryResultSchema,
  procedure: procedureRetrievalSchema,
  submission_payload: submissionPayloadSchema,
});

export const planSubmissionOutputSchema = z.object({
  action_plan: submissionPayloadSchema,
  requires_manual_review: z.boolean(),
  review_reasons: z.array(reviewReasonSchema).default([]),
});

export const interpretResultInputSchema = z.object({
  execution_result: executionResultSchema,
  prior_review_reasons: z.array(reviewReasonSchema).default([]),
  retry_count: z.number().int().min(0).default(0),
});

export const interpretResultOutputSchema = z.object({
  next_status: z.enum(["submitted", "pending", "failed", "manual_required"]),
  next_action: z.enum(["none", "retry", "await_confirmation", "request_user_review"]),
  review_reasons: z.array(reviewReasonSchema).default([]),
});

export type AgentNodeName = z.infer<typeof agentNodeNameSchema>;
export type GraphContext = z.infer<typeof graphContextSchema>;
export type ValidateConsentInput = z.infer<typeof validateConsentInputSchema>;
export type ValidateConsentOutput = z.infer<typeof validateConsentOutputSchema>;
export type DiscoveryParseInput = z.infer<typeof discoveryParseInputSchema>;
export type DiscoveryParseOutput = z.infer<typeof discoveryParseOutputSchema>;
export type RetrieveProcedureInput = z.infer<typeof retrieveProcedureInputSchema>;
export type RetrieveProcedureOutput = z.infer<typeof retrieveProcedureOutputSchema>;
export type DraftOptOutInput = z.infer<typeof draftOptOutInputSchema>;
export type DraftOptOutOutput = z.infer<typeof draftOptOutOutputSchema>;
export type PlanSubmissionInput = z.infer<typeof planSubmissionInputSchema>;
export type PlanSubmissionOutput = z.infer<typeof planSubmissionOutputSchema>;
export type InterpretResultInput = z.infer<typeof interpretResultInputSchema>;
export type InterpretResultOutput = z.infer<typeof interpretResultOutputSchema>;
