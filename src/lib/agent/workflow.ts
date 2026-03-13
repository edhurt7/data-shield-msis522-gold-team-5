import { z } from "zod";
import { Annotation, Command, END, START, StateGraph, isInterrupted } from "@langchain/langgraph";
import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

import {
  actionHandoffSchema,
  executionResultSchema,
  matchDecisionSchema,
  pageContentArtifactSchema,
  procedureSourceChunkSchema,
  reviewReasonSchema,
  workflowEventSchema,
  type DiscoveryCandidate,
  type DiscoveryResult,
  type ExecutionResult,
  type MatchDecision,
  type PageContentArtifact,
  type ProcedureRetrieval,
  type ProcedureSourceChunk,
  type ReviewReason,
  type SeedProfile,
  type WorkflowEvent,
} from "@/lib/agent/contracts";
import {
  discoveryParseOutputSchema,
  discoveryParseInputSchema,
  draftOptOutOutputSchema,
  graphContextSchema,
  interpretResultOutputSchema,
  planSubmissionOutputSchema,
  retrieveProcedureOutputSchema,
  validateConsentOutputSchema,
  type DraftOptOutInput,
  type DraftOptOutOutput,
  type DiscoveryParseInput,
  type DiscoveryParseOutput,
  type GraphContext,
  type InterpretResultInput,
  type InterpretResultOutput,
  type PlanSubmissionInput,
  type PlanSubmissionOutput,
  type RetrieveProcedureInput,
  type RetrieveProcedureOutput,
  type ValidateConsentInput,
  type ValidateConsentOutput,
} from "@/lib/agent/graph";
import {
  createDefaultProcedureRetriever,
  reviewReasonsForProcedureResolution,
  type ProcedureResolutionStatus,
  type ProcedureRetriever,
} from "@/lib/agent/retrieval";
import {
  createDefaultConsentNode,
  createPromptBackedNodes,
  readPromptTrace,
  StructuredLlmError,
  StructuredLlmOutputValidationError,
  type OpenAiCompatibleStructuredLlmAdapterOptions,
  type StructuredLlmAdapter,
} from "@/lib/agent/llm";
import {
  createStructuredLlmAdapterFromConfig,
  createStructuredLlmAdapterFromEnv,
  type AgentLlmAdapterFactoryOptions,
  type AgentLlmConfig,
  type AgentLlmEnvLike,
} from "@/lib/agent/llm-config";
import { createWorkflowAutomationHandoff } from "@/lib/automation/handoff";
import { executeAutomation } from "@/lib/automation/runner";
import type { ExecuteAutomationOptions } from "@/lib/automation/types";

const workflowLegacySiteInputSchema = z.object({
  site: z.string().min(1),
  page_text: z.string().min(1),
  page_url: z.string().url(),
  screenshot_ref: z.string().min(1).nullable().optional(),
  extracted_metadata: pageContentArtifactSchema.shape.extracted_metadata.optional(),
  retrieved_chunks: z.array(procedureSourceChunkSchema).default([]),
  execution_result: executionResultSchema.optional(),
  retry_count: z.number().int().min(0).default(0),
});

const workflowSiteInputSchema = z.union([
  z.object({
    site: z.string().min(1),
    page_artifact: pageContentArtifactSchema,
    retrieved_chunks: z.array(procedureSourceChunkSchema).default([]),
    execution_result: executionResultSchema.optional(),
    retry_count: z.number().int().min(0).default(0),
  }),
  workflowLegacySiteInputSchema,
]).transform((input) => (
  "page_artifact" in input
    ? input
    : {
      site: input.site,
      page_artifact: pageContentArtifactSchema.parse({
        visible_text: input.page_text,
        url: input.page_url,
        screenshot_ref: input.screenshot_ref ?? null,
        extracted_metadata: input.extracted_metadata,
      }),
      retrieved_chunks: input.retrieved_chunks,
      execution_result: input.execution_result,
      retry_count: input.retry_count,
    }
)).pipe(z.object({
  site: z.string().min(1),
  page_artifact: pageContentArtifactSchema,
  retrieved_chunks: z.array(procedureSourceChunkSchema).default([]),
  execution_result: executionResultSchema.optional(),
  retry_count: z.number().int().min(0).default(0),
}));

export const workflowCheckpointConfigSchema = z.object({
  thread_id: z.string().min(1),
  checkpoint_id: z.string().min(1).optional(),
});

export const workflowCheckpointStateSchema = z.object({
  thread_id: z.string().min(1),
  checkpoint_id: z.string().min(1).optional(),
  next: z.array(z.string().min(1)).default([]),
  resume_required: z.boolean(),
});

export const workflowMonitoringStatusSchema = z.enum([
  "not_applicable",
  "scheduled",
  "awaiting_confirmation",
  "rescan_due",
  "manual_review",
]);

export const workflowMonitoringReasonSchema = z.enum([
  "none",
  "cadence",
  "pending_confirmation",
  "listing_reappeared",
  "review_blocked",
]);

export const workflowMonitoringRecordSchema = z.object({
  status: workflowMonitoringStatusSchema,
  reason: workflowMonitoringReasonSchema,
  last_scan_at: z.string().datetime(),
  next_scan_at: z.string().datetime().nullable(),
  cooldown_ends_at: z.string().datetime().nullable(),
  reappearance_count: z.number().int().min(0).default(0),
  trigger_new_removal_cycle: z.boolean(),
  backend_required: z.boolean().default(true),
  notes: z.string().min(1),
});

export const workflowTerminalPathSchema = z.enum([
  "completed",
  "await_confirmation",
  "retry_scheduled",
  "retry_exhausted",
  "manual_review",
  "captcha_review",
  "blocked",
  "no_match",
  "site_unreachable",
  "low_confidence_match_blocked",
  "missing_procedure",
  "stale_procedure",
  "contradictory_procedure",
]);

const workflowSingleSiteRunInputSchema = z.object({
  context: graphContextSchema,
  seed_profile: discoveryParseInputSchema.shape.seed_profile,
  request_text: z.string().min(1),
  site_input: workflowSiteInputSchema,
});

const workflowAutomationArtifactSchema = z.object({
  artifactId: z.string().min(1),
  kind: z.enum(["execution_log", "page_text", "html_snapshot", "screenshot"]),
  label: z.string().min(1),
  createdAt: z.string().datetime(),
  ref: z.string().nullable(),
  contentType: z.string().optional(),
  content: z.string().optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

const workflowAutomationStepOutcomeSchema = z.object({
  stepId: z.string().min(1),
  action: z.string().min(1),
  instruction: z.string().min(1),
  status: z.enum(["pending", "completed", "failed", "manual_review_required"]),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  selector: z.string().optional(),
  targetUrl: z.string().optional(),
  artifactIds: z.array(z.string().min(1)).default([]),
  notes: z.string().optional(),
});

const workflowAutomationRecordSchema = z.object({
  handoff: actionHandoffSchema,
  executionResult: executionResultSchema,
  evidence: z.object({
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    siteId: z.string().min(1),
    handoffId: z.string().min(1),
    executorId: z.string().min(1),
    failureCode: z.enum(["captcha", "rate_limited", "selector_missing", "site_changed", "timeout", "manual_review_required"]).nullable(),
    reviewReasons: z.array(reviewReasonSchema).default([]),
    artifacts: z.array(workflowAutomationArtifactSchema).default([]),
    stepOutcomes: z.array(workflowAutomationStepOutcomeSchema).default([]),
  }),
});

export const workflowSiteRunOutputSchema = z.object({
  site_input: workflowSiteInputSchema,
  context: graphContextSchema,
  validate_consent: validateConsentOutputSchema,
  discovery_parse: discoveryParseOutputSchema,
  match_decision: matchDecisionSchema.nullable(),
  retrieve_procedure: retrieveProcedureOutputSchema.nullable(),
  draft_optout: draftOptOutOutputSchema.nullable(),
  plan_submission: planSubmissionOutputSchema.nullable(),
  interpret_result: interpretResultOutputSchema.nullable(),
  automation_record: workflowAutomationRecordSchema.nullable().default(null),
  monitoring: workflowMonitoringRecordSchema,
  prompt_trace: z.object({
    discovery_parse: z.object({
      prompt_name: z.enum([
        "listing_classifier_extractor",
        "procedure_selector",
        "draft_generator",
        "post_execution_verifier",
      ]),
      prompt_version: z.string().min(1),
    }).nullable(),
    retrieve_procedure: z.object({
      prompt_name: z.enum([
        "listing_classifier_extractor",
        "procedure_selector",
        "draft_generator",
        "post_execution_verifier",
      ]),
      prompt_version: z.string().min(1),
    }).nullable(),
    draft_optout: z.object({
      prompt_name: z.enum([
        "listing_classifier_extractor",
        "procedure_selector",
        "draft_generator",
        "post_execution_verifier",
      ]),
      prompt_version: z.string().min(1),
    }).nullable(),
    interpret_result: z.object({
      prompt_name: z.enum([
        "listing_classifier_extractor",
        "procedure_selector",
        "draft_generator",
        "post_execution_verifier",
      ]),
      prompt_version: z.string().min(1),
    }).nullable(),
  }),
  terminal_path: workflowTerminalPathSchema.nullable(),
  checkpoint: workflowCheckpointStateSchema.nullable(),
});

export const workflowOrchestrationCheckpointStateSchema = z.object({
  thread_id: z.string().min(1),
  checkpoint_id: z.string().min(1).optional(),
  pending_sites: z.array(z.string().min(1)).default([]),
  site_checkpoints: z.array(z.object({
    site: z.string().min(1),
    checkpoint: workflowCheckpointStateSchema.nullable(),
  })).default([]),
  resume_required: z.boolean(),
});

export const workflowRunSummarySchema = z.object({
  overall_status: z.enum(["completed", "partial_success", "awaiting_review", "in_progress"]),
  partial_success: z.boolean(),
  requested_sites: z.array(z.string().min(1)).default([]),
  processed_sites: z.array(z.string().min(1)).default([]),
  total_requested_sites: z.number().int().min(0),
  total_processed_sites: z.number().int().min(0),
  completed_sites: z.number().int().min(0),
  pending_sites: z.number().int().min(0),
  successful_sites: z.number().int().min(0),
  blocked_sites: z.number().int().min(0),
  manual_review_sites: z.number().int().min(0),
  matched_sites: z.number().int().min(0),
  no_match_sites: z.number().int().min(0),
  total_retry_count: z.number().int().min(0),
  monitoring: z.object({
    scheduled_sites: z.number().int().min(0),
    awaiting_confirmation_sites: z.number().int().min(0),
    due_sites: z.number().int().min(0),
    manual_review_sites: z.number().int().min(0),
    new_removal_cycle_sites: z.number().int().min(0),
  }),
  sites_by_terminal_path: z.record(z.string(), z.number().int().min(0)).default({}),
  site_outcomes: z.array(z.object({
    site: z.string().min(1),
    terminal_path: workflowTerminalPathSchema.nullable(),
    retry_count: z.number().int().min(0),
    review_blocked: z.boolean(),
    successful: z.boolean(),
    pending: z.boolean(),
  })).default([]),
});

export const workflowBatchSiteRegistryInputSchema = z.union([
  z.object({
    site: z.string().min(1),
    enabled: z.boolean().default(true),
    notes: z.string().optional(),
    default_procedure_chunks: z.array(procedureSourceChunkSchema).default([]),
    page_artifact: pageContentArtifactSchema.optional(),
    retrieved_chunks: z.array(procedureSourceChunkSchema).default([]),
    execution_result: executionResultSchema.optional(),
    retry_count: z.number().int().min(0).default(0),
  }),
  z.object({
    site: z.string().min(1),
    enabled: z.boolean().default(true),
    notes: z.string().optional(),
    default_procedure_chunks: z.array(procedureSourceChunkSchema).default([]),
    page_text: z.string().min(1).optional(),
    page_url: z.string().url().optional(),
    screenshot_ref: z.string().min(1).nullable().optional(),
    extracted_metadata: pageContentArtifactSchema.shape.extracted_metadata.optional(),
    retrieved_chunks: z.array(procedureSourceChunkSchema).default([]),
    execution_result: executionResultSchema.optional(),
    retry_count: z.number().int().min(0).default(0),
  }),
]).transform((input) => (
  "page_artifact" in input || (!("page_text" in input) && !("page_url" in input))
    ? input
    : {
      site: input.site,
      enabled: input.enabled,
      notes: input.notes,
      default_procedure_chunks: input.default_procedure_chunks,
      page_artifact: input.page_text && input.page_url
        ? pageContentArtifactSchema.parse({
          visible_text: input.page_text,
          url: input.page_url,
          screenshot_ref: input.screenshot_ref ?? null,
          extracted_metadata: input.extracted_metadata,
        })
        : undefined,
      retrieved_chunks: input.retrieved_chunks,
      execution_result: input.execution_result,
      retry_count: input.retry_count,
    }
)).pipe(z.object({
  site: z.string().min(1),
  enabled: z.boolean().default(true),
  notes: z.string().optional(),
  default_procedure_chunks: z.array(procedureSourceChunkSchema).default([]),
  page_artifact: pageContentArtifactSchema.optional(),
  retrieved_chunks: z.array(procedureSourceChunkSchema).default([]),
  execution_result: executionResultSchema.optional(),
  retry_count: z.number().int().min(0).default(0),
})).superRefine((value, ctx) => {
  if (!value.enabled) {
    return;
  }

  if (!value.page_artifact?.visible_text) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Enabled site registry entries require page_artifact.visible_text for batch workflow runs.",
      path: ["page_artifact", "visible_text"],
    });
  }

  if (!value.page_artifact?.url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Enabled site registry entries require page_artifact.url for batch workflow runs.",
      path: ["page_artifact", "url"],
    });
  }
});

