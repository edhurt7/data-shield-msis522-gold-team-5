import { z } from "zod";

import {
  discoveryResultSchema,
  executionResultSchema,
  interpretResultOutputSchema,
  pageContentArtifactSchema,
  procedureRetrievalSchema,
  seedProfileSchema,
  submissionPayloadSchema,
} from "@/lib/agent";

export type PromptName =
  | "listing_classifier_extractor"
  | "procedure_selector"
  | "draft_generator"
  | "post_execution_verifier";

export interface PromptDefinition<TInput, TOutput> {
  name: PromptName;
  version: string;
  system: string;
  buildUserPrompt: (input: TInput) => string;
  outputSchema: z.ZodType<TOutput>;
}

function renderJsonTemplate(template: unknown) {
  return JSON.stringify(template, null, 2);
}

export const listingPromptInputSchema = z.object({
  seed_profile: seedProfileSchema,
  site: z.string().min(1),
  page_artifact: pageContentArtifactSchema,
});

export const procedurePromptInputSchema = z.object({
  seed_profile: seedProfileSchema,
  site: z.string().min(1),
  discovery_result: discoveryResultSchema,
  retrieved_chunks: z.array(z.object({
    doc_id: z.string().min(1),
    quote: z.string().min(1),
  })).default([]),
});

export const draftPromptInputSchema = z.object({
  seed_profile: seedProfileSchema,
  site: z.string().min(1),
  candidate_url: z.string().url(),
  procedure: procedureRetrievalSchema,
  minimize_pii: z.boolean().default(true),
});

export const postExecutionPromptInputSchema = z.object({
  execution_result: executionResultSchema,
  prior_review_reasons: z.array(z.string().min(1)).default([]),
  retry_count: z.number().int().min(0).default(0),
  max_submission_retries: z.number().int().min(0).default(0),
  pending_confirmation_strategy: z.enum(["await_confirmation", "request_user_review"]).default("await_confirmation"),
  captcha_failure_strategy: z.enum(["retry", "request_user_review"]).default("request_user_review"),
  manual_requirement_strategy: z.enum(["retry", "request_user_review"]).default("request_user_review"),
});

export type ListingPromptInput = z.infer<typeof listingPromptInputSchema>;
export type ProcedurePromptInput = z.infer<typeof procedurePromptInputSchema>;
export type DraftPromptInput = z.infer<typeof draftPromptInputSchema>;
export type PostExecutionPromptInput = z.infer<typeof postExecutionPromptInputSchema>;

export const listingClassifierPrompt: PromptDefinition<ListingPromptInput, z.infer<typeof discoveryResultSchema>> = {
  name: "listing_classifier_extractor",
  version: "2026-03-13.2",
  system: [
    "You classify people-search listings and extract structured data.",
    "Return strict JSON only.",
    "Be conservative with match_confidence when identity is ambiguous.",
    "Always include evidence_snippets drawn from the provided page text.",
    "Do not invent fields that are not supported by the page text.",
    "Return exactly one JSON object matching the required keys and value types.",
    "Always include site, scan_timestamp, found, candidates, and notes.",
    "If no match is found, return found=false, candidates=[], and a brief notes string or null.",
    "Use the provided Site value verbatim for the site field.",
    "Use an ISO-8601 timestamp string for scan_timestamp.",
    "Do not wrap the JSON in markdown fences or explanatory text.",
  ].join(" "),
  buildUserPrompt(input) {
    return [
      `Site: ${input.site}`,
      `Seed profile: ${JSON.stringify(input.seed_profile)}`,
      `Page artifact: ${JSON.stringify(input.page_artifact)}`,
      "Task: Determine whether the page contains a likely listing for the seed profile and extract structured candidate data.",
      "Return every required field even when values are empty or null.",
      "Output schema: DiscoveryResult",
      "Required JSON shape:",
      renderJsonTemplate({
        site: input.site,
        scan_timestamp: "2026-03-13T00:00:00.000Z",
        found: true,
        candidates: [
          {
            url: input.page_artifact.url,
            extracted: {
              name: input.seed_profile.full_name,
              age: input.seed_profile.approx_age,
              addresses: ["123 Main St, Seattle, WA"],
              relatives: ["John Doe"],
              phones: ["206-555-0114"],
            },
            match_confidence: 0.5,
            evidence_snippets: ["Exact snippet copied from visible_text"],
          },
        ],
        notes: null,
      }),
      "If there is no likely match, return this shape instead:",
      renderJsonTemplate({
        site: input.site,
        scan_timestamp: "2026-03-13T00:00:00.000Z",
        found: false,
        candidates: [],
        notes: "No likely match found in the provided page text.",
      }),
      "Visible page text:",
      input.page_artifact.visible_text,
    ].filter(Boolean).join("\n\n");
  },
  outputSchema: discoveryResultSchema,
};

