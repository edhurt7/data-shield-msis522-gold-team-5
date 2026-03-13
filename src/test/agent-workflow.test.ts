import { describe, expect, it } from "vitest";

import {
  createAgentWorkflow as createBaseAgentWorkflow,
  createDefaultProcedureRetriever,
  WorkflowNodeExecutionError,
} from "@/lib/agent";
import {
  draftGeneratorPrompt,
  listingClassifierPrompt,
  postExecutionVerifierPrompt,
  procedureSelectorPrompt,
} from "@/lib/agent/prompts";
import { createWorkflowFixtureLlmAdapter } from "@/test/support/workflow-fixture-llm";

function createProcedureFetch() {
  return async (_request: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { site?: string };

    if (body.site === "FastPeopleSearch") {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          site: "FastPeopleSearch",
          retrieved_at: "2026-03-12T12:00:00.000Z",
          procedures: [
            {
              procedure_id: "fastpeoplesearch-procedure-v1",
              site: "FastPeopleSearch",
              updated_at: "2026-03-10T00:00:00.000Z",
              channel_hint: "webform",
              source_chunks: [
                {
                  doc_id: "fps-api-1",
                  quote: "Use the FastPeopleSearch removal webform to request record suppression.",
                  source_id: "fastpeoplesearch-procedure-v1",
                  source_updated_at: "2026-03-10T00:00:00.000Z",
                  retrieved_at: "2026-03-12T12:00:00.000Z",
                },
                {
                  doc_id: "fps-api-2",
                  quote: "Required fields: full name and privacy email. Check the consent checkbox before form submission.",
                  source_id: "fastpeoplesearch-procedure-v1",
                  source_updated_at: "2026-03-10T00:00:00.000Z",
                  retrieved_at: "2026-03-12T12:00:00.000Z",
                },
              ],
            },
          ],
        }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        site: body.site ?? "unknown",
        retrieved_at: "2026-03-12T12:00:00.000Z",
        procedures: [],
      }),
    } as Response;
  };
}

