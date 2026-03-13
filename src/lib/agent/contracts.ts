import { z } from "zod";

export const agentRunPhaseSchema = z.enum([
  "intake",
  "scan",
  "match",
  "retrieve_procedure",
  "draft",
  "approval",
  "execution",
  "verification",
  "logging",
  "completed",
]);

export const agentRunStatusSchema = z.enum([
  "queued",
  "in_progress",
  "awaiting_user",
  "blocked",
  "completed",
  "failed",
  "canceled",
]);

export const reviewReasonSchema = z.enum([
  "ambiguous_match",
  "captcha",
  "email_confirmation_required",
  "legal_hold",
  "low_confidence_match",
  "manual_submission_required",
  "missing_required_input",
  "missing_procedure",
  "procedure_unknown",
  "contradictory_procedure",
  "rate_limited",
  "site_unreachable",
  "stale_procedure",
]);

export const submissionChannelSchema = z.enum([
  "webform",
  "email",
  "mail",
  "phone",
  "unsupported",
]);

export const procedureTypeSchema = z.enum(["email", "webform", "procedure_unknown"]);

export const intentActionSchema = z.enum([
  "scan_only",
  "draft_opt_out",
  "submit_opt_out",
  "rescan",
  "status_check",
]);

export const matchDecisionLabelSchema = z.enum([
  "exact_match",
  "likely_match",
  "possible_match",
  "no_match",
]);

export const executionModeSchema = z.enum([
  "auto",
  "human_assisted",
  "blocked",
]);

export const reviewEscalationStrategySchema = z.enum([
  "block",
  "allow_with_review",
]);

export const confirmationHandlingStrategySchema = z.enum([
  "await_confirmation",
  "request_user_review",
]);

export const failureHandlingStrategySchema = z.enum([
  "retry",
  "request_user_review",
]);

export const procedureSourceSchema = z.enum([
  "rag",
  "manual",
  "policy",
  "cached",
]);

export const procedureStepActionSchema = z.enum([
  "navigate",
  "search",
  "fill",
  "select",
  "click",
  "submit",
  "wait",
  "check_email",
  "manual_review",
]);

export const fieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);

export const extractedFieldSchema = z.object({
  field: z.string().min(1),
  value: fieldValueSchema,
  normalizedValue: z.string().optional(),
});

export const seedProfileSchema = z.object({
  full_name: z.string().min(1),
  name_variants: z.array(z.string().min(1)).default([]),
  location: z.object({
    city: z.string().min(1),
    state: z.string().min(1),
  }),
  approx_age: z.string().nullable(),
  privacy_email: z.string().email(),
  optional: z.object({
    phone_last4: z.string().nullable().default(null),
    prior_cities: z.array(z.string().min(1)).default([]),
  }).default({
    phone_last4: null,
    prior_cities: [],
  }),
  consent: z.literal(true),
});

export const searchProfileSchema = z.object({
  profileId: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  middleName: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  dateOfBirth: z.string().optional(),
  proxyEmail: z.string().email().optional(),
});

export const userIntentSchema = z.object({
  requestText: z.string().min(1),
  requestedActions: z.array(intentActionSchema).min(1),
  requestedSites: z.array(z.string().min(1)).default([]),
  geographicHint: z.string().optional(),
  requiresUserApprovalBeforeSubmission: z.boolean().default(true),
});

export const searchTargetSchema = z.object({
  siteId: z.string().min(1),
  siteName: z.string().min(1),
  query: z.string().min(1),
  jurisdictionHint: z.string().optional(),
});

export const evidenceSchema = z.object({
  sourceType: z.enum(["search_result", "listing_page", "procedure_doc", "execution_log", "user_input"]),
  sourceUrl: z.string().url().optional(),
  excerpt: z.string().min(1),
  capturedAt: z.string().datetime(),
  fields: z.array(extractedFieldSchema).default([]),
});

export const listingCandidateSchema = z.object({
  candidateId: z.string().min(1),
  siteId: z.string().min(1),
  siteName: z.string().min(1),
  listingUrl: z.string().url(),
  displayName: z.string().min(1),
  extractedFields: z.array(extractedFieldSchema).min(1),
  evidence: z.array(evidenceSchema).min(1),
});

export const discoveryCandidateExtractedSchema = z.object({
  name: z.string().min(1),
  age: z.string().nullable(),
  addresses: z.array(z.string().min(1)).default([]),
  relatives: z.array(z.string().min(1)).default([]),
  phones: z.array(z.string().min(1)).default([]),
});

