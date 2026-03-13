import { describe, expect, it } from "vitest";

import { createAgentWorkflow } from "@/lib/agent";

describe("agent workflow skeleton", () => {
  const seedProfile = {
    full_name: "Jane Doe",
    name_variants: ["J. Doe"],
    location: { city: "Seattle", state: "Washington" },
    approx_age: "35",
    privacy_email: "shield-abc123@detraceme.io",
    optional: { phone_last4: "0114", prior_cities: ["Tacoma"] },
    consent: true as const,
  };

  const baseContext = {
    run_id: "run_workflow",
    review_reasons: [],
    events: [],
  };

  const defaultSiteInput = {
    site: "FastPeopleSearch",
    page_text: "Jane Doe, age 35, Seattle, Washington. Phone 206-555-0114. Relatives: John Doe",
    page_url: "https://example.com/listing/jane-doe",
    retrieved_chunks: [],
  };

  it("runs the happy path for a single site with backend-backed retrieval", async () => {
    const workflow = createAgentWorkflow();

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_001",
      },
      seed_profile: seedProfile,
      request_text: "Search for my name + Seattle and submit removals for everything you find.",
      site_input: {
        ...defaultSiteInput,
        execution_result: {
          site: "FastPeopleSearch",
          candidate_url: "https://example.com/listing/jane-doe",
          status: "pending",
          confirmation: {
            ticket: null,
            page_text: "Your request has been received.",
            screenshot_ref: null,
          },
          error: null,
        },
      },
    });

    expect(result.validate_consent.approved_for_submission).toBe(true);
    expect(result.discovery_parse.found).toBe(true);
    expect(result.match_decision).toMatchObject({
      decision: "exact_match",
      confidence: result.discovery_parse.candidates[0]?.match_confidence,
    });
    expect(result.discovery_parse.candidates[0]?.match_confidence).toBeGreaterThanOrEqual(0.75);
    expect(result.retrieve_procedure?.procedure_type).toBe("webform");
    expect(result.retrieve_procedure?.source_chunks.length).toBeGreaterThan(0);
    expect(result.draft_optout?.webform?.fields.some((field) => field.name === "privacy_email")).toBe(true);
    expect(result.draft_optout?.email).toBeUndefined();
    expect(result.plan_submission?.requires_manual_review).toBe(false);
    expect(result.interpret_result?.next_status).toBe("pending");
    expect(result.interpret_result?.next_action).toBe("await_confirmation");
  });

  it("applies the shared default policy when no override is provided", async () => {
    const workflow = createAgentWorkflow();

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_defaults_001",
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        site: "FastPeopleSearch",
        page_text: "Jane Doe",
        page_url: "https://example.com/listing/jane-doe",
        retrieved_chunks: [{ doc_id: "fps-1", quote: "Open the webform and enter full name and email." }],
      },
    });

    expect(result.context.policy).toMatchObject({
      match_confidence_threshold: 0.75,
      max_submission_retries: 1,
      require_explicit_consent: true,
      minimize_pii: true,
      require_retrieval_grounding: true,
      low_confidence_match_strategy: "block",
      stale_procedure_strategy: "block",
      contradictory_procedure_strategy: "block",
      pending_confirmation_strategy: "await_confirmation",
      captcha_failure_strategy: "request_user_review",
      manual_requirement_strategy: "request_user_review",
    });
    expect(result.retrieve_procedure).toBeNull();
    expect(result.context.review_reasons).toContain("low_confidence_match");
  });

  it("stops before drafting when retrieval is missing", async () => {
    const workflow = createAgentWorkflow();

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_002",
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        site: "UnknownBroker",
        page_text: "Jane Doe, age 35, Seattle, Washington",
        page_url: "https://example.com/listing/jane-doe",
        retrieved_chunks: [],
      },
    });

    expect(result.discovery_parse.found).toBe(true);
    expect(result.retrieve_procedure?.procedure_type).toBe("procedure_unknown");
    expect(result.draft_optout).toBeNull();
    expect(result.plan_submission).toBeNull();
    expect(result.context.review_reasons).toEqual(expect.arrayContaining(["missing_procedure", "procedure_unknown"]));
  });

  it("flags low-confidence matches for review and skips procedure retrieval", async () => {
    const workflow = createAgentWorkflow();

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_003",
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        site: "FastPeopleSearch",
        page_text: "Jane Doe",
        page_url: "https://example.com/listing/jane-doe",
        retrieved_chunks: [{ doc_id: "fps-1", quote: "Open the webform and enter full name and email." }],
      },
    });

    expect(result.discovery_parse.candidates[0]?.match_confidence).toBeLessThan(0.75);
    expect(result.match_decision).toMatchObject({
      decision: "possible_match",
      confidence: result.discovery_parse.candidates[0]?.match_confidence,
    });
    expect(result.retrieve_procedure).toBeNull();
    expect(result.draft_optout).toBeNull();
    expect(result.context.review_reasons).toContain("low_confidence_match");
  });

  it("fails closed on same-name matches with contradictory age evidence", async () => {
    const workflow = createAgentWorkflow();

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_003b",
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        site: "FastPeopleSearch",
        page_text: "Jane Doe, age 52, Seattle, Washington. Phone 206-555-0999.",
        page_url: "https://example.com/listing/jane-doe-age-52",
        retrieved_chunks: [{ doc_id: "fps-1", quote: "Open the webform and enter full name and email." }],
      },
    });

    expect(result.discovery_parse.candidates[0]?.match_confidence).toBeLessThan(0.75);
    expect(result.draft_optout).toBeNull();
    expect(result.plan_submission).toBeNull();
    expect(result.context.review_reasons).toContain("low_confidence_match");
  });

  it("marks stale retrieval results for review and blocks drafting", async () => {
    const workflow = createAgentWorkflow({
      procedureRetriever: () => ({
        status: "stale",
        chunks: [
          { doc_id: "fps-stale-1", quote: "Old removal form instructions from 2024." },
        ],
        notes: "Cached procedure is older than allowed freshness window.",
        review_reasons: ["stale_procedure"],
      }),
    });

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_004",
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        site: "FastPeopleSearch",
        page_text: "Jane Doe, age 35, Seattle, Washington. Phone 206-555-0114.",
        page_url: "https://example.com/listing/jane-doe",
        retrieved_chunks: [],
      },
    });

    expect(result.retrieve_procedure?.procedure_type).toBe("procedure_unknown");
    expect(result.draft_optout).toBeNull();
    expect(result.plan_submission).toBeNull();
    expect(result.context.review_reasons).toEqual(expect.arrayContaining(["stale_procedure", "procedure_unknown"]));
  });

  it("can continue with stale procedures when the override allows review-backed reuse", async () => {
    const workflow = createAgentWorkflow({
      procedureRetriever: () => ({
        status: "stale",
        chunks: [
          { doc_id: "fps-stale-1", quote: "Email privacy@site.test with your full name and privacy email." },
        ],
        notes: "Cached procedure is older than allowed freshness window.",
        review_reasons: ["stale_procedure"],
      }),
    });

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_stale_override_001",
        policy_overrides: {
          stale_procedure_strategy: "allow_with_review",
        },
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        site: "FastPeopleSearch",
        page_text: "Jane Doe, age 35, Seattle, Washington. Phone 206-555-0114.",
        page_url: "https://example.com/listing/jane-doe",
        retrieved_chunks: [],
      },
    });

    expect(result.context.review_reasons).toContain("stale_procedure");
    expect(result.retrieve_procedure?.procedure_type).toBe("email");
    expect(result.draft_optout?.procedure_type).toBe("email");
    expect(result.plan_submission?.requires_manual_review).toBe(true);
  });

  it("marks contradictory retrieval results for review and blocks drafting", async () => {
    const workflow = createAgentWorkflow({
      procedureRetriever: () => ({
        status: "contradictory",
        chunks: [
          { doc_id: "fps-contradict-1", quote: "Submit by email to privacy@site.test." },
          { doc_id: "fps-contradict-2", quote: "Use the webform only; email requests are not accepted." },
        ],
        notes: "Retrieved procedure documents disagree on the submission channel.",
        review_reasons: ["contradictory_procedure"],
      }),
    });

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_005",
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        site: "FastPeopleSearch",
        page_text: "Jane Doe, age 35, Seattle, Washington. Phone 206-555-0114.",
        page_url: "https://example.com/listing/jane-doe",
        retrieved_chunks: [],
      },
    });

    expect(result.retrieve_procedure?.procedure_type).toBe("procedure_unknown");
    expect(result.draft_optout).toBeNull();
    expect(result.plan_submission).toBeNull();
    expect(result.context.review_reasons).toEqual(
      expect.arrayContaining(["contradictory_procedure", "procedure_unknown"]),
    );
  });

  it("treats incomplete procedure docs as procedure_unknown and blocks drafting", async () => {
    const workflow = createAgentWorkflow();

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_006",
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        site: "FastPeopleSearch",
        page_text: "Jane Doe, age 35, Seattle, Washington. Phone 206-555-0114.",
        page_url: "https://example.com/listing/jane-doe",
        retrieved_chunks: [{ doc_id: "fps-1", quote: "Use the FastPeopleSearch removal webform." }],
      },
    });

    expect(result.retrieve_procedure?.procedure_type).toBe("procedure_unknown");
    expect(result.draft_optout).toBeNull();
    expect(result.plan_submission).toBeNull();
    expect(result.context.review_reasons).toContain("procedure_unknown");
  });

  it("does not add unnecessary location PII to email drafts", async () => {
    const workflow = createAgentWorkflow();

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_007",
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        site: "Radaris",
        page_text: "Jane Doe, age 35, Seattle, Washington.",
        page_url: "https://example.com/listing/jane-doe",
        retrieved_chunks: [
          { doc_id: "rad-1", quote: "Email privacy@radaris.example with a removal request." },
          { doc_id: "rad-2", quote: "Required fields: full name and privacy email." },
        ],
      },
    });

    expect(result.draft_optout?.procedure_type).toBe("email");
    expect(result.draft_optout?.email?.body).toContain(seedProfile.privacy_email);
    expect(result.draft_optout?.email?.body).not.toContain(seedProfile.location.city);
    expect(result.draft_optout?.email?.body).not.toContain(seedProfile.location.state);
  });

  it("allows low-confidence matches to continue when the override loosens review escalation", async () => {
    const workflow = createAgentWorkflow();

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_override_low_confidence_001",
        policy_overrides: {
          match_confidence_threshold: 0.81,
          low_confidence_match_strategy: "allow_with_review",
        },
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        site: "FastPeopleSearch",
        page_text: "Jane Doe, Seattle, Washington",
        page_url: "https://example.com/listing/jane-doe-seattle",
        retrieved_chunks: [{ doc_id: "fps-1", quote: "Open the webform and enter full name and email." }],
      },
    });

    expect(result.discovery_parse.candidates[0]?.match_confidence).toBeLessThan(0.81);
    expect(result.context.review_reasons).toContain("low_confidence_match");
    expect(result.retrieve_procedure?.procedure_type).toBe("webform");
    expect(result.draft_optout).not.toBeNull();
    expect(result.plan_submission?.requires_manual_review).toBe(true);
  });

  it("uses explicit consent as a default submission gate but allows a per-run override", async () => {
    const workflow = createAgentWorkflow({
      nodes: {
        validateConsent(input) {
          return {
            seed_profile: input.seed_profile,
            normalized_query: `${input.seed_profile.full_name} ${input.seed_profile.location.city}`,
            approved_for_submission: false,
          };
        },
      },
    });

    const defaultResult = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_consent_default_001",
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        site: "Radaris",
        page_text: "Jane Doe, age 35, Seattle, Washington.",
        page_url: "https://example.com/listing/jane-doe",
        retrieved_chunks: [
          { doc_id: "rad-1", quote: "Email privacy@radaris.example with a removal request." },
          { doc_id: "rad-2", quote: "Required fields: full name and privacy email." },
        ],
      },
    });

    const overrideResult = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_consent_override_001",
        policy_overrides: {
          require_explicit_consent: false,
        },
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        site: "Radaris",
        page_text: "Jane Doe, age 35, Seattle, Washington.",
        page_url: "https://example.com/listing/jane-doe",
        retrieved_chunks: [
          { doc_id: "rad-1", quote: "Email privacy@radaris.example with a removal request." },
          { doc_id: "rad-2", quote: "Required fields: full name and privacy email." },
        ],
      },
    });

    expect(defaultResult.validate_consent.approved_for_submission).toBe(false);
    expect(defaultResult.draft_optout).toBeNull();
    expect(overrideResult.draft_optout?.procedure_type).toBe("email");
    expect(overrideResult.plan_submission).not.toBeNull();
  });

  it("blocks ungrounded procedures by default but allows them with a grounding override", async () => {
    const workflow = createAgentWorkflow({
      nodes: {
        retrieveProcedure(input) {
          return {
            site: input.site,
            procedure_type: "email",
            required_fields: ["full_name", "privacy_email"],
            steps: ["Send the request by email."],
            source_chunks: [],
          };
        },
      },
    });

    const defaultResult = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_grounding_default_001",
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        site: "FastPeopleSearch",
        page_text: defaultSiteInput.page_text,
        page_url: defaultSiteInput.page_url,
        retrieved_chunks: [{ doc_id: "fps-1", quote: "Removal process available." }],
      },
    });

    const overrideResult = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_grounding_override_001",
        policy_overrides: {
          require_retrieval_grounding: false,
        },
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        site: "FastPeopleSearch",
        page_text: defaultSiteInput.page_text,
        page_url: defaultSiteInput.page_url,
        retrieved_chunks: [{ doc_id: "fps-1", quote: "Removal process available." }],
      },
    });

    expect(defaultResult.context.review_reasons).toContain("procedure_unknown");
    expect(defaultResult.draft_optout).toBeNull();
    expect(overrideResult.context.review_reasons).not.toContain("procedure_unknown");
    expect(overrideResult.draft_optout?.procedure_type).toBe("email");
  });

  it("includes additional corroborating PII only when minimization is explicitly disabled", async () => {
    const workflow = createAgentWorkflow();

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_override_pii_001",
        policy_overrides: {
          minimize_pii: false,
        },
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        site: "Radaris",
        page_text: "Jane Doe, age 35, Seattle, Washington.",
        page_url: "https://example.com/listing/jane-doe",
        retrieved_chunks: [
          { doc_id: "rad-1", quote: "Email privacy@radaris.example with a removal request." },
          { doc_id: "rad-2", quote: "Required fields: full name and privacy email." },
        ],
      },
    });

    expect(result.draft_optout?.email?.body).toContain(seedProfile.location.city);
    expect(result.draft_optout?.email?.body).toContain(seedProfile.location.state);
    expect(result.draft_optout?.email?.body).toContain(seedProfile.optional.phone_last4 ?? "");
  });

  it("fails closed when submitted execution evidence is unclear", async () => {
    const workflow = createAgentWorkflow();

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_008",
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        site: "FastPeopleSearch",
        page_text: "Jane Doe, age 35, Seattle, Washington. Phone 206-555-0114.",
        page_url: "https://example.com/listing/jane-doe",
        retrieved_chunks: [],
        execution_result: {
          site: "FastPeopleSearch",
          candidate_url: "https://example.com/listing/jane-doe",
          status: "submitted",
          confirmation: {
            ticket: null,
            page_text: null,
            screenshot_ref: null,
          },
          error: null,
        },
      },
    });

    expect(result.interpret_result).toEqual({
      next_status: "pending",
      next_action: "await_confirmation",
      review_reasons: [],
    });
  });

  it("routes CAPTCHA failures to manual review instead of retrying", async () => {
    const workflow = createAgentWorkflow();

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_009",
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        site: "FastPeopleSearch",
        page_text: "Jane Doe, age 35, Seattle, Washington. Phone 206-555-0114.",
        page_url: "https://example.com/listing/jane-doe",
        retrieved_chunks: [],
        execution_result: {
          site: "FastPeopleSearch",
          candidate_url: "https://example.com/listing/jane-doe",
          status: "failed",
          confirmation: {
            ticket: null,
            page_text: "CAPTCHA required before submission can continue.",
            screenshot_ref: null,
          },
          error: "CAPTCHA challenge encountered",
        },
      },
    });

    expect(result.interpret_result).toEqual({
      next_status: "manual_required",
      next_action: "request_user_review",
      review_reasons: ["captcha"],
    });
  });

  it("escalates exhausted retries to review and allows a looser pending override", async () => {
    const workflow = createAgentWorkflow();

    const retryExhausted = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_retry_limit_001",
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        ...defaultSiteInput,
        retry_count: 1,
        execution_result: {
          site: "FastPeopleSearch",
          candidate_url: "https://example.com/listing/jane-doe",
          status: "failed",
          confirmation: {
            ticket: null,
            page_text: "Submission failed.",
            screenshot_ref: null,
          },
          error: "Timeout",
        },
      },
    });

    const pendingOverride = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_pending_override_001",
        policy_overrides: {
          pending_confirmation_strategy: "request_user_review",
          max_submission_retries: 2,
        },
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        ...defaultSiteInput,
        execution_result: {
          site: "FastPeopleSearch",
          candidate_url: "https://example.com/listing/jane-doe",
          status: "pending",
          confirmation: {
            ticket: null,
            page_text: "Your request has been received.",
            screenshot_ref: null,
          },
          error: null,
        },
      },
    });

    expect(retryExhausted.interpret_result).toEqual({
      next_status: "failed",
      next_action: "request_user_review",
      review_reasons: ["manual_submission_required"],
    });
    expect(pendingOverride.interpret_result?.next_action).toBe("request_user_review");
  });
});
