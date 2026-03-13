import { describe, expect, it } from "vitest";

import {
  defaultAgentPolicy,
  discoveryParseInputSchema,
  graphContextSchema,
  draftOptOutInputSchema,
  interpretResultInputSchema,
  interpretResultOutputSchema,
  planSubmissionInputSchema,
  retrieveProcedureInputSchema,
  validateConsentInputSchema,
} from "@/lib/agent";

describe("agent graph node contracts", () => {
  it("resolves graph context defaults and per-run overrides", () => {
    const result = graphContextSchema.parse({
      run_id: "run_graph_policy_001",
      policy_overrides: {
        max_submission_retries: 2,
        pending_confirmation_strategy: "request_user_review",
      },
    });

    expect(result.policy_defaults).toEqual(defaultAgentPolicy);
    expect(result.policy_overrides).toEqual({
      max_submission_retries: 2,
      pending_confirmation_strategy: "request_user_review",
    });
    expect(result.policy).toMatchObject({
      ...defaultAgentPolicy,
      max_submission_retries: 2,
      pending_confirmation_strategy: "request_user_review",
    });
  });

  it("accepts validate_consent input", () => {
    expect(
      validateConsentInputSchema.safeParse({
        seed_profile: {
          full_name: "Jane Doe",
          name_variants: ["J. Doe"],
          location: { city: "Seattle", state: "Washington" },
          approx_age: "35",
          privacy_email: "shield-abc123@detraceme.io",
          optional: { phone_last4: null, prior_cities: [] },
          consent: true,
        },
        request_text: "Search for my name + Seattle and submit removals for everything you find.",
      }).success,
    ).toBe(true);
  });

  it("accepts discovery and retrieval node inputs", () => {
    const discoveryResult = {
      site: "FastPeopleSearch",
      scan_timestamp: "2026-03-12T12:00:00.000Z",
      found: true,
      candidates: [
        {
          url: "https://example.com/listing/jane-doe",
          extracted: {
            name: "Jane Doe",
            age: "35",
            addresses: ["123 Pine St, Seattle, WA"],
            relatives: ["John Doe"],
            phones: ["(206) 555-0114"],
          },
          match_confidence: 0.93,
          evidence_snippets: ["Jane Doe, Seattle, WA"],
        },
      ],
      notes: null,
    };

    expect(
      discoveryParseInputSchema.safeParse({
        seed_profile: {
          full_name: "Jane Doe",
          name_variants: [],
          location: { city: "Seattle", state: "Washington" },
          approx_age: null,
          privacy_email: "shield-abc123@detraceme.io",
          optional: { phone_last4: null, prior_cities: [] },
          consent: true,
        },
        site: "FastPeopleSearch",
        page_text: "Jane Doe, Seattle, WA",
      }).success,
    ).toBe(true);

    expect(
      retrieveProcedureInputSchema.safeParse({
        seed_profile: {
          full_name: "Jane Doe",
          name_variants: [],
          location: { city: "Seattle", state: "Washington" },
          approx_age: null,
          privacy_email: "shield-abc123@detraceme.io",
          optional: { phone_last4: null, prior_cities: [] },
          consent: true,
        },
        discovery_result: discoveryResult,
        site: "FastPeopleSearch",
        retrieved_chunks: [{ doc_id: "fps-1", quote: "Use the removal form." }],
      }).success,
    ).toBe(true);
  });

  it("accepts drafting, planning, and interpretation node contracts", () => {
    const procedure = {
      site: "FastPeopleSearch",
      procedure_type: "webform",
      required_fields: ["full_name", "privacy_email"],
      steps: ["Open removal form", "Submit request"],
      source_chunks: [{ doc_id: "fps-1", quote: "Use the removal form." }],
    };

    const submissionPayload = {
      site: "FastPeopleSearch",
      candidate_url: "https://example.com/listing/jane-doe",
      procedure_type: "webform",
      webform: {
        fields: [
          { name: "full_name", value: "Jane Doe" },
          { name: "privacy_email", value: "shield-abc123@detraceme.io" },
        ],
        consent_checkboxes: ["I confirm this is my data"],
      },
    };

    expect(
      draftOptOutInputSchema.safeParse({
        seed_profile: {
          full_name: "Jane Doe",
          name_variants: [],
          location: { city: "Seattle", state: "Washington" },
          approx_age: null,
          privacy_email: "shield-abc123@detraceme.io",
          optional: { phone_last4: null, prior_cities: [] },
          consent: true,
        },
        site: "FastPeopleSearch",
        candidate_url: "https://example.com/listing/jane-doe",
        procedure,
      }).success,
    ).toBe(true);

    expect(
      planSubmissionInputSchema.safeParse({
        seed_profile: {
          full_name: "Jane Doe",
          name_variants: [],
          location: { city: "Seattle", state: "Washington" },
          approx_age: null,
          privacy_email: "shield-abc123@detraceme.io",
          optional: { phone_last4: null, prior_cities: [] },
          consent: true,
        },
        discovery_result: {
          site: "FastPeopleSearch",
          scan_timestamp: "2026-03-12T12:00:00.000Z",
          found: true,
          candidates: [
            {
              url: "https://example.com/listing/jane-doe",
              extracted: {
                name: "Jane Doe",
                age: "35",
                addresses: ["123 Pine St, Seattle, WA"],
                relatives: ["John Doe"],
                phones: ["(206) 555-0114"],
              },
              match_confidence: 0.93,
              evidence_snippets: ["Jane Doe, Seattle, WA"],
            },
          ],
          notes: null,
        },
        procedure,
        submission_payload: submissionPayload,
      }).success,
    ).toBe(true);

    expect(
      interpretResultInputSchema.safeParse({
        execution_result: {
          site: "FastPeopleSearch",
          candidate_url: "https://example.com/listing/jane-doe",
          status: "manual_required",
          confirmation: {
            ticket: null,
            page_text: "CAPTCHA required",
            screenshot_ref: null,
          },
          error: null,
        },
        prior_review_reasons: ["captcha"],
        retry_count: 1,
      }).success,
    ).toBe(true);

    expect(
      interpretResultOutputSchema.safeParse({
        next_status: "manual_required",
        next_action: "request_user_review",
        review_reasons: ["captcha"],
      }).success,
    ).toBe(true);
  });
});