export const discoveryCandidateSchema = z.object({
  url: z.string().url(),
  extracted: discoveryCandidateExtractedSchema,
  match_confidence: z.number().min(0).max(1),
  evidence_snippets: z.array(z.string().min(1)).min(1),
});

export const discoveryResultSchema = z.object({
  site: z.string().min(1),
  scan_timestamp: z.string().datetime(),
  found: z.boolean(),
  candidates: z.array(discoveryCandidateSchema).default([]),
  notes: z.string().nullable(),
}).superRefine((value, ctx) => {
  if (!value.found && value.candidates.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Discovery results with found=false cannot include candidates.",
      path: ["candidates"],
    });
  }
});

export const matchDecisionSchema = z.object({
  siteId: z.string().min(1),
  candidateId: z.string().min(1),
  decision: matchDecisionLabelSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  evidence: z.array(evidenceSchema).min(1),
  reviewReasons: z.array(reviewReasonSchema).default([]),
});

export const procedureInputRequirementSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean(),
  source: z.enum(["profile", "listing", "system", "user"]),
});

export const procedureStepSchema = z.object({
  stepId: z.string().min(1),
  action: procedureStepActionSchema,
  instruction: z.string().min(1),
  selector: z.string().optional(),
  targetUrl: z.string().url().optional(),
  inputKey: z.string().optional(),
  required: z.boolean().default(true),
});

export const procedureSourceChunkSchema = z.object({
  doc_id: z.string().min(1),
  quote: z.string().min(1),
  source_id: z.string().min(1).optional(),
  source_updated_at: z.string().datetime().nullable().optional(),
  retrieved_at: z.string().datetime().nullable().optional(),
}).transform((value) => ({
  ...value,
  source_id: value.source_id ?? value.doc_id,
  source_updated_at: value.source_updated_at ?? null,
  retrieved_at: value.retrieved_at ?? null,
}));

export const pageContentArtifactMetadataSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  canonical_url: z.string().url().optional(),
  content_type: z.string().min(1).optional(),
  page_category: z.string().min(1).optional(),
  captured_at: z.string().datetime().optional(),
  headings: z.array(z.string().min(1)).default([]),
});

export const pageContentArtifactSchema = z.object({
  visible_text: z.string().min(1),
  url: z.string().url(),
  screenshot_ref: z.string().min(1).nullable().optional(),
  extracted_metadata: pageContentArtifactMetadataSchema.optional(),
});

export const procedureRetrievalSchema = z.object({
  site: z.string().min(1),
  procedure_type: procedureTypeSchema,
  required_fields: z.array(z.string().min(1)).default([]),
  steps: z.array(z.string().min(1)).default([]),
  source_chunks: z.array(procedureSourceChunkSchema).default([]),
});

export const procedureSelectionSchema = z.object({
  siteId: z.string().min(1),
  procedureId: z.string().min(1),
  source: procedureSourceSchema,
  sourceDocumentUri: z.string().min(1),
  sourceVersion: z.string().min(1),
  retrievedAt: z.string().datetime(),
  submissionChannel: submissionChannelSchema,
  freshnessDays: z.number().int().nonnegative(),
  isComplete: z.boolean(),
  requiredInputs: z.array(procedureInputRequirementSchema),
  steps: z.array(procedureStepSchema).min(1),
  reviewReasons: z.array(reviewReasonSchema).default([]),
}).superRefine((value, ctx) => {
  if (!value.isComplete && value.reviewReasons.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Incomplete procedures must include at least one review reason.",
      path: ["reviewReasons"],
    });
  }
});

export const optOutDraftSchema = z.object({
  draftId: z.string().min(1),
  siteId: z.string().min(1),
  candidateId: z.string().min(1),
  submissionChannel: submissionChannelSchema,
  subject: z.string().optional(),
  body: z.string().min(1),
  factsUsed: z.array(extractedFieldSchema).min(1),
  procedureId: z.string().min(1),
  generatedAt: z.string().datetime(),
});

export const submissionEmailSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
});

export const submissionFormFieldSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
});

export const submissionRequiredFieldSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  required: z.literal(true).default(true),
});

export const submissionOptionalFieldSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  required: z.literal(false).default(false),
});

export const consentCheckboxInstructionSchema = z.object({
  label: z.string().min(1),
  instruction: z.string().min(1),
  required: z.boolean().default(true),
});

export const submissionWebformSchema = z.object({
  fields: z.array(submissionFormFieldSchema).default([]),
  consent_checkboxes: z.array(consentCheckboxInstructionSchema).default([]),
});

