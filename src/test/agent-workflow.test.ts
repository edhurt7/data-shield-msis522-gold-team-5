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
    policy: {
      match_confidence_threshold: 0.75,
      max_submission_retries: 1,
      require_explicit_consent: true,
      minimize_pii: true,
      require_retrieval_grounding: true,
    },
    review_reasons: [],
    events: [],
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
        site: "FastPeopleSearch",
        page_text: "Jane Doe, age 35, Seattle, Washington. Phone 206-555-0114. Relatives: John Doe",
        page_url: "https://example.com/listing/jane-doe",
        retrieved_chunks: [],
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
});