const workflowBatchRunInputSchema = z.object({
  context: graphContextSchema,
  seed_profile: discoveryParseInputSchema.shape.seed_profile,
  request_text: z.string().min(1),
  requested_sites: z.array(z.string().min(1)).default([]),
  site_registry: z.array(workflowBatchSiteRegistryInputSchema).min(1),
});

const workflowRunInputSourceSchema = z.union([
  z.object({
    context: graphContextSchema,
    seed_profile: discoveryParseInputSchema.shape.seed_profile,
    request_text: z.string().min(1),
    requested_sites: z.array(z.string().min(1)).default([]),
    site_inputs: z.array(workflowSiteInputSchema).min(1),
  }),
  workflowBatchRunInputSchema,
  workflowSingleSiteRunInputSchema,
]);

export const workflowRunInputSchema = workflowRunInputSourceSchema.transform((input) => (
  "site_inputs" in input
    ? input
    : "site_registry" in input
      ? {
        context: input.context,
        seed_profile: input.seed_profile,
        request_text: input.request_text,
        requested_sites: input.requested_sites,
        site_inputs: input.site_registry
          .filter((entry) => entry.enabled && (input.requested_sites.length === 0 || input.requested_sites.includes(entry.site)))
          .map((entry) => workflowSiteInputSchema.parse({
            site: entry.site,
            page_artifact: entry.page_artifact,
            retrieved_chunks: entry.retrieved_chunks,
            execution_result: entry.execution_result,
            retry_count: entry.retry_count,
          })),
      }
      : {
      context: input.context,
      seed_profile: input.seed_profile,
      request_text: input.request_text,
      requested_sites: [],
      site_inputs: [input.site_input],
    }
)).pipe(z.object({
  context: graphContextSchema,
  seed_profile: discoveryParseInputSchema.shape.seed_profile,
  request_text: z.string().min(1),
  requested_sites: z.array(z.string().min(1)).default([]),
  site_inputs: z.array(workflowSiteInputSchema).min(1),
}));

export const workflowRunOutputSchema = workflowSiteRunOutputSchema.extend({
  site_runs: z.array(workflowSiteRunOutputSchema).min(1),
  run_summary: workflowRunSummarySchema,
  orchestration_checkpoint: workflowOrchestrationCheckpointStateSchema.nullable(),
});

export const siteRegistryEntrySchema = z.object({
  site: z.string().min(1),
  enabled: z.boolean().default(true),
  notes: z.string().optional(),
  default_procedure_chunks: z.array(procedureSourceChunkSchema).default([]),
});

export type WorkflowSiteInput = z.infer<typeof workflowSiteInputSchema>;
export type WorkflowBatchSiteRegistryInput = z.infer<typeof workflowBatchSiteRegistryInputSchema>;
type WorkflowBatchRunInput = z.infer<typeof workflowBatchRunInputSchema>;
type WorkflowSingleSiteRunInput = z.infer<typeof workflowSingleSiteRunInputSchema>;
type ParsedWorkflowRunInput = z.infer<typeof workflowRunInputSchema>;
export type WorkflowRunInput = z.input<typeof workflowRunInputSchema>;
export type WorkflowSiteRunOutput = z.infer<typeof workflowSiteRunOutputSchema>;
export type WorkflowRunOutput = z.infer<typeof workflowRunOutputSchema>;
export type SiteRegistryEntry = z.infer<typeof siteRegistryEntrySchema>;
export type WorkflowCheckpointConfig = z.infer<typeof workflowCheckpointConfigSchema>;
export type WorkflowCheckpointState = z.infer<typeof workflowCheckpointStateSchema>;
export type WorkflowOrchestrationCheckpointState = z.infer<typeof workflowOrchestrationCheckpointStateSchema>;
export type WorkflowRunSummary = z.infer<typeof workflowRunSummarySchema>;
export type WorkflowTerminalPath = z.infer<typeof workflowTerminalPathSchema>;
export type WorkflowPromptTrace = z.infer<typeof workflowSiteRunOutputSchema.shape.prompt_trace>;
export type WorkflowAutomationRecord = z.infer<typeof workflowAutomationRecordSchema>;
export type WorkflowMonitoringRecord = z.infer<typeof workflowMonitoringRecordSchema>;