export const procedureSelectorPrompt: PromptDefinition<ProcedurePromptInput, z.infer<typeof procedureRetrievalSchema>> = {
  name: "procedure_selector",
  version: "2026-03-13.2",
  system: [
    "You select opt-out procedures using only retrieved procedure chunks.",
    "Return strict JSON only.",
    "Cite retrieved chunks in source_chunks.",
    "If chunks are missing, contradictory, or insufficient, return procedure_unknown.",
    "Do not invent steps, fields, or contact methods.",
    "Always include site, procedure_type, required_fields, steps, and source_chunks.",
    "Each source_chunks item must be an object with doc_id and quote, never a plain string.",
    "Use the provided Site value verbatim for the site field.",
    "Do not wrap the JSON in markdown fences or explanatory text.",
  ].join(" "),
  buildUserPrompt(input) {
    return [
      `Site: ${input.site}`,
      `Seed profile: ${JSON.stringify(input.seed_profile)}`,
      `Discovery result: ${JSON.stringify(input.discovery_result)}`,
      `Retrieved chunks: ${JSON.stringify(input.retrieved_chunks)}`,
      "Task: Choose the correct opt-out path and list required fields and steps.",
      "Output schema: ProcedureRetrieval",
      "Return every required field even when arrays are empty.",
      "Required JSON shape:",
      renderJsonTemplate({
        site: input.site,
        procedure_type: "email",
        required_fields: ["full_name", "privacy_email"],
        steps: ["Email the privacy address with the opt-out request."],
        source_chunks: input.retrieved_chunks.length > 0
          ? input.retrieved_chunks.map((chunk) => ({
            doc_id: chunk.doc_id,
            quote: chunk.quote,
          }))
          : [],
      }),
      "If the procedure is unknown or ungrounded, return this shape instead:",
      renderJsonTemplate({
        site: input.site,
        procedure_type: "procedure_unknown",
        required_fields: [],
        steps: [],
        source_chunks: [],
      }),
    ].join("\n\n");
  },
  outputSchema: procedureRetrievalSchema,
};