function createAgentWorkflow(...args: Parameters<typeof createBaseAgentWorkflow>) {
  const [options] = args;

  return createBaseAgentWorkflow({
    procedureRetriever: createDefaultProcedureRetriever({
      fetchFn: createProcedureFetch() as typeof fetch,
    }),
    llm: {
      adapter: createWorkflowFixtureLlmAdapter(),
    },
    ...options,
  });
}

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
          manual_review_required: false,
          confirmation_text: "Your request has been received.",
          ticket_ids: [],
          screenshot_ref: null,
          error_text: null,
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
    expect(result.draft_optout?.submission_channel).toBe("webform");
    expect(result.draft_optout?.required_fields).toEqual([
      { name: "full_name", value: seedProfile.full_name, required: true },
      { name: "privacy_email", value: seedProfile.privacy_email, required: true },
    ]);
    expect(result.draft_optout?.webform?.fields.some((field) => field.name === "privacy_email")).toBe(true);
    expect(result.draft_optout?.webform?.consent_checkboxes[0]?.instruction).toContain("checkbox");
    expect(result.draft_optout?.email).toBeUndefined();
    expect(result.plan_submission?.requires_manual_review).toBe(false);
    expect(result.plan_submission?.action_plan.manual_review_required).toBe(false);
    expect(result.interpret_result?.next_status).toBe("pending");
    expect(result.interpret_result?.next_action).toBe("await_confirmation");
    expect(result.prompt_trace).toEqual({
      discovery_parse: {
        prompt_name: listingClassifierPrompt.name,
        prompt_version: listingClassifierPrompt.version,
      },
      retrieve_procedure: {
        prompt_name: procedureSelectorPrompt.name,
        prompt_version: procedureSelectorPrompt.version,
      },
      draft_optout: {
        prompt_name: draftGeneratorPrompt.name,
        prompt_version: draftGeneratorPrompt.version,
      },
      interpret_result: {
        prompt_name: postExecutionVerifierPrompt.name,
        prompt_version: postExecutionVerifierPrompt.version,
      },
    });
    expect(result.context.events.map((event) => event.phase)).toEqual([
      "intake",
      "match",
      "retrieve_procedure",
      "draft",
      "approval",
      "verification",
      "verification",
    ]);
    expect(result.context.events.at(-1)).toMatchObject({
      phase: "verification",
      status: "awaiting_user",
      siteId: "fastpeoplesearch",
      message: "Submission pending confirmation for FastPeopleSearch.",
    });
  });

  it("logs structured decision events for blocked low-confidence matches", async () => {
    const workflow = createAgentWorkflow();

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_events_low_confidence_001",
      },
      seed_profile: seedProfile,
      request_text: "Search for my profile.",
      site_input: {
        site: "UnknownBroker",
        page_text: "Jane Doe",
        page_url: "https://example.com/listing/jane-doe-unknown",
        retrieved_chunks: [],
      },
    });

    expect(result.context.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        phase: "match",
        status: "blocked",
        reviewReasons: ["low_confidence_match"],
      }),
      expect.objectContaining({
        phase: "match",
        status: "blocked",
        message: "Low-confidence match blocked workflow progression for UnknownBroker.",
      }),
    ]));
  });

  it("attaches a structured workflow event when a model-backed node fails", async () => {
    const workflow = createAgentWorkflow({
      nodes: {
        async discoveryParse() {
          throw new Error("Synthetic discovery failure.");
        },
      },
    });

    await expect(workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_failure_event_001",
      },
      seed_profile: seedProfile,
      request_text: "Search for my profile.",
      site_input: {
        ...defaultSiteInput,
      },
    })).rejects.toBeInstanceOf(WorkflowNodeExecutionError);

    try {
      await workflow.run({
        context: {
          ...baseContext,
          run_id: "run_workflow_failure_event_001",
        },
        seed_profile: seedProfile,
        request_text: "Search for my profile.",
        site_input: {
          ...defaultSiteInput,
        },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowNodeExecutionError);
      expect((error as WorkflowNodeExecutionError).workflowEvent).toMatchObject({
        phase: "scan",
        status: "failed",
        siteId: "fastpeoplesearch",
        message: "Synthetic discovery failure.",
        reviewReasons: ["manual_submission_required"],
      });
    }
  });

  it("orchestrates multiple sites and returns per-site outcomes", async () => {
    const workflow = createAgentWorkflow();

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_multi_001",
      },
      seed_profile: seedProfile,
      request_text: "Search multiple broker sites and remove matches where safe.",
      site_inputs: [
        {
          ...defaultSiteInput,
          execution_result: {
            site: "FastPeopleSearch",
            candidate_url: "https://example.com/listing/jane-doe",
            status: "pending",
            manual_review_required: false,
            confirmation_text: "Your request has been received.",
            ticket_ids: [],
            screenshot_ref: null,
            error_text: null,
          },
        },
        {
          site: "UnknownBroker",
          page_text: "Jane Doe",
          page_url: "https://example.com/listing/jane-doe-unknown",
          retrieved_chunks: [],
        },
      ],
    });

    expect(result.site_runs).toHaveLength(2);
    expect(result.site_runs[0]?.site_input.site).toBe("FastPeopleSearch");
    expect(result.site_runs[0]?.terminal_path).toBe("await_confirmation");
    expect(result.site_runs[1]?.site_input.site).toBe("UnknownBroker");
    expect(result.site_runs[1]?.terminal_path).toBe("low_confidence_match_blocked");
    expect(result.context.review_reasons).toContain("low_confidence_match");
    expect(result.validate_consent.approved_for_submission).toBe(true);
    expect(result.run_summary).toMatchObject({
      overall_status: "partial_success",
      partial_success: true,
      total_requested_sites: 2,
      total_processed_sites: 2,
      matched_sites: 2,
      pending_sites: 0,
      completed_sites: 2,
      successful_sites: 1,
      blocked_sites: 1,
    });
    expect(result.run_summary.sites_by_terminal_path.await_confirmation).toBe(1);
    expect(result.run_summary.sites_by_terminal_path.low_confidence_match_blocked).toBe(1);
    expect(result.run_summary.site_outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        site: "FastPeopleSearch",
        successful: true,
        review_blocked: false,
        retry_count: 0,
      }),
      expect.objectContaining({
        site: "UnknownBroker",
        successful: false,
        review_blocked: true,
        retry_count: 0,
      }),
    ]));
  });

  it("accepts a site registry batch input model and uses registry fallback chunks", async () => {
    const workflow = createAgentWorkflow();

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_registry_batch_001",
      },
      seed_profile: seedProfile,
      request_text: "Run a batch removal workflow from the site registry.",
      requested_sites: ["FastPeopleSearch"],
      site_registry: [
        {
          site: "FastPeopleSearch",
          enabled: true,
          page_text: defaultSiteInput.page_text,
          page_url: defaultSiteInput.page_url,
          default_procedure_chunks: [
            { doc_id: "fps-registry-1", quote: "Use the FastPeopleSearch webform and provide full name plus privacy email." },
          ],
        },
        {
          site: "DisabledBroker",
          enabled: false,
          default_procedure_chunks: [
            { doc_id: "disabled-1", quote: "This entry should not execute." },
          ],
        },
      ],
    });

    expect(result.site_runs).toHaveLength(1);
    expect(result.site_runs[0]?.site_input.site).toBe("FastPeopleSearch");
    expect(result.retrieve_procedure?.source_chunks).toEqual([
      {
        doc_id: "fps-registry-1",
        quote: "Use the FastPeopleSearch webform and provide full name plus privacy email.",
        source_id: "fps-registry-1",
        source_updated_at: null,
        retrieved_at: null,
      },
    ]);
    expect(result.retrieve_procedure?.procedure_type).toBe("webform");
    expect(result.run_summary).toMatchObject({
      requested_sites: ["FastPeopleSearch"],
      processed_sites: ["FastPeopleSearch"],
      total_requested_sites: 1,
      total_processed_sites: 1,
    });
  });

  it("tracks per-site retries and keeps review-blocked sites from blocking successful sites", async () => {
    const workflow = createAgentWorkflow();

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_partial_success_001",
      },
      seed_profile: seedProfile,
      request_text: "Run across all requested sites and summarize partial success.",
      site_inputs: [
        {
          ...defaultSiteInput,
          retry_count: 1,
          execution_result: {
            site: "FastPeopleSearch",
            candidate_url: "https://example.com/listing/jane-doe",
            status: "pending",
            manual_review_required: false,
            confirmation_text: "Your request has been received.",
            ticket_ids: [],
            screenshot_ref: null,
            error_text: null,
          },
        },
        {
          site: "AmbiguousBroker",
          page_text: "Jane Doe",
          page_url: "https://example.com/listing/jane-doe-ambiguous",
          retrieved_chunks: [],
          retry_count: 2,
        },
      ],
    });

    expect(result.site_runs[0]?.terminal_path).toBe("await_confirmation");
    expect(result.site_runs[1]?.terminal_path).toBe("low_confidence_match_blocked");
    expect(result.run_summary).toMatchObject({
      overall_status: "partial_success",
      partial_success: true,
      successful_sites: 1,
      blocked_sites: 1,
      total_retry_count: 3,
    });
    expect(result.run_summary.site_outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        site: "FastPeopleSearch",
        retry_count: 1,
        successful: true,
        review_blocked: false,
      }),
      expect.objectContaining({
        site: "AmbiguousBroker",
        retry_count: 2,
        successful: false,
        review_blocked: true,
      }),
    ]));
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
    expect(result.terminal_path).toBe("low_confidence_match_blocked");
    expect(result.prompt_trace.draft_optout).toBeNull();
    expect(result.prompt_trace.interpret_result).toBeNull();
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
    expect(result.terminal_path).toBe("missing_procedure");
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
    expect(result.terminal_path).toBe("stale_procedure");
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
    expect(result.terminal_path).toBe("contradictory_procedure");
  });

  it.each([
    [
      "stale",
      {
        status: "stale" as const,
        chunks: [
          { doc_id: "fps-stale-1", quote: "Old removal instructions." },
        ],
        notes: "Procedure is stale.",
        review_reasons: ["stale_procedure"] as const,
      },
      "stale_procedure",
    ],
    [
      "contradictory",
      {
        status: "contradictory" as const,
        chunks: [
          { doc_id: "fps-contradict-1", quote: "Submit by email." },
          { doc_id: "fps-contradict-2", quote: "Use the webform only." },
        ],
        notes: "Procedure sources disagree.",
        review_reasons: ["contradictory_procedure"] as const,
      },
      "contradictory_procedure",
    ],
  ])("short-circuits blocked %s retrieval before procedure selection", async (_label, resolution, terminalPath) => {
    let retrieveProcedureCalled = false;

    const workflow = createAgentWorkflow({
      procedureRetriever: () => resolution,
      nodes: {
        retrieveProcedure() {
          retrieveProcedureCalled = true;
          throw new Error("retrieveProcedure should not run when retrieval is blocked");
        },
      },
    });

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: `run_workflow_blocked_retrieval_${terminalPath}`,
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

    expect(retrieveProcedureCalled).toBe(false);
    expect(result.retrieve_procedure?.procedure_type).toBe("procedure_unknown");
    expect(result.prompt_trace.retrieve_procedure).toBeNull();
    expect(result.terminal_path).toBe(terminalPath);
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

  it("uses a no-grounding fallback for incomplete procedure docs when grounding is disabled", async () => {
    const workflow = createAgentWorkflow();

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_006b",
        policy_overrides: {
          require_retrieval_grounding: false,
        },
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

    expect(result.retrieve_procedure).toMatchObject({
      procedure_type: "webform",
      required_fields: ["full_name", "privacy_email"],
      source_chunks: [
        { doc_id: "fps-1", quote: "Use the FastPeopleSearch removal webform." },
      ],
    });
    expect(result.context.review_reasons).not.toContain("procedure_unknown");
    expect(result.draft_optout?.procedure_type).toBe("webform");
    expect(result.plan_submission).not.toBeNull();
    expect(result.prompt_trace.retrieve_procedure).toBeNull();
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
    expect(defaultResult.prompt_trace.retrieve_procedure).toBeNull();
    expect(overrideResult.context.review_reasons).not.toContain("procedure_unknown");
    expect(overrideResult.draft_optout?.procedure_type).toBe("email");
    expect(overrideResult.prompt_trace.retrieve_procedure).toBeNull();
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
          manual_review_required: false,
          confirmation_text: null,
          ticket_ids: [],
          screenshot_ref: null,
          error_text: null,
        },
      },
    });

    expect(result.interpret_result).toEqual({
      next_status: "pending",
      next_action: "await_confirmation",
      review_reasons: [],
    });
    expect(result.terminal_path).toBe("await_confirmation");
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
          manual_review_required: true,
          confirmation_text: "CAPTCHA required before submission can continue.",
          ticket_ids: [],
          screenshot_ref: null,
          error_text: "CAPTCHA challenge encountered",
        },
      },
    });

    expect(result.interpret_result).toEqual({
      next_status: "manual_required",
      next_action: "request_user_review",
      review_reasons: ["captcha"],
    });
    expect(result.terminal_path).toBe("captcha_review");
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
          manual_review_required: false,
          confirmation_text: "Submission failed.",
          ticket_ids: [],
          screenshot_ref: null,
          error_text: "Timeout",
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
          manual_review_required: false,
          confirmation_text: "Your request has been received.",
          ticket_ids: [],
          screenshot_ref: null,
          error_text: null,
        },
      },
    });

    expect(retryExhausted.interpret_result).toEqual({
      next_status: "failed",
      next_action: "request_user_review",
      review_reasons: ["manual_submission_required"],
    });
    expect(retryExhausted.terminal_path).toBe("retry_exhausted");
    expect(pendingOverride.interpret_result?.next_action).toBe("request_user_review");
    expect(pendingOverride.terminal_path).toBe("manual_review");
  });

  it("schedules a monitoring follow-up for pending confirmations using local policy timing", async () => {
    const workflow = createAgentWorkflow();

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_monitoring_pending_001",
        policy_overrides: {
          monitoring_cadence_days: 14,
          re_review_cooldown_days: 7,
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
          manual_review_required: false,
          confirmation_text: "Your request has been received.",
          ticket_ids: [],
          screenshot_ref: null,
          error_text: null,
        },
      },
    });

    expect(result.monitoring).toEqual({
      status: "awaiting_confirmation",
      reason: "pending_confirmation",
      last_scan_at: "2026-03-13T00:00:00.000Z",
      next_scan_at: "2026-03-20T00:00:00.000Z",
      cooldown_ends_at: null,
      reappearance_count: 0,
      trigger_new_removal_cycle: false,
      backend_required: true,
      notes: "Submission for FastPeopleSearch is still awaiting confirmation; schedule a follow-up check on the local monitoring cadence until backend support lands.",
    });
    expect(result.run_summary.monitoring).toEqual({
      scheduled_sites: 0,
      awaiting_confirmation_sites: 1,
      due_sites: 0,
      manual_review_sites: 0,
      new_removal_cycle_sites: 0,
    });
  });

  it("schedules successful runs for cadence-based re-scan monitoring", async () => {
    const workflow = createAgentWorkflow();

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_monitoring_completed_001",
        policy_overrides: {
          monitoring_cadence_days: 14,
          re_review_listing_reappearance_threshold: 2,
        },
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        ...defaultSiteInput,
        execution_result: {
          site: "FastPeopleSearch",
          candidate_url: "https://example.com/listing/jane-doe",
          status: "submitted",
          manual_review_required: false,
          confirmation_text: "Your request has been submitted successfully.",
          ticket_ids: ["fps-123"],
          screenshot_ref: null,
          error_text: null,
        },
      },
    });

    expect(result.terminal_path).toBe("completed");
    expect(result.monitoring).toMatchObject({
      status: "scheduled",
      reason: "cadence",
      last_scan_at: "2026-03-13T00:00:00.000Z",
      next_scan_at: "2026-03-27T00:00:00.000Z",
      trigger_new_removal_cycle: false,
    });
    expect(result.run_summary.monitoring).toEqual({
      scheduled_sites: 1,
      awaiting_confirmation_sites: 0,
      due_sites: 0,
      manual_review_sites: 0,
      new_removal_cycle_sites: 0,
    });
  });

  it("marks relisted submitted results as a new removal-cycle trigger when cooldown is exhausted", async () => {
    const workflow = createAgentWorkflow();

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_monitoring_reappearance_001",
        policy_overrides: {
          monitoring_cadence_days: 21,
          re_review_cooldown_days: 0,
          re_review_listing_reappearance_threshold: 1,
        },
      },
      seed_profile: seedProfile,
      request_text: "Re-scan this broker and restart removal if my listing reappears.",
      site_input: {
        ...defaultSiteInput,
        execution_result: {
          site: "FastPeopleSearch",
          candidate_url: "https://example.com/listing/jane-doe",
          status: "submitted",
          manual_review_required: false,
          confirmation_text: "Request submitted successfully.",
          ticket_ids: ["fps-456"],
          screenshot_ref: null,
          error_text: null,
        },
      },
    });

    expect(result.monitoring).toEqual({
      status: "rescan_due",
      reason: "listing_reappeared",
      last_scan_at: "2026-03-13T00:00:00.000Z",
      next_scan_at: "2026-03-13T00:00:00.000Z",
      cooldown_ends_at: "2026-03-13T00:00:00.000Z",
      reappearance_count: 1,
      trigger_new_removal_cycle: true,
      backend_required: true,
      notes: "Listing still appears on FastPeopleSearch after a prior submitted removal; start a new removal cycle when backend scheduling exists.",
    });
    expect(result.run_summary.monitoring).toEqual({
      scheduled_sites: 0,
      awaiting_confirmation_sites: 0,
      due_sites: 1,
      manual_review_sites: 0,
      new_removal_cycle_sites: 1,
    });
  });

  it("checkpoints approval-paused runs and resumes with an execution result", async () => {
    const workflow = createAgentWorkflow();
    const checkpoint = { thread_id: "run_workflow_checkpoint_approval_001" };

    const paused = await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_checkpoint_approval_001",
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        ...defaultSiteInput,
        retrieved_chunks: [{ doc_id: "fps-1", quote: "Open the webform and enter full name and email." }],
      },
    }, { checkpoint });

    expect(paused.plan_submission).not.toBeNull();
    expect(paused.interpret_result).toBeNull();
    expect(paused.terminal_path).toBeNull();
    expect(paused.checkpoint?.thread_id).toBe(checkpoint.thread_id);
    expect(paused.checkpoint?.resume_required).toBe(true);

    const resumed = await workflow.resume({
      context: {
        ...baseContext,
        run_id: "run_workflow_checkpoint_approval_001",
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        ...defaultSiteInput,
        retrieved_chunks: [{ doc_id: "fps-1", quote: "Open the webform and enter full name and email." }],
        execution_result: {
          site: "FastPeopleSearch",
          candidate_url: "https://example.com/listing/jane-doe",
          status: "pending",
          manual_review_required: false,
          confirmation_text: "Your request has been received.",
          ticket_ids: [],
          screenshot_ref: null,
          error_text: null,
        },
      },
    }, { checkpoint });

    expect(resumed.interpret_result).toEqual({
      next_status: "pending",
      next_action: "await_confirmation",
      review_reasons: [],
    });
    expect(resumed.terminal_path).toBe("await_confirmation");
    expect(resumed.checkpoint?.thread_id).toBe(checkpoint.thread_id);
  });

  it("resumes failed runs from the checkpoint without replaying earlier successful nodes", async () => {
    const counters = {
      validateConsent: 0,
      discoveryParse: 0,
      retrieveProcedure: 0,
    };

    const workflow = createAgentWorkflow({
      nodes: {
        validateConsent(input, context) {
          counters.validateConsent += 1;
          return {
            seed_profile: input.seed_profile,
            normalized_query: `${input.seed_profile.full_name} ${input.seed_profile.location.city}`,
            approved_for_submission: context.policy.require_explicit_consent,
          };
        },
        discoveryParse(input) {
          counters.discoveryParse += 1;
          return {
            site: input.site,
            scan_timestamp: "2026-03-13T00:00:00.000Z",
            found: true,
            candidates: [
              {
                url: input.page_artifact.url,
                extracted: {
                  name: input.seed_profile.full_name,
                  age: input.seed_profile.approx_age,
                  addresses: [],
                  relatives: [],
                  phones: [],
                },
                match_confidence: 0.95,
                evidence_snippets: [input.seed_profile.full_name],
              },
            ],
            notes: null,
          };
        },
        retrieveProcedure(input) {
          counters.retrieveProcedure += 1;
          if (counters.retrieveProcedure === 1) {
            throw new Error("transient retrieval failure");
          }

          return {
            site: input.site,
            procedure_type: "email",
            required_fields: ["full_name", "privacy_email"],
            steps: ["Send the request by email."],
            source_chunks: [{ doc_id: "retry-1", quote: "Email privacy@site.test with your full name and privacy email." }],
          };
        },
      },
    });

    const checkpoint = { thread_id: "run_workflow_checkpoint_failure_001" };
    const runInput = {
      context: {
        ...baseContext,
        run_id: "run_workflow_checkpoint_failure_001",
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        ...defaultSiteInput,
        retrieved_chunks: [{ doc_id: "retry-1", quote: "Email privacy@site.test with your full name and privacy email." }],
      },
    };

    await expect(workflow.run(runInput, { checkpoint })).rejects.toThrow("transient retrieval failure");

    const resumed = await workflow.run(runInput, { checkpoint });

    expect(resumed.draft_optout?.procedure_type).toBe("email");
    expect(counters.validateConsent).toBe(1);
    expect(counters.discoveryParse).toBe(1);
    expect(counters.retrieveProcedure).toBe(2);
  });

  it("normalizes automation page artifacts before discovery parsing", async () => {
    let discoveryInputArtifact: { visible_text: string; url: string; screenshot_ref?: string | null; extracted_metadata?: Record<string, unknown> } | null = null;

    const workflow = createAgentWorkflow({
      nodes: {
        discoveryParse(input) {
          discoveryInputArtifact = input.page_artifact;

          return {
            site: input.site,
            scan_timestamp: "2026-03-13T00:00:00.000Z",
            found: true,
            candidates: [
              {
                url: input.page_artifact.url,
                extracted: {
                  name: input.seed_profile.full_name,
                  age: input.seed_profile.approx_age,
                  addresses: [],
                  relatives: [],
                  phones: [],
                },
                match_confidence: 0.95,
                evidence_snippets: [input.seed_profile.full_name],
              },
            ],
            notes: null,
          };
        },
      },
    });

    await workflow.run({
      context: {
        ...baseContext,
        run_id: "run_workflow_normalized_artifact_001",
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        site: "FastPeopleSearch",
        page_artifact: {
          visible_text: "  Jane Doe \r\n\r\n   age 35\tSeattle,\u00A0Washington  ",
          url: "https://example.com/listing/jane-doe",
          screenshot_ref: "  artifacts/jane-doe.png  ",
          extracted_metadata: {
            title: "  Jane Doe Listing  ",
            description: "  Jane Doe in Seattle.\r\n\r\n  ",
            headings: ["  Jane Doe  ", " Seattle \t Washington "],
            page_category: "  listing_detail  ",
          },
        },
        retrieved_chunks: [{ doc_id: "fps-1", quote: "Open the webform and enter full name and email." }],
      },
    });

    expect(discoveryInputArtifact).toEqual({
      visible_text: "Jane Doe\n\nage 35 Seattle, Washington",
      url: "https://example.com/listing/jane-doe",
      screenshot_ref: "artifacts/jane-doe.png",
      extracted_metadata: {
        title: "Jane Doe Listing",
        description: "Jane Doe in Seattle.",
        headings: ["Jane Doe", "Seattle Washington"],
        page_category: "listing_detail",
      },
    });
  });

  it.each([
    [
      "empty page text",
      {
        visible_text: "   \n\t  ",
        url: "https://example.com/listing/jane-doe",
      },
      "site_unreachable",
      "site_unreachable",
    ],
    [
      "redirect page",
      {
        visible_text: "Redirecting to the home page",
        url: "https://example.com/redirect",
        extracted_metadata: {
          page_category: "redirect",
          title: "Redirecting",
        },
      },
      "site_unreachable",
      "site_unreachable",
    ],
    [
      "blocked page",
      {
        visible_text: "Access denied due to unusual traffic from your network.",
        url: "https://example.com/blocked",
      },
      "blocked",
      "rate_limited",
    ],
    [
      "anti-bot page",
      {
        visible_text: "Please complete the CAPTCHA to continue. Verify you are human.",
        url: "https://example.com/captcha",
      },
      "captcha_review",
      "captcha",
    ],
  ])("fails closed before discovery on %s", async (_label, pageArtifact, terminalPath, reviewReason) => {
    let discoveryCalled = false;

    const workflow = createAgentWorkflow({
      nodes: {
        discoveryParse() {
          discoveryCalled = true;
          throw new Error("discoveryParse should not run for failed automation artifacts");
        },
      },
    });

    const result = await workflow.run({
      context: {
        ...baseContext,
        run_id: `run_workflow_artifact_failure_${terminalPath}`,
      },
      seed_profile: seedProfile,
      request_text: "Find me and remove the listing.",
      site_input: {
        site: "FastPeopleSearch",
        page_artifact: pageArtifact,
        retrieved_chunks: [],
      },
    });

    expect(discoveryCalled).toBe(false);
    expect(result.discovery_parse.found).toBe(false);
    expect(result.context.review_reasons).toContain(reviewReason);
    expect(result.terminal_path).toBe(terminalPath);
    expect(result.match_decision?.decision).toBe("no_match");
  });
});