export const submissionPayloadSchema = z.object({
  site: z.string().min(1),
  candidate_url: z.string().url(),
  submission_channel: z.enum(["email", "webform"]),
  procedure_type: z.enum(["email", "webform"]),
  required_fields: z.array(submissionRequiredFieldSchema).min(1),
  optional_fields: z.array(submissionOptionalFieldSchema).default([]),
  manual_review_required: z.boolean().default(false),
  review_reasons: z.array(reviewReasonSchema).default([]),
  email: submissionEmailSchema.optional(),
  webform: submissionWebformSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.submission_channel !== value.procedure_type) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Submission channel must match the procedure type.",
      path: ["submission_channel"],
    });
  }
  if (value.procedure_type === "email" && !value.email) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Email procedures require an email payload.",
      path: ["email"],
    });
  }
  if (value.procedure_type === "webform" && !value.webform) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Webform procedures require a webform payload.",
      path: ["webform"],
    });
  }
  if (value.procedure_type === "email" && value.webform) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Email procedures cannot include a webform payload.",
      path: ["webform"],
    });
  }
  if (value.procedure_type === "webform" && value.email) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Webform procedures cannot include an email payload.",
      path: ["email"],
    });
  }
  if (value.manual_review_required && value.review_reasons.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Manual-review payloads must include review reasons.",
      path: ["review_reasons"],
    });
  }
  if (!value.manual_review_required && value.review_reasons.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Review reasons require manual_review_required=true.",
      path: ["manual_review_required"],
    });
  }
  if (value.procedure_type === "webform") {
    const allowedFieldNames = new Set([
      ...value.required_fields.map((field) => field.name),
      ...value.optional_fields.map((field) => field.name),
    ]);

    for (const field of value.webform?.fields ?? []) {
      if (!allowedFieldNames.has(field.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Webform field "${field.name}" is not declared in the submission field contract.`,
          path: ["webform", "fields"],
        });
      }
    }
  }
});

export const actionPayloadSchema = z.object({
  siteId: z.string().min(1),
  candidateId: z.string().min(1),
  procedureId: z.string().min(1),
  procedureVersion: z.string().min(1),
  submissionChannel: submissionChannelSchema,
  fields: z.record(z.string(), fieldValueSchema),
  steps: z.array(procedureStepSchema).min(1),
  draft: optOutDraftSchema,
});

export const actionHandoffSchema = z.object({
  handoffId: z.string().min(1),
  mode: executionModeSchema,
  requiresUserApproval: z.boolean(),
  reviewReasons: z.array(reviewReasonSchema).default([]),
  payload: actionPayloadSchema,
  createdAt: z.string().datetime(),
}).superRefine((value, ctx) => {
  if (value.mode !== "auto" && value.reviewReasons.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Non-auto handoffs must include review reasons.",
      path: ["reviewReasons"],
    });
  }
});

export const executionResultSchema = z.object({
  site: z.string().min(1),
  candidate_url: z.string().url(),
  status: z.enum(["submitted", "pending", "failed", "manual_required"]),
  manual_review_required: z.boolean().default(false),
  confirmation_text: z.string().nullable(),
  ticket_ids: z.array(z.string().min(1)).default([]),
  screenshot_ref: z.string().nullable(),
  error_text: z.string().nullable(),
}).superRefine((value, ctx) => {
  if (value.status === "manual_required" && !value.manual_review_required) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "manual_required execution results must set manual_review_required=true.",
      path: ["manual_review_required"],
    });
  }
});

export const workflowEventSchema = z.object({
  eventId: z.string().min(1),
  runId: z.string().min(1),
  phase: agentRunPhaseSchema,
  status: agentRunStatusSchema,
  message: z.string().min(1),
  createdAt: z.string().datetime(),
  siteId: z.string().optional(),
  candidateId: z.string().optional(),
  reviewReasons: z.array(reviewReasonSchema).default([]),
});

export const executionOutcomeSchema = z.object({
  siteId: z.string().min(1),
  candidateId: z.string().min(1),
  status: z.enum(["submitted", "confirmed", "failed", "needs_follow_up"]),
  confirmationId: z.string().optional(),
  observedAt: z.string().datetime(),
  evidence: z.array(evidenceSchema).default([]),
  reviewReasons: z.array(reviewReasonSchema).default([]),
});

export const monitoredTargetStatusSchema = z.enum([
  "scheduled",
  "awaiting_confirmation",
  "rescan_due",
  "manual_review",
  "archived",
]);

export const monitoredTargetSetStatusSchema = z.enum([
  "active",
  "needs_attention",
  "archived",
]);

export const monitoredTargetSchema = z.object({
  targetId: z.string().min(1),
  siteId: z.string().min(1),
  siteName: z.string().min(1),
  sourceRunId: z.string().min(1),
  sourceSiteRunId: z.string().min(1),
  candidateId: z.string().min(1).nullable(),
  candidateUrl: z.string().url().nullable(),
  lastScanAt: z.string().datetime(),
  nextScanAt: z.string().datetime().nullable(),
  cooldownEndsAt: z.string().datetime().nullable(),
  monitoringStatus: monitoredTargetStatusSchema,
  reviewReasons: z.array(reviewReasonSchema).default([]),
  triggerNewRemovalCycle: z.boolean().default(false),
  reappearanceCount: z.number().int().min(0).default(0),
  latestOutcome: executionOutcomeSchema.pick({
    status: true,
    confirmationId: true,
    observedAt: true,
    reviewReasons: true,
  }).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const monitoredTargetSetSchema = z.object({
  targetSetId: z.string().min(1),
  sourceRunId: z.string().min(1),
  profileId: z.string().min(1),
  profileName: z.string().min(1),
  status: monitoredTargetSetStatusSchema,
  monitoringPolicy: z.object({
    cadenceDays: z.number().int().min(1),
    reReviewCooldownDays: z.number().int().min(0),
    reReviewListingReappearanceThreshold: z.number().int().min(1),
  }),
  targetCount: z.number().int().min(0),
  activeTargetCount: z.number().int().min(0),
  needsAttentionCount: z.number().int().min(0),
  targets: z.array(monitoredTargetSchema).default([]),
  materializedFromRunAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  storageBacked: z.boolean().default(false),
});

export const defaultAgentPolicy = {
  match_confidence_threshold: 0.75,
  max_submission_retries: 1,
  monitoring_cadence_days: 30,
  re_review_cooldown_days: 30,
  re_review_listing_reappearance_threshold: 1,
  require_explicit_consent: true,
  minimize_pii: true,
  require_retrieval_grounding: true,
  low_confidence_match_strategy: "block",
  stale_procedure_strategy: "block",
  contradictory_procedure_strategy: "block",
  pending_confirmation_strategy: "await_confirmation",
  captcha_failure_strategy: "request_user_review",
  manual_requirement_strategy: "request_user_review",
} as const;

export const agentPolicySchema = z.object({
  match_confidence_threshold: z.number().min(0).max(1).default(defaultAgentPolicy.match_confidence_threshold),
  max_submission_retries: z.number().int().min(0).default(defaultAgentPolicy.max_submission_retries),
  monitoring_cadence_days: z.number().int().min(1).default(defaultAgentPolicy.monitoring_cadence_days),
  re_review_cooldown_days: z.number().int().min(0).default(defaultAgentPolicy.re_review_cooldown_days),
  re_review_listing_reappearance_threshold:
    z.number().int().min(1).default(defaultAgentPolicy.re_review_listing_reappearance_threshold),
  require_explicit_consent: z.boolean().default(defaultAgentPolicy.require_explicit_consent),
  minimize_pii: z.boolean().default(defaultAgentPolicy.minimize_pii),
  require_retrieval_grounding: z.boolean().default(defaultAgentPolicy.require_retrieval_grounding),
  low_confidence_match_strategy: reviewEscalationStrategySchema.default(defaultAgentPolicy.low_confidence_match_strategy),
  stale_procedure_strategy: reviewEscalationStrategySchema.default(defaultAgentPolicy.stale_procedure_strategy),
  contradictory_procedure_strategy: reviewEscalationStrategySchema.default(defaultAgentPolicy.contradictory_procedure_strategy),
  pending_confirmation_strategy:
    confirmationHandlingStrategySchema.default(defaultAgentPolicy.pending_confirmation_strategy),
  captcha_failure_strategy: failureHandlingStrategySchema.default(defaultAgentPolicy.captcha_failure_strategy),
  manual_requirement_strategy: failureHandlingStrategySchema.default(defaultAgentPolicy.manual_requirement_strategy),
});

export const agentPolicyOverrideSchema = agentPolicySchema.partial();

export function resolveAgentPolicy(overrides: Partial<AgentPolicy> = {}, defaults: AgentPolicy = defaultAgentPolicy) {
  return agentPolicySchema.parse({
    ...defaults,
    ...overrides,
  });
}

export const agentRunStateSchema = z.object({
  runId: z.string().min(1),
  profile: searchProfileSchema,
  intent: userIntentSchema,
  currentPhase: agentRunPhaseSchema,
  status: agentRunStatusSchema,
  consentConfirmed: z.boolean(),
  targets: z.array(searchTargetSchema).default([]),
  candidates: z.array(listingCandidateSchema).default([]),
  matchDecisions: z.array(matchDecisionSchema).default([]),
  procedures: z.array(procedureSelectionSchema).default([]),
  drafts: z.array(optOutDraftSchema).default([]),
  handoffs: z.array(actionHandoffSchema).default([]),
  outcomes: z.array(executionOutcomeSchema).default([]),
  pendingReviewReasons: z.array(reviewReasonSchema).default([]),
  timeline: z.array(workflowEventSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AgentRunPhase = z.infer<typeof agentRunPhaseSchema>;
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;
export type ReviewReason = z.infer<typeof reviewReasonSchema>;
export type SubmissionChannel = z.infer<typeof submissionChannelSchema>;
export type ProcedureType = z.infer<typeof procedureTypeSchema>;
export type IntentAction = z.infer<typeof intentActionSchema>;
export type MatchDecisionLabel = z.infer<typeof matchDecisionLabelSchema>;
export type ExecutionMode = z.infer<typeof executionModeSchema>;
export type ReviewEscalationStrategy = z.infer<typeof reviewEscalationStrategySchema>;
export type ConfirmationHandlingStrategy = z.infer<typeof confirmationHandlingStrategySchema>;
export type FailureHandlingStrategy = z.infer<typeof failureHandlingStrategySchema>;
export type ProcedureSource = z.infer<typeof procedureSourceSchema>;
export type ProcedureStepAction = z.infer<typeof procedureStepActionSchema>;
export type ExtractedField = z.infer<typeof extractedFieldSchema>;
export type SeedProfile = z.infer<typeof seedProfileSchema>;
export type SearchProfile = z.infer<typeof searchProfileSchema>;
export type UserIntent = z.infer<typeof userIntentSchema>;
export type SearchTarget = z.infer<typeof searchTargetSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type ListingCandidate = z.infer<typeof listingCandidateSchema>;
export type DiscoveryCandidateExtracted = z.infer<typeof discoveryCandidateExtractedSchema>;
export type DiscoveryCandidate = z.infer<typeof discoveryCandidateSchema>;
export type DiscoveryResult = z.infer<typeof discoveryResultSchema>;
export type MatchDecision = z.infer<typeof matchDecisionSchema>;
export type ProcedureInputRequirement = z.infer<typeof procedureInputRequirementSchema>;
export type ProcedureStep = z.infer<typeof procedureStepSchema>;
export type ProcedureSourceChunk = z.infer<typeof procedureSourceChunkSchema>;
export type ProcedureRetrieval = z.infer<typeof procedureRetrievalSchema>;
export type PageContentArtifactMetadata = z.infer<typeof pageContentArtifactMetadataSchema>;
export type PageContentArtifact = z.infer<typeof pageContentArtifactSchema>;
export type ProcedureSelection = z.infer<typeof procedureSelectionSchema>;
export type OptOutDraft = z.infer<typeof optOutDraftSchema>;
export type SubmissionEmail = z.infer<typeof submissionEmailSchema>;
export type SubmissionFormField = z.infer<typeof submissionFormFieldSchema>;
export type SubmissionRequiredField = z.infer<typeof submissionRequiredFieldSchema>;
export type SubmissionOptionalField = z.infer<typeof submissionOptionalFieldSchema>;
export type ConsentCheckboxInstruction = z.infer<typeof consentCheckboxInstructionSchema>;
export type SubmissionWebform = z.infer<typeof submissionWebformSchema>;
export type SubmissionPayload = z.infer<typeof submissionPayloadSchema>;
export type ActionPayload = z.infer<typeof actionPayloadSchema>;
export type ActionHandoff = z.infer<typeof actionHandoffSchema>;
export type ExecutionResult = z.infer<typeof executionResultSchema>;
export type WorkflowEvent = z.infer<typeof workflowEventSchema>;
export type ExecutionOutcome = z.infer<typeof executionOutcomeSchema>;
export type MonitoredTargetStatus = z.infer<typeof monitoredTargetStatusSchema>;
export type MonitoredTargetSetStatus = z.infer<typeof monitoredTargetSetStatusSchema>;
export type MonitoredTarget = z.infer<typeof monitoredTargetSchema>;
export type MonitoredTargetSet = z.infer<typeof monitoredTargetSetSchema>;
export type AgentPolicy = z.infer<typeof agentPolicySchema>;
export type AgentRunState = z.infer<typeof agentRunStateSchema>;