function normalizeArtifactText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function normalizeOptionalArtifactText(value?: string) {
  const normalized = value ? normalizeArtifactText(value) : undefined;
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizePageArtifactForDiscovery(pageArtifact: PageContentArtifact) {
  return {
    visible_text: normalizeArtifactText(pageArtifact.visible_text),
    url: pageArtifact.url.trim(),
    screenshot_ref: pageArtifact.screenshot_ref?.trim() || null,
    extracted_metadata: pageArtifact.extracted_metadata
      ? {
        ...pageArtifact.extracted_metadata,
        title: normalizeOptionalArtifactText(pageArtifact.extracted_metadata.title),
        description: normalizeOptionalArtifactText(pageArtifact.extracted_metadata.description),
        canonical_url: pageArtifact.extracted_metadata.canonical_url?.trim(),
        content_type: normalizeOptionalArtifactText(pageArtifact.extracted_metadata.content_type),
        page_category: normalizeOptionalArtifactText(pageArtifact.extracted_metadata.page_category),
        headings: pageArtifact.extracted_metadata.headings
          .map((heading) => normalizeArtifactText(heading))
          .filter(Boolean),
      }
      : undefined,
  };
}

function normalizeWorkflowRunInput(input: WorkflowRunInput) {
  const normalized = workflowRunInputSchema.parse(input);
  const rawInput = input as Record<string, unknown>;
  const rawSiteRegistry = Array.isArray(rawInput.site_registry) ? rawInput.site_registry : null;

  return {
    parsedInput: normalized,
    inputRegistryEntries: rawSiteRegistry
      ? rawSiteRegistry.map((entry) => {
        const parsedEntry = workflowBatchSiteRegistryInputSchema.parse(entry);

        return siteRegistryEntrySchema.parse({
          site: parsedEntry.site,
          enabled: parsedEntry.enabled,
          notes: parsedEntry.notes,
          default_procedure_chunks: parsedEntry.default_procedure_chunks,
        });
      })
      : [],
  };
}

export interface AgentWorkflowNodes {
  validateConsent: (input: ValidateConsentInput, context: GraphContext) => ValidateConsentOutput | Promise<ValidateConsentOutput>;
  discoveryParse: (input: DiscoveryParseInput, context: GraphContext) => DiscoveryParseOutput | Promise<DiscoveryParseOutput>;
  retrieveProcedure: (input: RetrieveProcedureInput, context: GraphContext) => RetrieveProcedureOutput | Promise<RetrieveProcedureOutput>;
  draftOptOut: (input: DraftOptOutInput, context: GraphContext) => DraftOptOutOutput | Promise<DraftOptOutOutput>;
  planSubmission: (input: PlanSubmissionInput, context: GraphContext) => PlanSubmissionOutput | Promise<PlanSubmissionOutput>;
  interpretResult: (input: InterpretResultInput, context: GraphContext) => InterpretResultOutput | Promise<InterpretResultOutput>;
}

export interface AgentWorkflowOptions {
  nodes?: Partial<AgentWorkflowNodes>;
  siteRegistry?: SiteRegistryEntry[];
  procedureRetriever?: ProcedureRetriever;
  checkpointer?: BaseCheckpointSaver | boolean;
  llm?: AgentWorkflowLlmOptions;
}

export interface WorkflowAutomationRunOptions {
  automation?: ExecuteAutomationOptions;
}

export interface AgentWorkflowLlmOptions {
  adapter?: StructuredLlmAdapter;
  config?: AgentLlmConfig;
  env?: AgentLlmEnvLike;
  headers?: AgentLlmAdapterFactoryOptions["headers"];
  transport?: OpenAiCompatibleStructuredLlmAdapterOptions["transport"];
}

const replaceReducer = <T>(defaultValue: T) => Annotation<T>({
  reducer: (_left, right) => right,
  default: () => defaultValue,
});

const mergeReducer = <T extends object>(defaultValue: T) => Annotation<T>({
  reducer: (left, right) => ({
    ...left,
    ...right,
  }),
  default: () => defaultValue,
});

function createEmptyPromptTrace(): WorkflowPromptTrace {
  return {
    discovery_parse: null,
    retrieve_procedure: null,
    draft_optout: null,
    interpret_result: null,
  };
}

const workflowGraphState = Annotation.Root({
  input: replaceReducer<WorkflowSingleSiteRunInput | null>(null),
  context: replaceReducer<GraphContext | null>(null),
  registry_entry: replaceReducer<SiteRegistryEntry | null>(null),
  validate_consent: replaceReducer<ValidateConsentOutput | null>(null),
  submission_approved: replaceReducer(false),
  artifact_failure_reason: replaceReducer<ReviewReason | null>(null),
  discovery_parse: replaceReducer<DiscoveryResult | null>(null),
  match_decision: replaceReducer<MatchDecision | null>(null),
  procedure_resolution_status: replaceReducer<ProcedureResolutionStatus | null>(null),
  retrieve_procedure: replaceReducer<ProcedureRetrieval | null>(null),
  draft_optout: replaceReducer<DraftOptOutOutput | null>(null),
  plan_submission: replaceReducer<PlanSubmissionOutput | null>(null),
  interpret_result: replaceReducer<InterpretResultOutput | null>(null),
  prompt_trace: mergeReducer<WorkflowPromptTrace>(createEmptyPromptTrace()),
  terminal_path: replaceReducer<WorkflowTerminalPath | null>(null),
});

type WorkflowGraphState = typeof workflowGraphState.State;

let workflowEventSequence = 0;

export class WorkflowNodeExecutionError extends Error {
  workflowEvent: WorkflowEvent;

  constructor(message: string, workflowEvent: WorkflowEvent, options?: { cause?: unknown }) {
    super(message);
    this.name = "WorkflowNodeExecutionError";
    this.workflowEvent = workflowEvent;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

function requireStateValue<T>(value: T | null, key: string): T {
  if (value === null) {
    throw new Error(`Workflow graph expected state.${key} to be populated before node execution.`);
  }

  return value;
}

function nextContextWithReviewReasons(context: GraphContext, reviewReasons: ReviewReason[]) {
  if (reviewReasons.length === 0) {
    return context;
  }

  return {
    ...context,
    review_reasons: unique([...context.review_reasons, ...reviewReasons]),
  };
}

function classifyWorkflowNodeFailure(error: unknown) {
  if (error instanceof StructuredLlmOutputValidationError) {
    return {
      reviewReasons: ["manual_submission_required"] as ReviewReason[],
      message: `Model output validation failed for prompt ${error.promptName}.`,
    };
  }

  if (error instanceof StructuredLlmError) {
    return {
      reviewReasons: ["manual_submission_required"] as ReviewReason[],
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      reviewReasons: ["manual_submission_required"] as ReviewReason[],
      message: error.message,
    };
  }

  return {
    reviewReasons: ["manual_submission_required"] as ReviewReason[],
    message: "Unknown workflow node failure.",
  };
}

function createWorkflowEvent(
  context: GraphContext,
  site: string,
  phase: WorkflowEvent["phase"],
  status: WorkflowEvent["status"],
  message: string,
  options: {
    candidateId?: string;
    reviewReasons?: ReviewReason[];
    createdAt?: string;
  } = {},
): WorkflowEvent {
  workflowEventSequence += 1;

  return workflowEventSchema.parse({
    eventId: `evt_${toSiteId(site)}_${phase}_${workflowEventSequence}`,
    runId: context.run_id,
    phase,
    status,
    message,
    createdAt: options.createdAt ?? new Date().toISOString(),
    siteId: toSiteId(site),
    candidateId: options.candidateId,
    reviewReasons: unique(options.reviewReasons ?? []),
  });
}

function appendWorkflowEvent(
  context: GraphContext,
  site: string,
  phase: WorkflowEvent["phase"],
  status: WorkflowEvent["status"],
  message: string,
  options: {
    candidateId?: string;
    reviewReasons?: ReviewReason[];
    createdAt?: string;
  } = {},
) {
  const event = createWorkflowEvent(context, site, phase, status, message, options);

  return {
    context: graphContextSchema.parse({
      ...context,
      events: [...context.events, event],
    }),
    event,
  };
}

function appendWorkflowNodeFailureEvent(
  context: GraphContext,
  site: string,
  phase: WorkflowEvent["phase"],
  error: unknown,
) {
  const failure = classifyWorkflowNodeFailure(error);
  const { context: nextContext, event } = appendWorkflowEvent(
    context,
    site,
    phase,
    "failed",
    failure.message,
    {
      reviewReasons: failure.reviewReasons,
    },
  );

  return {
    context: nextContextWithReviewReasons(nextContext, failure.reviewReasons),
    event,
  };
}

function createWorkflowAbortSignal(): AbortSignal {
  const controller = new AbortController();
  const signal = controller.signal as AbortSignal & { throwIfAborted?: () => void; reason?: unknown };

  if (typeof signal.throwIfAborted !== "function") {
    signal.throwIfAborted = () => {
      if (signal.aborted) {
        throw signal.reason ?? new Error("Workflow execution was aborted.");
      }
    };
  }

  return signal;
}

function unique<T extends string>(values: T[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function addDays(timestamp: string, days: number) {
  const date = new Date(timestamp);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function inferProcedureChannelFromChunks(chunks: ProcedureSourceChunk[]): "email" | "webform" | null {
  const combined = chunks.map((chunk) => chunk.quote).join(" ").toLowerCase();
  if (!combined) {
    return null;
  }

  if (combined.includes("webform") || combined.includes("form") || combined.includes("checkbox")) {
    return "webform";
  }

  if (combined.includes("email") || /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(combined)) {
    return "email";
  }

  return null;
}

function inferRequiredFieldsFromChunks(chunks: ProcedureSourceChunk[]) {
  const combined = chunks.map((chunk) => chunk.quote).join(" ").toLowerCase();

  return unique(
    [
      combined.includes("name") ? "full_name" : "",
      combined.includes("email") ? "privacy_email" : "",
      combined.includes("address") ? "address" : "",
      combined.includes("age") ? "approx_age" : "",
    ].filter(Boolean),
  );
}

function hasIncompleteProcedureDocs(chunks: ProcedureSourceChunk[]) {
  if (chunks.length === 0) {
    return false;
  }

  return inferProcedureChannelFromChunks(chunks) === null || inferRequiredFieldsFromChunks(chunks).length === 0;
}

function buildNoGroundingProcedureFallback(site: string, chunks: ProcedureSourceChunk[]) {
  if (chunks.length === 0 || !hasIncompleteProcedureDocs(chunks)) {
    return null;
  }

  const procedureType = inferProcedureChannelFromChunks(chunks) ?? "email";
  const requiredFields = inferRequiredFieldsFromChunks(chunks);

  return retrieveProcedureOutputSchema.parse({
    site,
    procedure_type: procedureType,
    required_fields: requiredFields.length > 0 ? requiredFields : ["full_name", "privacy_email"],
    steps: unique(chunks.map((chunk) => chunk.quote.trim()).filter(Boolean)),
    source_chunks: chunks,
  });
}

function toSiteId(site: string) {
  return site.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function toCandidateId(url: string) {
  return url;
}

const reviewBlockingPaths: Array<WorkflowTerminalPath> = [
  "low_confidence_match_blocked",
  "manual_review",
  "captcha_review",
  "blocked",
  "site_unreachable",
  "retry_exhausted",
  "missing_procedure",
  "stale_procedure",
  "contradictory_procedure",
];

const successfulPaths: Array<WorkflowTerminalPath> = [
  "completed",
  "await_confirmation",
  "retry_scheduled",
];

function buildMonitoringRecord(siteRun: {
  site_input: WorkflowSiteRunOutput["site_input"];
  context: GraphContext;
  discovery_parse: WorkflowSiteRunOutput["discovery_parse"];
  interpret_result: WorkflowSiteRunOutput["interpret_result"];
  terminal_path: WorkflowSiteRunOutput["terminal_path"];
  checkpoint: WorkflowCheckpointState | null;
}): WorkflowMonitoringRecord {
  const lastScanAt = siteRun.discovery_parse.scan_timestamp;
  const cadenceAt = addDays(lastScanAt, siteRun.context.policy.monitoring_cadence_days);
  const cooldownEndsAt = addDays(lastScanAt, siteRun.context.policy.re_review_cooldown_days);
  const pendingFollowUpDays = Math.max(
    1,
    Math.min(siteRun.context.policy.monitoring_cadence_days, Math.max(siteRun.context.policy.re_review_cooldown_days, 1)),
  );
  const pendingFollowUpAt = addDays(lastScanAt, pendingFollowUpDays);
  const priorExecutionStatus = siteRun.site_input.execution_result?.status ?? null;
  const reappearanceCount = siteRun.discovery_parse.found && priorExecutionStatus === "submitted" ? 1 : 0;
  const thresholdMet = reappearanceCount >= siteRun.context.policy.re_review_listing_reappearance_threshold;
  const awaitingConfirmation = siteRun.terminal_path === "await_confirmation"
    || siteRun.interpret_result?.next_action === "await_confirmation";
  const reviewBlocked = siteRun.terminal_path !== null && reviewBlockingPaths.includes(siteRun.terminal_path);
  const successful = siteRun.terminal_path !== null && successfulPaths.includes(siteRun.terminal_path);

  if (reviewBlocked) {
    return workflowMonitoringRecordSchema.parse({
      status: "manual_review",
      reason: "review_blocked",
      last_scan_at: lastScanAt,
      next_scan_at: null,
      cooldown_ends_at: null,
      reappearance_count: reappearanceCount,
      trigger_new_removal_cycle: false,
      backend_required: true,
      notes: `Monitoring is paused for ${siteRun.site_input.site} until review-blocking workflow issues are resolved.`,
    });
  }

  if (thresholdMet) {
    const dueImmediately = siteRun.context.policy.re_review_cooldown_days === 0;

    return workflowMonitoringRecordSchema.parse({
      status: dueImmediately ? "rescan_due" : "scheduled",
      reason: "listing_reappeared",
      last_scan_at: lastScanAt,
      next_scan_at: dueImmediately ? lastScanAt : cooldownEndsAt,
      cooldown_ends_at: cooldownEndsAt,
      reappearance_count: reappearanceCount,
      trigger_new_removal_cycle: dueImmediately,
      backend_required: true,
      notes: dueImmediately
        ? `Listing still appears on ${siteRun.site_input.site} after a prior submitted removal; start a new removal cycle when backend scheduling exists.`
        : `Listing still appears on ${siteRun.site_input.site} after a prior submitted removal; hold until the local re-review cooldown expires before starting a new cycle.`,
    });
  }

  if (awaitingConfirmation) {
    return workflowMonitoringRecordSchema.parse({
      status: "awaiting_confirmation",
      reason: "pending_confirmation",
      last_scan_at: lastScanAt,
      next_scan_at: pendingFollowUpAt,
      cooldown_ends_at: null,
      reappearance_count: reappearanceCount,
      trigger_new_removal_cycle: false,
      backend_required: true,
      notes: `Submission for ${siteRun.site_input.site} is still awaiting confirmation; schedule a follow-up check on the local monitoring cadence until backend support lands.`,
    });
  }

  if (siteRun.checkpoint?.resume_required || siteRun.terminal_path === null) {
    return workflowMonitoringRecordSchema.parse({
      status: "not_applicable",
      reason: "none",
      last_scan_at: lastScanAt,
      next_scan_at: null,
      cooldown_ends_at: null,
      reappearance_count: reappearanceCount,
      trigger_new_removal_cycle: false,
      backend_required: true,
      notes: `Monitoring has not been scheduled for ${siteRun.site_input.site} because the workflow is still in progress.`,
    });
  }

  return workflowMonitoringRecordSchema.parse({
    status: successful || siteRun.terminal_path === "no_match" ? "scheduled" : "not_applicable",
    reason: successful || siteRun.terminal_path === "no_match" ? "cadence" : "none",
    last_scan_at: lastScanAt,
    next_scan_at: successful || siteRun.terminal_path === "no_match" ? cadenceAt : null,
    cooldown_ends_at: null,
    reappearance_count: reappearanceCount,
    trigger_new_removal_cycle: false,
    backend_required: true,
    notes: successful || siteRun.terminal_path === "no_match"
      ? `Prototype monitoring is scheduled locally for ${siteRun.site_input.site}; the next re-scan is due on the configured cadence.`
      : `No monitoring action is scheduled for ${siteRun.site_input.site} from this workflow outcome.`,
  });
}

function classifyMatchDecision(
  found: boolean,
  confidence: number,
): "exact_match" | "likely_match" | "possible_match" | "no_match" {
  if (!found) return "no_match";
  if (confidence >= 0.9) return "exact_match";
  if (confidence >= 0.75) return "likely_match";
  return "possible_match";
}

function buildMatchRationale(
  decision: "exact_match" | "likely_match" | "possible_match" | "no_match",
  candidate: DiscoveryCandidate | null,
  seedProfile: SeedProfile,
) {
  if (!candidate || decision === "no_match") {
    return `No reliable ${seedProfile.full_name} match was found in the captured listing artifact.`;
  }

  return `Captured listing matched ${candidate.extracted.name} with confidence ${candidate.match_confidence.toFixed(2)} based on name, location, and available profile evidence.`;
}

function buildMatchDecision(
  site: string,
  pageUrl: string,
  discoveryResult: DiscoveryResult,
  seedProfile: SeedProfile,
  reviewReasons: ReviewReason[],
): MatchDecision | null {
  const candidate = discoveryResult.candidates[0] ?? null;
  const decision = classifyMatchDecision(discoveryResult.found, candidate?.match_confidence ?? 0);

  if (!candidate) {
    return {
      siteId: toSiteId(site),
      candidateId: toCandidateId(pageUrl),
      decision,
      confidence: 0,
      rationale: buildMatchRationale(decision, null, seedProfile),
      evidence: [
        {
          sourceType: "listing_page",
          sourceUrl: pageUrl,
          excerpt: discoveryResult.notes ?? "No likely match found in extracted page text.",
          capturedAt: discoveryResult.scan_timestamp,
          fields: [],
        },
      ],
      reviewReasons: unique(reviewReasons),
    };
  }

  return {
    siteId: toSiteId(site),
    candidateId: toCandidateId(candidate.url),
    decision,
    confidence: candidate.match_confidence,
    rationale: buildMatchRationale(decision, candidate, seedProfile),
    evidence: candidate.evidence_snippets.map((snippet) => ({
      sourceType: "listing_page",
      sourceUrl: candidate.url,
      excerpt: snippet,
      capturedAt: discoveryResult.scan_timestamp,
      fields: [
        { field: "full_name", value: candidate.extracted.name },
        ...(candidate.extracted.age ? [{ field: "approx_age", value: candidate.extracted.age }] : []),
        ...candidate.extracted.addresses.map((address) => ({ field: "address", value: address })),
        ...candidate.extracted.relatives.map((relative) => ({ field: "relative", value: relative })),
        ...candidate.extracted.phones.map((phone) => ({ field: "phone", value: phone })),
      ],
    })),
    reviewReasons: unique(reviewReasons),
  };
}


function shouldBlockOnProcedureResolution(status: ProcedureResolutionStatus, context: GraphContext) {
  if (status === "stale") {
    return context.policy.stale_procedure_strategy === "block";
  }
  if (status === "contradictory") {
    return context.policy.contradictory_procedure_strategy === "block";
  }
  return status !== "found";
}

function resolveDiscoveryBranch(state: WorkflowGraphState) {
  const input = requireStateValue(state.input, "input");
  const context = requireStateValue(state.context, "context");
  const artifactFailureReason = state.artifact_failure_reason;
  const discoveryParse = requireStateValue(state.discovery_parse, "discovery_parse");
  const topCandidate = discoveryParse.candidates[0];
  const confidenceBelowThreshold = !topCandidate
    || topCandidate.match_confidence < context.policy.match_confidence_threshold;
  const blockOnLowConfidence = confidenceBelowThreshold && context.policy.low_confidence_match_strategy === "block";

  if (artifactFailureReason === "captcha") {
    return "node_terminal_captcha_review" as const;
  }

  if (artifactFailureReason === "rate_limited") {
    return "node_terminal_blocked" as const;
  }

  if (artifactFailureReason === "site_unreachable") {
    return "node_terminal_site_unreachable" as const;
  }

  if (discoveryParse.found && topCandidate && !blockOnLowConfidence) {
    return "node_retrieve_procedure" as const;
  }

  if (input.site_input.execution_result) {
    return "node_interpret_result" as const;
  }

  if (blockOnLowConfidence) {
    return "node_terminal_low_confidence" as const;
  }

  return "node_terminal_no_match" as const;
}

function resolveProcedureBranch(state: WorkflowGraphState) {
  const input = requireStateValue(state.input, "input");
  const context = requireStateValue(state.context, "context");
  const procedure = requireStateValue(state.retrieve_procedure, "retrieve_procedure");
  const hasGroundedProcedure = procedure.procedure_type !== "procedure_unknown"
    && (!context.policy.require_retrieval_grounding || procedure.source_chunks.length > 0);

  if (hasGroundedProcedure && state.submission_approved) {
    return "node_draft_optout" as const;
  }

  if (input.site_input.execution_result) {
    return "node_interpret_result" as const;
  }

  switch (state.procedure_resolution_status) {
    case "stale":
      return "node_terminal_stale_procedure" as const;
    case "contradictory":
      return "node_terminal_contradictory_procedure" as const;
    case "missing":
      return "node_terminal_missing_procedure" as const;
    default:
      return "node_terminal_missing_procedure" as const;
  }
}

function resolvePlanSubmissionBranch(state: WorkflowGraphState) {
  const input = requireStateValue(state.input, "input");
  return input.site_input.execution_result ? "node_interpret_result" as const : "node_terminal_completed" as const;
}

function resolveInterpretResultBranch(state: WorkflowGraphState) {
  const context = requireStateValue(state.context, "context");
  const input = requireStateValue(state.input, "input");
  const interpretResult = requireStateValue(state.interpret_result, "interpret_result");

  if (interpretResult.review_reasons.includes("captcha")) {
    return "node_terminal_captcha_review" as const;
  }

  if (
    interpretResult.next_action === "request_user_review"
    && input.site_input.retry_count >= context.policy.max_submission_retries
    && interpretResult.review_reasons.includes("manual_submission_required")
  ) {
    return "node_terminal_retry_exhausted" as const;
  }

  if (interpretResult.next_action === "retry") {
    return "node_terminal_retry_scheduled" as const;
  }

  if (interpretResult.next_action === "request_user_review" || interpretResult.next_status === "manual_required") {
    return "node_terminal_manual_review" as const;
  }

  if (interpretResult.next_action === "await_confirmation" || interpretResult.next_status === "pending") {
    return "node_terminal_await_confirmation" as const;
  }

  return "node_terminal_completed" as const;
}

function createCheckpointConfig(checkpoint?: WorkflowCheckpointConfig) {
  if (!checkpoint) {
    return {};
  }

  return {
    configurable: {
      thread_id: checkpoint.thread_id,
      ...(checkpoint.checkpoint_id ? { checkpoint_id: checkpoint.checkpoint_id } : {}),
    },
  };
}

function inferArtifactFailureReason(pageArtifact: PageContentArtifact): ReviewReason | null {
  const visibleText = pageArtifact.visible_text.trim();
  const metadataText = [
    pageArtifact.extracted_metadata?.title,
    pageArtifact.extracted_metadata?.description,
    pageArtifact.extracted_metadata?.page_category,
  ].filter(Boolean).join(" ").toLowerCase();
  const combined = `${visibleText}\n${metadataText}`.toLowerCase();

  if (visibleText.length === 0) {
    return "site_unreachable";
  }

  if (
    /captcha|verify you are human|human verification|recaptcha|cloudflare/i.test(combined)
  ) {
    return "captcha";
  }

  if (
    /access denied|forbidden|blocked|temporarily blocked|unusual traffic|automated queries|bot detection/i.test(combined)
  ) {
    return "rate_limited";
  }

  if (
    /redirect|redirecting|moved permanently|found\. taking you|this page has moved/i.test(combined)
    || pageArtifact.extracted_metadata?.page_category === "redirect"
  ) {
    return "site_unreachable";
  }

  return null;
}

function createSiteCheckpointConfig(checkpoint: WorkflowCheckpointConfig, site: string): WorkflowCheckpointConfig {
  return workflowCheckpointConfigSchema.parse({
    thread_id: `${checkpoint.thread_id}::${site}`,
    ...(checkpoint.checkpoint_id ? { checkpoint_id: checkpoint.checkpoint_id } : {}),
  });
}

async function readExistingSnapshot(
  graph: {
    getState: (config: ReturnType<typeof createCheckpointConfig>) => Promise<{
      values: unknown;
      next: string[];
      config?: { configurable?: Record<string, unknown> };
    }>;
  },
  checkpoint: WorkflowCheckpointConfig,
) {
  try {
    const snapshot = await graph.getState(createCheckpointConfig(checkpoint));
    const values = snapshot.values as Partial<WorkflowGraphState> | undefined;

    if (!values || Object.keys(values).length === 0) {
      return null;
    }

    return snapshot;
  } catch {
    return null;
  }
}

function readCheckpointState(
  snapshot: { config?: { configurable?: Record<string, unknown> }; next: string[] } | null,
) {
  if (!snapshot) {
    return null;
  }

  const configurable = snapshot.config?.configurable ?? {};
  const threadId = typeof configurable.thread_id === "string" ? configurable.thread_id : null;
  if (!threadId) {
    return null;
  }

  return workflowCheckpointStateSchema.parse({
    thread_id: threadId,
    checkpoint_id: typeof configurable.checkpoint_id === "string" ? configurable.checkpoint_id : undefined,
    next: snapshot.next,
    resume_required: snapshot.next.length > 0,
  });
}

function buildRunOutputFromState(
  state: WorkflowGraphState,
  checkpoint: WorkflowCheckpointState | null,
) {
  const siteRun = {
    site_input: requireStateValue(requireStateValue(state.input, "input").site_input, "input.site_input"),
    context: requireStateValue(state.context, "context"),
    validate_consent: requireStateValue(state.validate_consent, "validate_consent"),
    discovery_parse: requireStateValue(state.discovery_parse, "discovery_parse"),
    match_decision: state.match_decision,
    retrieve_procedure: state.retrieve_procedure,
    draft_optout: state.draft_optout,
    plan_submission: state.plan_submission,
    interpret_result: state.interpret_result,
    automation_record: null,
    prompt_trace: state.prompt_trace,
    terminal_path: state.terminal_path,
    checkpoint,
  };

  return workflowSiteRunOutputSchema.parse({
    ...siteRun,
    monitoring: buildMonitoringRecord(siteRun),
  });
}

function mergeAutomationIntoSiteRuns(
  output: WorkflowRunOutput,
  automationRecords: Map<string, WorkflowAutomationRecord>,
): WorkflowRunOutput {
  const siteRuns = output.site_runs.map((siteRun) => workflowSiteRunOutputSchema.parse({
    ...siteRun,
    automation_record: automationRecords.get(siteRun.site_input.site) ?? null,
  }));
  const primarySiteRun = siteRuns[0] ?? output.site_runs[0];

  return workflowRunOutputSchema.parse({
    ...output,
    ...primarySiteRun,
    site_runs: siteRuns,
  });
}

function mergeWorkflowContext(baseContext: GraphContext, siteRuns: WorkflowSiteRunOutput[]): GraphContext {
  const resolvedPolicy = siteRuns[0]?.context.policy ?? baseContext.policy;

  return graphContextSchema.parse({
    ...baseContext,
    policy: resolvedPolicy,
    review_reasons: unique(siteRuns.flatMap((siteRun) => siteRun.context.review_reasons)),
    events: siteRuns.flatMap((siteRun) => siteRun.context.events),
  });
}

function buildOrchestrationCheckpoint(
  checkpoint: WorkflowCheckpointConfig,
  siteRuns: Array<{ site: string; result: WorkflowSiteRunOutput }>,
): WorkflowOrchestrationCheckpointState {
  const pendingSites = siteRuns
    .filter(({ result }) => result.checkpoint?.resume_required)
    .map(({ site }) => site);

  return workflowOrchestrationCheckpointStateSchema.parse({
    thread_id: checkpoint.thread_id,
    checkpoint_id: checkpoint.checkpoint_id,
    pending_sites: pendingSites,
    site_checkpoints: siteRuns.map(({ site, result }) => ({
      site,
      checkpoint: result.checkpoint,
    })),
    resume_required: pendingSites.length > 0,
  });
}

function buildPublicCheckpoint(
  checkpoint: WorkflowCheckpointConfig | null,
  primarySiteRun: WorkflowSiteRunOutput,
  orchestrationCheckpoint: WorkflowOrchestrationCheckpointState | null,
): WorkflowCheckpointState | null {
  if (!checkpoint) {
    return primarySiteRun.checkpoint;
  }

  return workflowCheckpointStateSchema.parse({
    thread_id: checkpoint.thread_id,
    checkpoint_id: checkpoint.checkpoint_id,
    next: primarySiteRun.checkpoint?.next ?? [],
    resume_required: orchestrationCheckpoint?.resume_required ?? primarySiteRun.checkpoint?.resume_required ?? false,
  });
}

function buildRunSummary(
  requestedSites: string[],
  siteRuns: WorkflowSiteRunOutput[],
): WorkflowRunSummary {
  const siteOutcomes = siteRuns.map((siteRun) => {
    const terminalPath = siteRun.terminal_path;
    const pending = siteRun.checkpoint?.resume_required === true || terminalPath === null;
    const reviewBlocked = terminalPath !== null && reviewBlockingPaths.includes(terminalPath);
    const successful = terminalPath !== null && successfulPaths.includes(terminalPath);

    return {
      site: siteRun.site_input.site,
      terminal_path: terminalPath,
      retry_count: siteRun.site_input.retry_count,
      review_blocked: reviewBlocked,
      successful,
      pending,
    };
  });
  const sitesByTerminalPath = siteRuns.reduce<Record<string, number>>((counts, siteRun) => {
    const key = siteRun.terminal_path ?? "in_progress";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const pendingSites = siteOutcomes.filter((siteOutcome) => siteOutcome.pending).length;
  const successfulSites = siteOutcomes.filter((siteOutcome) => siteOutcome.successful).length;
  const blockedSites = siteOutcomes.filter((siteOutcome) => siteOutcome.review_blocked).length;
  const completedSites = siteOutcomes.filter((siteOutcome) => !siteOutcome.pending).length;
  const partialSuccess = successfulSites > 0 && (blockedSites > 0 || pendingSites > 0 || successfulSites < siteRuns.length);
  const overallStatus = pendingSites > 0
    ? "in_progress"
    : partialSuccess
      ? "partial_success"
      : blockedSites > 0
        ? "awaiting_review"
        : "completed";

  return workflowRunSummarySchema.parse({
    overall_status: overallStatus,
    partial_success: partialSuccess,
    requested_sites: requestedSites,
    processed_sites: siteRuns.map((siteRun) => siteRun.site_input.site),
    total_requested_sites: requestedSites.length > 0 ? requestedSites.length : siteRuns.length,
    total_processed_sites: siteRuns.length,
    completed_sites: completedSites,
    pending_sites: pendingSites,
    successful_sites: successfulSites,
    blocked_sites: blockedSites,
    manual_review_sites: siteRuns.filter((siteRun) => (
      siteRun.terminal_path === "manual_review"
      || siteRun.terminal_path === "captcha_review"
      || siteRun.terminal_path === "blocked"
      || siteRun.terminal_path === "site_unreachable"
      || siteRun.terminal_path === "retry_exhausted"
      || siteRun.terminal_path === "low_confidence_match_blocked"
    )).length,
    matched_sites: siteRuns.filter((siteRun) => siteRun.discovery_parse.found).length,
    no_match_sites: siteRuns.filter((siteRun) => siteRun.terminal_path === "no_match").length,
    total_retry_count: siteOutcomes.reduce((sum, siteOutcome) => sum + siteOutcome.retry_count, 0),
    monitoring: {
      scheduled_sites: siteRuns.filter((siteRun) => siteRun.monitoring.status === "scheduled").length,
      awaiting_confirmation_sites: siteRuns.filter((siteRun) => siteRun.monitoring.status === "awaiting_confirmation").length,
      due_sites: siteRuns.filter((siteRun) => siteRun.monitoring.status === "rescan_due").length,
      manual_review_sites: siteRuns.filter((siteRun) => siteRun.monitoring.status === "manual_review").length,
      new_removal_cycle_sites: siteRuns.filter((siteRun) => siteRun.monitoring.trigger_new_removal_cycle).length,
    },
    sites_by_terminal_path: sitesByTerminalPath,
    site_outcomes: siteOutcomes,
  });
}

function resolveWorkflowLlmAdapter(options?: AgentWorkflowLlmOptions) {
  if (!options) {
    return null;
  }

  if (options.adapter) {
    return options.adapter;
  }

  if (options.config) {
    return createStructuredLlmAdapterFromConfig(options.config, {
      transport: options.transport,
    });
  }

  if (options.env) {
    return createStructuredLlmAdapterFromEnv({
      env: options.env,
      headers: options.headers,
      transport: options.transport,
    });
  }

  return null;
}

function createMissingStructuredNodeError(nodeName: keyof Pick<
  AgentWorkflowNodes,
  "discoveryParse" | "retrieveProcedure" | "draftOptOut" | "interpretResult"
>) {
  return new Error(
    `Workflow node ${nodeName} now requires a prompt-backed structured output implementation. Provide options.llm or override options.nodes.${nodeName}.`,
  );
}

function createRequiredStructuredNodes(adapter: StructuredLlmAdapter | null): Pick<
  AgentWorkflowNodes,
  "discoveryParse" | "retrieveProcedure" | "draftOptOut" | "interpretResult"
> {
  if (adapter) {
    return createPromptBackedNodes(adapter);
  }

  return {
    async discoveryParse() {
      throw createMissingStructuredNodeError("discoveryParse");
    },
    async retrieveProcedure() {
      throw createMissingStructuredNodeError("retrieveProcedure");
    },
    async draftOptOut() {
      throw createMissingStructuredNodeError("draftOptOut");
    },
    async interpretResult() {
      throw createMissingStructuredNodeError("interpretResult");
    },
  };
}

function createDefaultNodes(): Pick<AgentWorkflowNodes, "validateConsent" | "planSubmission"> {
  return {
    validateConsent(input, context) {
      return {
        seed_profile: input.seed_profile,
        normalized_query: [input.seed_profile.full_name, input.seed_profile.location.city, input.seed_profile.location.state].join(" "),
        approved_for_submission: context.policy.require_explicit_consent
          ? input.seed_profile.consent
          : true,
      };
    },

    planSubmission(input, context) {
      const topCandidate = input.discovery_result.candidates[0];
      const reviewReasons = [...context.review_reasons];

      if (input.procedure.procedure_type === "procedure_unknown") {
        reviewReasons.push("procedure_unknown");
      }
      if (context.policy.require_retrieval_grounding && input.procedure.source_chunks.length === 0) {
        reviewReasons.push("procedure_unknown");
      }
      if (!topCandidate || topCandidate.match_confidence < context.policy.match_confidence_threshold) {
        reviewReasons.push("low_confidence_match");
      }

      return {
        action_plan: {
          ...input.submission_payload,
          manual_review_required: reviewReasons.length > 0,
          review_reasons: unique(reviewReasons),
        },
        requires_manual_review: reviewReasons.length > 0,
        review_reasons: unique(reviewReasons),
      };
    },

    interpretResult(input, context) {
      const reviewReasons = [...context.review_reasons, ...input.prior_review_reasons];
      const captchaOrManual = hasCaptchaOrManualSignal(input.execution_result);

      if (captchaOrManual) {
        return {
          next_status: "manual_required",
          next_action: context.policy.captcha_failure_strategy,
          review_reasons: unique([...reviewReasons, "captcha"]),
        };
      }

      switch (input.execution_result.status) {
        case "manual_required":
          return {
            next_status: "manual_required",
            next_action: context.policy.manual_requirement_strategy,
            review_reasons: unique(reviewReasons.length > 0 ? reviewReasons : ["manual_submission_required"]),
          };
        case "pending":
          return {
            next_status: "pending",
            next_action: context.policy.pending_confirmation_strategy,
            review_reasons: unique(reviewReasons),
          };
        case "failed":
          if (input.retry_count >= context.policy.max_submission_retries) {
            return {
              next_status: "failed",
              next_action: "request_user_review",
              review_reasons: unique([...reviewReasons, "manual_submission_required"]),
            };
          }

          return {
            next_status: "failed",
            next_action: "retry",
            review_reasons: unique(reviewReasons),
          };
        default:
          if (!hasClearExecutionEvidence(input.execution_result)) {
            return {
              next_status: "pending",
              next_action: context.policy.pending_confirmation_strategy,
              review_reasons: unique(reviewReasons),
            };
          }

          return {
            next_status: "submitted",
            next_action: "none",
            review_reasons: unique(reviewReasons),
          };
      }
    },
  };
}

export function createAgentWorkflow(options: AgentWorkflowOptions = {}) {
  const llmAdapter = resolveWorkflowLlmAdapter(options.llm);
  const promptBackedNodes = createRequiredStructuredNodes(llmAdapter);
  const defaultNodes = createDefaultNodes();
  const nodes = {
    ...defaultNodes,
    ...promptBackedNodes,
    validateConsent: createDefaultConsentNode(),
    ...options.nodes,
  } satisfies AgentWorkflowNodes;
  const promptTrace = {
    discovery_parse: readPromptTrace(nodes.discoveryParse),
    retrieve_procedure: readPromptTrace(nodes.retrieveProcedure),
    draft_optout: readPromptTrace(nodes.draftOptOut),
    interpret_result: readPromptTrace(nodes.interpretResult),
  };
  const registry = options.siteRegistry ?? [];
  const procedureRetriever = options.procedureRetriever ?? createDefaultProcedureRetriever();
  const checkpointer = options.checkpointer === undefined ? new MemorySaver() : options.checkpointer;
  const createTerminalNode = (
    terminalPath: WorkflowTerminalPath,
    phase: WorkflowEvent["phase"],
    status: WorkflowEvent["status"],
    messageBuilder: (state: WorkflowGraphState) => string,
  ) => async (state: WorkflowGraphState) => {
    const input = requireStateValue(state.input, "input");
    const context = requireStateValue(state.context, "context");
    const reviewReasons = unique([
      ...context.review_reasons,
      ...(state.interpret_result?.review_reasons ?? []),
    ]);
    const { context: nextContext } = appendWorkflowEvent(
      context,
      input.site_input.site,
      phase,
      status,
      messageBuilder(state),
      {
        candidateId: state.match_decision?.candidateId,
        reviewReasons,
      },
    );

    return {
      context: nextContext,
      terminal_path: terminalPath,
    };
  };

  const graph = new StateGraph(workflowGraphState)
    .addNode("node_terminal_completed", createTerminalNode(
      "completed",
      "completed",
      "completed",
      (state) => `Workflow completed for ${requireStateValue(state.input, "input").site_input.site}.`,
    ))
    .addNode("node_terminal_await_confirmation", createTerminalNode(
      "await_confirmation",
      "verification",
      "awaiting_user",
      (state) => `Submission pending confirmation for ${requireStateValue(state.input, "input").site_input.site}.`,
    ))
    .addNode("node_terminal_retry_scheduled", createTerminalNode(
      "retry_scheduled",
      "verification",
      "in_progress",
      (state) => `Retry scheduled for ${requireStateValue(state.input, "input").site_input.site}.`,
    ))
    .addNode("node_terminal_retry_exhausted", createTerminalNode(
      "retry_exhausted",
      "verification",
      "blocked",
      (state) => `Retry budget exhausted for ${requireStateValue(state.input, "input").site_input.site}.`,
    ))
    .addNode("node_terminal_manual_review", createTerminalNode(
      "manual_review",
      "verification",
      "awaiting_user",
      (state) => `Manual review required for ${requireStateValue(state.input, "input").site_input.site}.`,
    ))
    .addNode("node_terminal_captcha_review", createTerminalNode(
      "captcha_review",
      "verification",
      "awaiting_user",
      (state) => `CAPTCHA or anti-bot review required for ${requireStateValue(state.input, "input").site_input.site}.`,
    ))
    .addNode("node_terminal_blocked", createTerminalNode(
      "blocked",
      "scan",
      "blocked",
      (state) => `Workflow blocked for ${requireStateValue(state.input, "input").site_input.site}.`,
    ))
    .addNode("node_terminal_no_match", createTerminalNode(
      "no_match",
      "match",
      "completed",
      (state) => `No match found for ${requireStateValue(state.input, "input").site_input.site}.`,
    ))
    .addNode("node_terminal_site_unreachable", createTerminalNode(
      "site_unreachable",
      "scan",
      "failed",
      (state) => `Listing artifact was unreachable for ${requireStateValue(state.input, "input").site_input.site}.`,
    ))
    .addNode("node_terminal_low_confidence", createTerminalNode(
      "low_confidence_match_blocked",
      "match",
      "blocked",
      (state) => `Low-confidence match blocked workflow progression for ${requireStateValue(state.input, "input").site_input.site}.`,
    ))
    .addNode("node_terminal_missing_procedure", createTerminalNode(
      "missing_procedure",
      "retrieve_procedure",
      "blocked",
      (state) => `No usable removal procedure was found for ${requireStateValue(state.input, "input").site_input.site}.`,
    ))
    .addNode("node_terminal_stale_procedure", createTerminalNode(
      "stale_procedure",
      "retrieve_procedure",
      "blocked",
      (state) => `Retrieved procedure was stale for ${requireStateValue(state.input, "input").site_input.site}.`,
    ))
    .addNode("node_terminal_contradictory_procedure", createTerminalNode(
      "contradictory_procedure",
      "retrieve_procedure",
      "blocked",
      (state) => `Retrieved procedure was contradictory for ${requireStateValue(state.input, "input").site_input.site}.`,
    ))
    .addNode("node_validate_consent", async (state: WorkflowGraphState) => {
      const input = requireStateValue(state.input, "input");
      const context = requireStateValue(state.context, "context");
      const validateConsent = await nodes.validateConsent(
        {
          seed_profile: input.seed_profile,
          request_text: input.request_text,
        },
        context,
      );
      const { context: nextContext } = appendWorkflowEvent(
        context,
        input.site_input.site,
        "intake",
        validateConsent.approved_for_submission ? "completed" : "awaiting_user",
        validateConsent.approved_for_submission
          ? `Consent validated for ${input.site_input.site}.`
          : `Consent missing or approval withheld for ${input.site_input.site}.`,
      );

      return {
        context: nextContext,
        validate_consent: validateConsent,
        submission_approved: !context.policy.require_explicit_consent || validateConsent.approved_for_submission,
      };
    })
    .addNode("node_discovery_parse", async (state: WorkflowGraphState) => {
      const input = requireStateValue(state.input, "input");
      const context = requireStateValue(state.context, "context");
      const normalizedPageArtifact = normalizePageArtifactForDiscovery(input.site_input.page_artifact);
      const artifactFailureReason = inferArtifactFailureReason(normalizedPageArtifact);

      if (artifactFailureReason) {
        const nextContext = nextContextWithReviewReasons(context, [artifactFailureReason]);
        const discoveryParse = discoveryParseOutputSchema.parse({
          site: input.site_input.site,
          scan_timestamp: new Date().toISOString(),
          found: false,
          candidates: [],
          notes: artifactFailureReason === "captcha"
            ? "Automation capture appears to be an anti-bot or CAPTCHA page."
            : artifactFailureReason === "rate_limited"
              ? "Automation capture indicates the site blocked or rate-limited access."
              : "Automation capture was empty or redirected away from the expected listing page.",
        });
        const { context: eventContext } = appendWorkflowEvent(
          nextContext,
          input.site_input.site,
          "scan",
          artifactFailureReason === "rate_limited" ? "blocked" : "failed",
          discoveryParse.notes ?? `Artifact analysis failed for ${input.site_input.site}.`,
          {
            reviewReasons: [artifactFailureReason],
            createdAt: discoveryParse.scan_timestamp,
          },
        );

        return {
          discovery_parse: discoveryParse,
          context: eventContext,
          artifact_failure_reason: artifactFailureReason,
          prompt_trace: {
            discovery_parse: null,
          },
          match_decision: buildMatchDecision(
            input.site_input.site,
            normalizedPageArtifact.url,
            discoveryParse,
            input.seed_profile,
            nextContext.review_reasons,
          ),
        };
      }

      const parsedPageArtifact = pageContentArtifactSchema.parse(normalizedPageArtifact);
      let discoveryParse: DiscoveryParseOutput;
      try {
        discoveryParse = await nodes.discoveryParse(
          {
            seed_profile: input.seed_profile,
            site: input.site_input.site,
            page_artifact: parsedPageArtifact,
          },
          context,
        );
      } catch (error) {
        const { event } = appendWorkflowNodeFailureEvent(context, input.site_input.site, "scan", error);
        throw new WorkflowNodeExecutionError(event.message, event, { cause: error });
      }

      const topCandidate = discoveryParse.candidates[0];
      const confidenceBelowThreshold = !topCandidate
        || topCandidate.match_confidence < context.policy.match_confidence_threshold;
      const nextContext = confidenceBelowThreshold
        ? nextContextWithReviewReasons(context, ["low_confidence_match"])
        : context;
      const matchDecision = buildMatchDecision(
        input.site_input.site,
        input.site_input.page_artifact.url,
        discoveryParse,
        input.seed_profile,
        nextContext.review_reasons,
      );
      const { context: eventContext } = appendWorkflowEvent(
        nextContext,
        input.site_input.site,
        discoveryParse.found ? "match" : "scan",
        confidenceBelowThreshold ? "blocked" : "completed",
        discoveryParse.found
          ? `Discovery produced ${discoveryParse.candidates.length} candidate(s) for ${input.site_input.site}.`
          : `Discovery found no candidate listings for ${input.site_input.site}.`,
        {
          candidateId: matchDecision?.candidateId,
          reviewReasons: confidenceBelowThreshold ? ["low_confidence_match"] : [],
          createdAt: discoveryParse.scan_timestamp,
        },
      );

      return {
        discovery_parse: discoveryParse,
        context: eventContext,
        artifact_failure_reason: null,
        prompt_trace: {
          discovery_parse: promptTrace.discovery_parse,
        },
        match_decision: matchDecision,
      };
    })
    .addNode("node_retrieve_procedure", async (state: WorkflowGraphState) => {
      const input = requireStateValue(state.input, "input");
      const context = requireStateValue(state.context, "context");
      const discoveryParse = requireStateValue(state.discovery_parse, "discovery_parse");
      const registryEntry = state.registry_entry;
      let procedureResolution: Awaited<ReturnType<typeof procedureRetriever>>;
      try {
        procedureResolution = await procedureRetriever(
          {
            seed_profile: input.seed_profile,
            discovery_result: discoveryParse,
            site: input.site_input.site,
            provided_chunks: input.site_input.retrieved_chunks,
            registry_chunks: registryEntry?.default_procedure_chunks ?? [],
          },
          context,
        );
      } catch (error) {
        const { event } = appendWorkflowNodeFailureEvent(context, input.site_input.site, "retrieve_procedure", error);
        throw new WorkflowNodeExecutionError(event.message, event, { cause: error });
      }

      const resolutionReviewReasons = procedureResolution.review_reasons.length > 0
        ? procedureResolution.review_reasons
        : reviewReasonsForProcedureResolution(procedureResolution.status);
      let nextContext = nextContextWithReviewReasons(context, resolutionReviewReasons);
      const noGroundingFallback = !nextContext.policy.require_retrieval_grounding
        ? buildNoGroundingProcedureFallback(input.site_input.site, procedureResolution.chunks)
        : null;

      const shouldBlockProcedure = shouldBlockOnProcedureResolution(procedureResolution.status, nextContext);
      let retrieveProcedure: RetrieveProcedureOutput;
      if (shouldBlockProcedure) {
        retrieveProcedure = retrieveProcedureOutputSchema.parse({
          site: input.site_input.site,
          procedure_type: "procedure_unknown",
          required_fields: [],
          steps: [],
          source_chunks: [],
        });
      } else if (noGroundingFallback) {
        retrieveProcedure = noGroundingFallback;
      } else {
        try {
          retrieveProcedure = await nodes.retrieveProcedure(
            {
              seed_profile: input.seed_profile,
              discovery_result: discoveryParse,
              site: input.site_input.site,
              retrieved_chunks: procedureResolution.chunks,
            },
            nextContext,
          );
        } catch (error) {
          const { event } = appendWorkflowNodeFailureEvent(nextContext, input.site_input.site, "retrieve_procedure", error);
          throw new WorkflowNodeExecutionError(event.message, event, { cause: error });
        }
      }

      const hasGroundedProcedure = retrieveProcedure.procedure_type !== "procedure_unknown"
        && (!nextContext.policy.require_retrieval_grounding || retrieveProcedure.source_chunks.length > 0);
      if (!hasGroundedProcedure) {
        nextContext = nextContextWithReviewReasons(nextContext, ["procedure_unknown"]);
      }
      const { context: eventContext } = appendWorkflowEvent(
        nextContext,
        input.site_input.site,
        "retrieve_procedure",
        shouldBlockProcedure ? "blocked" : "completed",
        `Procedure resolution ${procedureResolution.status} for ${input.site_input.site}; selected ${retrieveProcedure.procedure_type}.`,
        {
          candidateId: state.match_decision?.candidateId,
          reviewReasons: unique([
            ...resolutionReviewReasons,
            ...(hasGroundedProcedure ? [] : ["procedure_unknown"]),
          ]),
        },
      );

      return {
        context: eventContext,
        procedure_resolution_status: procedureResolution.status,
        prompt_trace: {
          retrieve_procedure: shouldBlockProcedure || noGroundingFallback ? null : promptTrace.retrieve_procedure,
        },
        retrieve_procedure: retrieveProcedure,
      };
    })
    .addNode("node_draft_optout", async (state: WorkflowGraphState) => {
      const input = requireStateValue(state.input, "input");
      const context = requireStateValue(state.context, "context");
      const discoveryParse = requireStateValue(state.discovery_parse, "discovery_parse");
      const procedure = requireStateValue(state.retrieve_procedure, "retrieve_procedure");
      const topCandidate = discoveryParse.candidates[0];

      if (!topCandidate) {
        throw new Error("Workflow graph reached draft_optout without a discovery candidate.");
      }
      let draftOptOut: DraftOptOutOutput;
      try {
        draftOptOut = await nodes.draftOptOut(
          {
            seed_profile: input.seed_profile,
            site: input.site_input.site,
            candidate_url: topCandidate.url,
            procedure,
          },
          context,
        );
      } catch (error) {
        const { event } = appendWorkflowNodeFailureEvent(context, input.site_input.site, "draft", error);
        throw new WorkflowNodeExecutionError(event.message, event, { cause: error });
      }
      const { context: nextContext } = appendWorkflowEvent(
        context,
        input.site_input.site,
        "draft",
        "completed",
        `Drafted ${draftOptOut.procedure_type} submission payload for ${input.site_input.site}.`,
        {
          candidateId: state.match_decision?.candidateId,
        },
      );

      return {
        context: nextContext,
        draft_optout: draftOptOut,
        prompt_trace: {
          draft_optout: promptTrace.draft_optout,
        },
      };
    })
    .addNode("node_plan_submission", async (state: WorkflowGraphState) => {
      const input = requireStateValue(state.input, "input");
      const context = requireStateValue(state.context, "context");
      const discoveryParse = requireStateValue(state.discovery_parse, "discovery_parse");
      const procedure = requireStateValue(state.retrieve_procedure, "retrieve_procedure");
      const draftOptOut = requireStateValue(state.draft_optout, "draft_optout");
      let planSubmission: PlanSubmissionOutput;
      try {
        planSubmission = await nodes.planSubmission(
          {
            seed_profile: input.seed_profile,
            discovery_result: discoveryParse,
            procedure,
            submission_payload: draftOptOut,
          },
          context,
        );
      } catch (error) {
        const { event } = appendWorkflowNodeFailureEvent(context, input.site_input.site, "approval", error);
        throw new WorkflowNodeExecutionError(event.message, event, { cause: error });
      }
      const nextContext = nextContextWithReviewReasons(context, planSubmission.review_reasons);
      const { context: eventContext } = appendWorkflowEvent(
        nextContext,
        input.site_input.site,
        "approval",
        planSubmission.requires_manual_review ? "awaiting_user" : "completed",
        planSubmission.requires_manual_review
          ? `Submission plan for ${input.site_input.site} requires manual review.`
          : `Submission plan accepted for ${input.site_input.site}.`,
        {
          candidateId: state.match_decision?.candidateId,
          reviewReasons: planSubmission.review_reasons,
        },
      );

      return {
        context: eventContext,
        prompt_trace: {
          interpret_result: null,
        },
        plan_submission: planSubmission,
      };
    })
    .addNode("node_interpret_result", async (state: WorkflowGraphState) => {
      const input = requireStateValue(state.input, "input");
      const context = requireStateValue(state.context, "context");

      if (!input.site_input.execution_result) {
        throw new Error("Workflow graph reached interpret_result without an execution result.");
      }
      let interpretResult: InterpretResultOutput;
      try {
        interpretResult = await nodes.interpretResult(
          {
            execution_result: input.site_input.execution_result as ExecutionResult,
            prior_review_reasons: context.review_reasons,
            retry_count: input.site_input.retry_count,
          },
          context,
        );
      } catch (error) {
        const { event } = appendWorkflowNodeFailureEvent(context, input.site_input.site, "verification", error);
        throw new WorkflowNodeExecutionError(event.message, event, { cause: error });
      }
      const nextContext = interpretResult.review_reasons.length > 0
        ? nextContextWithReviewReasons(context, interpretResult.review_reasons)
        : context;
      const { context: eventContext } = appendWorkflowEvent(
        nextContext,
        input.site_input.site,
        "verification",
        interpretResult.next_action === "retry"
          ? "in_progress"
          : interpretResult.next_action === "request_user_review" || interpretResult.next_action === "await_confirmation"
            ? "awaiting_user"
            : "completed",
        `Execution result interpreted for ${input.site_input.site}: status=${interpretResult.next_status}, action=${interpretResult.next_action}.`,
        {
          candidateId: state.match_decision?.candidateId,
          reviewReasons: interpretResult.review_reasons,
        },
      );

      return {
        context: eventContext,
        interpret_result: interpretResult,
        prompt_trace: {
          interpret_result: promptTrace.interpret_result,
        },
      };
    })
    .addEdge(START, "node_validate_consent")
    .addEdge("node_validate_consent", "node_discovery_parse")
    .addConditionalEdges("node_discovery_parse", resolveDiscoveryBranch)
    .addConditionalEdges("node_retrieve_procedure", resolveProcedureBranch)
    .addEdge("node_draft_optout", "node_plan_submission")
    .addConditionalEdges("node_plan_submission", resolvePlanSubmissionBranch)
    .addConditionalEdges("node_interpret_result", resolveInterpretResultBranch)
    .addEdge("node_terminal_completed", END)
    .addEdge("node_terminal_await_confirmation", END)
    .addEdge("node_terminal_retry_scheduled", END)
    .addEdge("node_terminal_retry_exhausted", END)
    .addEdge("node_terminal_manual_review", END)
    .addEdge("node_terminal_captcha_review", END)
    .addEdge("node_terminal_blocked", END)
    .addEdge("node_terminal_no_match", END)
    .addEdge("node_terminal_site_unreachable", END)
    .addEdge("node_terminal_low_confidence", END)
    .addEdge("node_terminal_missing_procedure", END)
    .addEdge("node_terminal_stale_procedure", END)
    .addEdge("node_terminal_contradictory_procedure", END)
    .compile({
      name: "agent-opt-out-workflow",
      checkpointer,
    });

  return {
    registry,
    graph,
    async getState(checkpoint: WorkflowCheckpointConfig): Promise<WorkflowRunOutput | null> {
      const parsedCheckpoint = workflowCheckpointConfigSchema.parse(checkpoint);
      const siteResults = await Promise.all(
        registry.map(async (entry) => {
          const snapshot = await graph.getState(createCheckpointConfig(createSiteCheckpointConfig(parsedCheckpoint, entry.site)));
          const values = snapshot.values as WorkflowGraphState | undefined;

          if (!values?.context || !values.validate_consent || !values.discovery_parse) {
            return null;
          }

          return {
            site: entry.site,
            result: buildRunOutputFromState(values, readCheckpointState(snapshot)),
          };
        }),
      );

      const completedSiteResults = siteResults.filter((value): value is { site: string; result: WorkflowSiteRunOutput } => value !== null);

      if (completedSiteResults.length === 0) {
        return null;
      }

      const primarySiteRun = completedSiteResults[0].result;
      const orchestrationCheckpoint = buildOrchestrationCheckpoint(parsedCheckpoint, completedSiteResults);

      return workflowRunOutputSchema.parse({
        ...primarySiteRun,
        context: mergeWorkflowContext(primarySiteRun.context, completedSiteResults.map(({ result }) => result)),
        checkpoint: buildPublicCheckpoint(parsedCheckpoint, primarySiteRun, orchestrationCheckpoint),
        site_runs: completedSiteResults.map(({ result }) => result),
        run_summary: buildRunSummary([], completedSiteResults.map(({ result }) => result)),
        orchestration_checkpoint: orchestrationCheckpoint,
      });
    },
    async run(input: WorkflowRunInput, runtime?: { checkpoint?: WorkflowCheckpointConfig }): Promise<WorkflowRunOutput> {
      const { parsedInput, inputRegistryEntries } = normalizeWorkflowRunInput(input);
      const effectiveRegistry = [
        ...registry.filter((entry) => !inputRegistryEntries.some((inputEntry) => inputEntry.site === entry.site)),
        ...inputRegistryEntries,
      ];
      const checkpoint = runtime?.checkpoint
        ? workflowCheckpointConfigSchema.parse(runtime.checkpoint)
        : null;

      const runSingleSite = async (siteInput: WorkflowSiteInput): Promise<WorkflowSiteRunOutput> => {
        const singleSiteInput: WorkflowSingleSiteRunInput = {
          context: parsedInput.context,
          seed_profile: parsedInput.seed_profile,
          request_text: parsedInput.request_text,
          site_input: siteInput,
        };
        const registryEntry = effectiveRegistry.find((entry) => entry.site === siteInput.site);
        const initialContext: GraphContext = {
          ...singleSiteInput.context,
          review_reasons: [...singleSiteInput.context.review_reasons],
          events: [...singleSiteInput.context.events],
        };
        const siteCheckpoint = checkpoint
          ? createSiteCheckpointConfig(checkpoint, siteInput.site)
          : workflowCheckpointConfigSchema.parse({ thread_id: `${parsedInput.context.run_id}::${siteInput.site}` });
        const existingSnapshot = checkpoint
          ? await readExistingSnapshot(graph, siteCheckpoint)
          : null;
        const invokeResult = await graph.invoke(
          existingSnapshot?.next.length
            ? null
            : {
              input: singleSiteInput,
              context: initialContext,
              registry_entry: registryEntry ?? null,
              validate_consent: null,
              submission_approved: false,
              artifact_failure_reason: null,
              discovery_parse: null,
              match_decision: null,
              procedure_resolution_status: null,
              retrieve_procedure: null,
              draft_optout: null,
              plan_submission: null,
              interpret_result: null,
              prompt_trace: createEmptyPromptTrace(),
              terminal_path: null,
            },
          {
            ...createCheckpointConfig(siteCheckpoint),
            ...(checkpoint && !singleSiteInput.site_input.execution_result ? { interruptAfter: ["node_plan_submission"] } : {}),
            signal: createWorkflowAbortSignal(),
          },
        );

        if (checkpoint) {
          const snapshot = await graph.getState(createCheckpointConfig(siteCheckpoint));
          return buildRunOutputFromState(
            snapshot.values as WorkflowGraphState,
            readCheckpointState(snapshot) ?? (
              isInterrupted(invokeResult)
                ? workflowCheckpointStateSchema.parse({
                  thread_id: siteCheckpoint.thread_id,
                  checkpoint_id: siteCheckpoint.checkpoint_id,
                  next: [],
                  resume_required: true,
                })
                : null
            ),
          );
        }

        return buildRunOutputFromState(invokeResult as WorkflowGraphState, null);
      };

      const siteRuns = await Promise.all(
        parsedInput.site_inputs.map(async (siteInput) => ({
          site: siteInput.site,
          result: await runSingleSite(siteInput),
        })),
      );

      const primarySiteRun = siteRuns[0].result;
      const orchestrationCheckpoint = checkpoint ? buildOrchestrationCheckpoint(checkpoint, siteRuns) : null;

      return workflowRunOutputSchema.parse({
        ...primarySiteRun,
        context: mergeWorkflowContext(parsedInput.context, siteRuns.map(({ result }) => result)),
        checkpoint: buildPublicCheckpoint(checkpoint, primarySiteRun, orchestrationCheckpoint),
        site_runs: siteRuns.map(({ result }) => result),
        run_summary: buildRunSummary(parsedInput.requested_sites, siteRuns.map(({ result }) => result)),
        orchestration_checkpoint: orchestrationCheckpoint,
      });
    },
    async runWithAutomation(
      input: WorkflowRunInput,
      runtime?: { checkpoint?: WorkflowCheckpointConfig } & WorkflowAutomationRunOptions,
    ): Promise<WorkflowRunOutput> {
      const initial = await this.run(input, runtime);
      const automationRecords = new Map<string, WorkflowAutomationRecord>();
      const parsedInput = workflowRunInputSchema.parse(input);

      for (const siteRun of initial.site_runs) {
        const handoff = createWorkflowAutomationHandoff(siteRun);
        if (!handoff || siteRun.site_input.execution_result) {
          continue;
        }

        const automationRecord = workflowAutomationRecordSchema.parse(
          await executeAutomation(handoff, runtime?.automation),
        );
        automationRecords.set(siteRun.site_input.site, automationRecord);
      }

      if (automationRecords.size === 0) {
        return mergeAutomationIntoSiteRuns(initial, automationRecords);
      }

      const rerun = await this.run({
        ...parsedInput,
        site_inputs: parsedInput.site_inputs.map((siteInput) => {
          const automationRecord = automationRecords.get(siteInput.site);
          return workflowSiteInputSchema.parse({
            ...siteInput,
            execution_result: automationRecord?.executionResult ?? siteInput.execution_result,
          });
        }),
      });

      return mergeAutomationIntoSiteRuns(rerun, automationRecords);
    },
    async resume(input: WorkflowRunInput, runtime: { checkpoint: WorkflowCheckpointConfig }): Promise<WorkflowRunOutput> {
      const { parsedInput } = normalizeWorkflowRunInput(input);
      const checkpoint = workflowCheckpointConfigSchema.parse(runtime.checkpoint);

      const resumeSingleSite = async (siteInput: WorkflowSiteInput): Promise<WorkflowSiteRunOutput> => {
        const singleSiteInput: WorkflowSingleSiteRunInput = {
          context: parsedInput.context,
          seed_profile: parsedInput.seed_profile,
          request_text: parsedInput.request_text,
          site_input: siteInput,
        };
        const siteCheckpoint = createSiteCheckpointConfig(checkpoint, siteInput.site);
        const checkpointConfig = createCheckpointConfig(siteCheckpoint);

        await graph.updateState(
          checkpointConfig,
          {
            input: singleSiteInput,
            artifact_failure_reason: null,
            interpret_result: null,
            terminal_path: null,
          },
          "node_plan_submission",
        );

        await graph.invoke(
          new Command({ resume: true }),
          {
            ...checkpointConfig,
            signal: createWorkflowAbortSignal(),
          },
        );

        const snapshot = await graph.getState(checkpointConfig);
        return buildRunOutputFromState(snapshot.values as WorkflowGraphState, readCheckpointState(snapshot));
      };

      const siteRuns = await Promise.all(
        parsedInput.site_inputs.map(async (siteInput) => ({
          site: siteInput.site,
          result: await resumeSingleSite(siteInput),
        })),
      );

      const primarySiteRun = siteRuns[0].result;
      const orchestrationCheckpoint = buildOrchestrationCheckpoint(checkpoint, siteRuns);

      return workflowRunOutputSchema.parse({
        ...primarySiteRun,
        context: mergeWorkflowContext(parsedInput.context, siteRuns.map(({ result }) => result)),
        checkpoint: buildPublicCheckpoint(checkpoint, primarySiteRun, orchestrationCheckpoint),
        site_runs: siteRuns.map(({ result }) => result),
        run_summary: buildRunSummary(parsedInput.requested_sites, siteRuns.map(({ result }) => result)),
        orchestration_checkpoint: orchestrationCheckpoint,
      });
    },
  };
}

