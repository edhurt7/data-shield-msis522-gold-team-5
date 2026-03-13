import { type DiscoveryResult, type SeedProfile } from "@/lib/agent/contracts";
import { createFixtureLlmAdapter } from "@/lib/agent/llm";
import type {
  DraftOptOutOutput,
  InterpretResultOutput,
  RetrieveProcedureOutput,
} from "@/lib/agent/graph";
import type {
  DraftPromptInput,
  ListingPromptInput,
  PostExecutionPromptInput,
  ProcedurePromptInput,
} from "@/lib/agent/prompts";

function toLower(value: string) {
  return value.toLowerCase();
}

function unique<T extends string>(values: T[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function clipEvidence(text: string, needle: string) {
  const lowerText = toLower(text);
  const lowerNeedle = toLower(needle);
  const index = lowerText.indexOf(lowerNeedle);
  if (index === -1) {
    return text.slice(0, 140).trim();
  }

  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + needle.length + 60);
  return text.slice(start, end).trim();
}

function extractAge(pageText: string) {
  const match = pageText.match(/\bage\s*(\d{1,3})\b/i) ?? pageText.match(/\b(\d{1,3})\s*years?\s*old\b/i);
  return match?.[1] ?? null;
}

function extractPhones(pageText: string) {
  const matches = pageText.match(/(?:\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b)/g) ?? [];
  return unique(matches);
}

function extractAddresses(pageText: string) {
  const matches = pageText.match(/\b\d{1,5}\s+[A-Za-z0-9.'\- ]+\s(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive)\b[^\n,]*/g) ?? [];
  return unique(matches.map((value) => value.trim()));
}

function extractRelatives(pageText: string) {
  const relativeSection = pageText.match(/relatives?:\s*([^\n]+)/i)?.[1];
  if (!relativeSection) return [];
  return unique(relativeSection.split(/,|;/).map((value) => value.trim()).filter((value) => value.length > 1));
}

function calculateConfidence(
  seedProfile: SeedProfile,
  pageText: string,
  matchedVariant: string | null,
  extractedAge: string | null,
) {
  const lowerText = toLower(pageText);
  let score = 0;

  if (matchedVariant) {
    score += matchedVariant === seedProfile.full_name ? 0.55 : 0.35;
  }
  if (lowerText.includes(toLower(seedProfile.location.city))) score += 0.15;
  if (lowerText.includes(toLower(seedProfile.location.state))) score += 0.1;
  if (seedProfile.approx_age && lowerText.includes(seedProfile.approx_age)) score += 0.1;
  if (seedProfile.optional.phone_last4 && lowerText.includes(seedProfile.optional.phone_last4)) score += 0.1;
  if (seedProfile.optional.prior_cities.some((city) => lowerText.includes(toLower(city)))) score += 0.05;
  if (seedProfile.approx_age && extractedAge && extractedAge !== seedProfile.approx_age) score -= 0.35;

  return Math.max(0, Math.min(Number(score.toFixed(2)), 0.99));
}

function inferProcedureType(chunks: ProcedurePromptInput["retrieved_chunks"]) {
  const combined = toLower(chunks.map((chunk) => chunk.quote).join(" "));
  if (!combined) return "procedure_unknown" as const;
  if (combined.includes("email") && /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(combined)) return "email" as const;
  if (combined.includes("webform") || combined.includes("form") || combined.includes("checkbox")) return "webform" as const;
  return "procedure_unknown" as const;
}

function inferRequiredFields(chunks: ProcedurePromptInput["retrieved_chunks"]) {
  const combined = toLower(chunks.map((chunk) => chunk.quote).join(" "));
  return unique(
    [
      combined.includes("name") ? "full_name" : "",
      combined.includes("email") ? "privacy_email" : "",
      combined.includes("address") ? "address" : "",
      combined.includes("age") ? "approx_age" : "",
    ].filter(Boolean),
  );
}

function inferSteps(chunks: ProcedurePromptInput["retrieved_chunks"]) {
  return unique(chunks.map((chunk) => chunk.quote.trim()).filter(Boolean));
}

function makeFieldValue(seedProfile: SeedProfile, field: string) {
  switch (field) {
    case "full_name":
      return seedProfile.full_name;
    case "privacy_email":
      return seedProfile.privacy_email;
    case "approx_age":
      return seedProfile.approx_age ?? "";
    case "address":
      return `${seedProfile.location.city}, ${seedProfile.location.state}`;
    default:
      return "";
  }
}

function inferDestinationEmail(chunks: ProcedurePromptInput["retrieved_chunks"]) {
  return chunks
    .map((chunk) => chunk.quote.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0])
    .find(Boolean) ?? "privacy@example.com";
}

function toSubmissionFields(seedProfile: SeedProfile, fields: string[]) {
  return fields
    .map((field) => ({
      name: field,
      value: makeFieldValue(seedProfile, field),
      required: true as const,
    }))
    .filter((field) => field.value);
}

function toConsentCheckboxInstructions(steps: string[]) {
  return steps
    .filter((step) => /checkbox|consent|agree/i.test(step))
    .map((step, index) => ({
      label: `consent_checkbox_${index + 1}`,
      instruction: step,
      required: true,
    }));
}

function buildDraftFacts(seedProfile: SeedProfile, requiredFields: string[]) {
  return requiredFields
    .map((field) => ({ field, value: makeFieldValue(seedProfile, field) }))
    .filter((entry) => entry.value)
    .map(({ field, value }) => {
      switch (field) {
        case "full_name":
          return `Full name: ${value}`;
        case "privacy_email":
          return `Privacy email: ${value}`;
        case "approx_age":
          return `Approximate age: ${value}`;
        case "address":
          return `Location: ${value}`;
        default:
          return "";
      }
    })
    .filter(Boolean);
}

function hasClearExecutionEvidence(input: PostExecutionPromptInput) {
  const confirmationSignals = [
    input.execution_result.ticket_ids[0],
    input.execution_result.screenshot_ref,
    input.execution_result.confirmation_text,
  ].filter(Boolean);
  const combinedText = toLower(
    [input.execution_result.confirmation_text, input.execution_result.error_text].filter(Boolean).join(" "),
  );

  return confirmationSignals.length > 0
    && /(received|submitted|confirmed|request has been|success|complete)/i.test(combinedText);
}

function hasCaptchaOrManualSignal(input: PostExecutionPromptInput) {
  const combinedText = toLower(
    [input.execution_result.confirmation_text, input.execution_result.error_text].filter(Boolean).join(" "),
  );
  return input.execution_result.manual_review_required
    || /captcha|manual review|required|human verification/.test(combinedText);
}

function buildDiscoveryResult(input: ListingPromptInput): DiscoveryResult {
  const variants = unique([input.seed_profile.full_name, ...input.seed_profile.name_variants]);
  const pageText = input.page_artifact.visible_text;
  const matchedVariant = variants.find((variant) => toLower(pageText).includes(toLower(variant)));
  const found = Boolean(matchedVariant);
  const age = extractAge(pageText);

  return {
    site: input.site,
    scan_timestamp: new Date().toISOString(),
    found,
    candidates: found
      ? [
          {
            url: input.page_artifact.url,
            extracted: {
              name: matchedVariant ?? input.seed_profile.full_name,
              age,
              addresses: extractAddresses(pageText),
              relatives: extractRelatives(pageText),
              phones: extractPhones(pageText),
            },
            match_confidence: calculateConfidence(input.seed_profile, pageText, matchedVariant ?? null, age),
            evidence_snippets: [clipEvidence(pageText, matchedVariant ?? input.seed_profile.full_name)],
          },
        ]
      : [],
    notes: found ? null : "No likely match found in extracted page text.",
  };
}

function buildProcedureResult(input: ProcedurePromptInput): RetrieveProcedureOutput {
  const procedureType = inferProcedureType(input.retrieved_chunks);
  const requiredFields = inferRequiredFields(input.retrieved_chunks);

  return {
    site: input.site,
    procedure_type: procedureType !== "procedure_unknown" && requiredFields.length > 0 ? procedureType : "procedure_unknown",
    required_fields: procedureType !== "procedure_unknown" && requiredFields.length > 0 ? requiredFields : [],
    steps: inferSteps(input.retrieved_chunks),
    source_chunks: input.retrieved_chunks,
  };
}

function buildDraftResult(input: DraftPromptInput): DraftOptOutOutput {
  const requiredFields = toSubmissionFields(input.seed_profile, input.procedure.required_fields);

  if (input.procedure.procedure_type === "email") {
    return {
      site: input.site,
      candidate_url: input.candidate_url,
      submission_channel: "email",
      procedure_type: "email",
      required_fields: requiredFields,
      optional_fields: [],
      manual_review_required: false,
      review_reasons: [],
      email: {
        to: inferDestinationEmail(input.procedure.source_chunks),
        subject: `${input.site} removal request for ${input.seed_profile.full_name}`,
        body: [
          `Please remove the listing associated with ${input.seed_profile.full_name}.`,
          ...buildDraftFacts(input.seed_profile, input.procedure.required_fields),
        ].join("\n"),
      },
    };
  }

  return {
    site: input.site,
    candidate_url: input.candidate_url,
    submission_channel: "webform",
    procedure_type: "webform",
    required_fields: requiredFields,
    optional_fields: [],
    manual_review_required: false,
    review_reasons: [],
    webform: {
      fields: requiredFields.map((field) => ({
        name: field.name,
        value: field.value,
      })),
      consent_checkboxes: toConsentCheckboxInstructions(input.procedure.steps),
    },
  };
}

function buildInterpretResult(input: PostExecutionPromptInput): InterpretResultOutput {
  const reviewReasons = [...input.prior_review_reasons];

  if (hasCaptchaOrManualSignal(input)) {
    return {
      next_status: "manual_required",
      next_action: input.captcha_failure_strategy,
      review_reasons: unique([...reviewReasons, "captcha"]),
    };
  }

  switch (input.execution_result.status) {
    case "manual_required":
      return {
        next_status: "manual_required",
        next_action: input.manual_requirement_strategy,
        review_reasons: unique(reviewReasons.length > 0 ? reviewReasons : ["manual_submission_required"]),
      };
    case "pending":
      return {
        next_status: "pending",
        next_action: input.pending_confirmation_strategy,
        review_reasons: unique(reviewReasons),
      };
    case "failed":
      if (input.retry_count >= input.max_submission_retries) {
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
      if (!hasClearExecutionEvidence(input)) {
        return {
          next_status: "pending",
          next_action: input.pending_confirmation_strategy,
          review_reasons: unique(reviewReasons),
        };
      }

      return {
        next_status: "submitted",
        next_action: "none",
        review_reasons: unique(reviewReasons),
      };
  }
}

export function createRuntimeFixtureLlmAdapter() {
  return createFixtureLlmAdapter({
    listing_classifier_extractor(input) {
      return buildDiscoveryResult(input as ListingPromptInput);
    },
    procedure_selector(input) {
      return buildProcedureResult(input as ProcedurePromptInput);
    },
    draft_generator(input) {
      return buildDraftResult(input as DraftPromptInput);
    },
    post_execution_verifier(input) {
      return buildInterpretResult(input as PostExecutionPromptInput);
    },
  });
}