export const draftGeneratorPrompt: PromptDefinition<DraftPromptInput, z.infer<typeof submissionPayloadSchema>> = {
  name: "draft_generator",
  version: "2026-03-13.2",
  system: [
    "You generate site-specific opt-out payloads grounded in the provided procedure.",
    "Return strict JSON only.",
    "Never invent new steps or fields beyond the procedure.",
    "Minimize PII and use only the privacy-safe email alias.",
    "Do not expose unnecessary personal details.",
    "Always include site, candidate_url, submission_channel, procedure_type, required_fields, optional_fields, manual_review_required, and review_reasons.",
    "Return email only for email procedures and webform only for webform procedures.",
    "Do not wrap the JSON in markdown fences or explanatory text.",
  ].join(" "),
  buildUserPrompt(input) {
    return [
      `Site: ${input.site}`,
      `Seed profile: ${JSON.stringify(input.seed_profile)}`,
      `Candidate URL: ${input.candidate_url}`,
      `Procedure: ${JSON.stringify(input.procedure)}`,
      `Minimize PII: ${JSON.stringify(input.minimize_pii)}`,
      "Task: Produce either an email payload or a webform payload that matches the procedure requirements.",
      "Output schema: SubmissionPayload",
      "Return every required field even when arrays are empty.",
      "Email procedure JSON shape:",
      renderJsonTemplate({
        site: input.site,
        candidate_url: input.candidate_url,
        submission_channel: "email",
        procedure_type: "email",
        required_fields: [
          { name: "full_name", value: input.seed_profile.full_name, required: true },
          { name: "privacy_email", value: input.seed_profile.privacy_email, required: true },
        ],
        optional_fields: [],
        manual_review_required: false,
        review_reasons: [],
        email: {
          to: input.seed_profile.privacy_email,
          subject: "Opt-out request",
          body: "Please remove my listing.",
        },
      }),
      "Webform procedure JSON shape:",
      renderJsonTemplate({
        site: input.site,
        candidate_url: input.candidate_url,
        submission_channel: "webform",
        procedure_type: "webform",
        required_fields: [
          { name: "full_name", value: input.seed_profile.full_name, required: true },
          { name: "privacy_email", value: input.seed_profile.privacy_email, required: true },
        ],
        optional_fields: [],
        manual_review_required: false,
        review_reasons: [],
        webform: {
          fields: [
            { name: "full_name", value: input.seed_profile.full_name },
            { name: "privacy_email", value: input.seed_profile.privacy_email },
          ],
          consent_checkboxes: [
            { label: "I confirm this is my information", instruction: "Check the consent box.", required: true },
          ],
        },
      }),
    ].join("\n\n");
  },
  outputSchema: submissionPayloadSchema,
};

export const postExecutionVerifierPrompt: PromptDefinition<PostExecutionPromptInput, z.infer<typeof interpretResultOutputSchema>> = {
  name: "post_execution_verifier",
  version: "2026-03-13.3",
  system: [
    "You interpret automation results for privacy removals.",
    "Return strict JSON only.",
    "If a CAPTCHA appears, return manual_required and request_user_review.",
    "If confirmation is unclear, prefer pending with evidence-aware caution.",
    "Do not overstate success.",
    "Always include next_status, next_action, and review_reasons.",
    "Allowed next_status values are exactly: submitted, pending, failed, manual_required.",
    "Allowed next_action values are exactly: none, retry, await_confirmation, request_user_review.",
    "review_reasons must be an array. If there are no review reasons, return [].",
    "When review_reasons is non-empty, only use these values: ambiguous_match, captcha, email_confirmation_required, legal_hold, low_confidence_match, manual_submission_required, missing_required_input, missing_procedure, procedure_unknown, contradictory_procedure, stale_procedure, rate_limited, site_unreachable.",
    "Do not wrap the JSON in markdown fences or explanatory text.",
  ].join(" "),
  buildUserPrompt(input) {
    return [
      `Execution result: ${JSON.stringify(input.execution_result)}`,
      `Prior review reasons: ${JSON.stringify(input.prior_review_reasons)}`,
      `Retry count: ${input.retry_count}`,
      `Max submission retries: ${input.max_submission_retries}`,
      `Pending confirmation strategy: ${input.pending_confirmation_strategy}`,
      `CAPTCHA failure strategy: ${input.captcha_failure_strategy}`,
      `Manual requirement strategy: ${input.manual_requirement_strategy}`,
      "Task: Determine the next status and next action after automation execution.",
      "Output schema: InterpretResultOutput",
      "If the execution result status is pending and the confirmation text indicates the request was received but awaits confirmation or review, return:",
      renderJsonTemplate({
        next_status: "pending",
        next_action: "await_confirmation",
        review_reasons: [],
      }),
      "If a CAPTCHA or manual intervention is required, return something like:",
      renderJsonTemplate({
        next_status: "manual_required",
        next_action: "request_user_review",
        review_reasons: ["captcha"],
      }),
      "Required JSON shape:",
      renderJsonTemplate({
        next_status: "pending",
        next_action: "await_confirmation",
        review_reasons: [],
      }),
    ].join("\n\n");
  },
  outputSchema: interpretResultOutputSchema,
};

export const promptRegistry = {
  listing_classifier_extractor: listingClassifierPrompt,
  procedure_selector: procedureSelectorPrompt,
  draft_generator: draftGeneratorPrompt,
  post_execution_verifier: postExecutionVerifierPrompt,
} as const;
