import { describe, expect, it } from "vitest";

import {
  createAgentWorkflow,
  createFixtureLlmAdapter,
  createOpenAiCompatibleStructuredLlmAdapter,
  createPromptBackedNodes,
  StructuredLlmOutputValidationError,
  WorkflowNodeExecutionError,
} from "@/lib/agent";
import {
  draftGeneratorPrompt,
  listingClassifierPrompt,
  postExecutionVerifierPrompt,
  procedureSelectorPrompt,
} from "@/lib/agent/prompts";

describe("prompt-backed workflow nodes", () => {
  it("runs the workflow using fixture-backed structured prompt outputs", async () => {
    const adapter = createFixtureLlmAdapter({
      listing_classifier_extractor: {
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
              phones: ["206-555-0114"],
            },
            match_confidence: 0.95,
            evidence_snippets: ["Jane Doe, Seattle, WA"],
          },
        ],
        notes: null,
      },
      procedure_selector: {
        site: "FastPeopleSearch",
        procedure_type: "email",
        required_fields: ["full_name", "privacy_email"],
        steps: ["Send request to privacy@fastpeoplesearch.test"],
        source_chunks: [{ doc_id: "fps-1", quote: "Email privacy@fastpeoplesearch.test for removal requests." }],
      },
      draft_generator: {
        site: "FastPeopleSearch",
        candidate_url: "https://example.com/listing/jane-doe",
        submission_channel: "email",
        procedure_type: "email",
        required_fields: [
          { name: "full_name", value: "Jane Doe", required: true },
          { name: "privacy_email", value: "shield-abc123@detraceme.io", required: true },
        ],
        optional_fields: [],
        manual_review_required: false,
        review_reasons: [],
        email: {
          to: "privacy@fastpeoplesearch.test",
          subject: "Removal request for Jane Doe",
          body: "Please remove my listing. Contact only shield-abc123@detraceme.io.",
        },
      },
      post_execution_verifier: {
        next_status: "pending",
        next_action: "await_confirmation",
        review_reasons: [],
      },
    });

    const workflow = createAgentWorkflow({
      nodes: createPromptBackedNodes(adapter),
    });

    const result = await workflow.run({
      context: {
        run_id: "run_prompt_001",
        policy: {
          match_confidence_threshold: 0.75,
          max_submission_retries: 1,
          require_explicit_consent: true,
          minimize_pii: true,
          require_retrieval_grounding: true,
        },
        review_reasons: [],
        events: [],
      },
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
      site_input: {
        site: "FastPeopleSearch",
        page_text: "fixture page text",
        page_url: "https://example.com/listing/jane-doe",
        retrieved_chunks: [{ doc_id: "fps-1", quote: "Email privacy@fastpeoplesearch.test for removal requests." }],
        execution_result: {
          site: "FastPeopleSearch",
          candidate_url: "https://example.com/listing/jane-doe",
          status: "pending",
          manual_review_required: false,
          confirmation_text: "Request received",
          ticket_ids: [],
          screenshot_ref: null,
          error_text: null,
        },
      },
    });

    expect(result.discovery_parse.candidates[0]?.match_confidence).toBe(0.95);
    expect(result.retrieve_procedure?.procedure_type).toBe("email");
    expect(result.draft_optout?.email?.to).toBe("privacy@fastpeoplesearch.test");
    expect(result.interpret_result?.next_action).toBe("await_confirmation");
  });

  it("wires live prompt-backed nodes into the workflow from env-backed runtime config", async () => {
    const promptCalls: string[] = [];

    const workflow = createAgentWorkflow({
      llm: {
        env: {
          AGENT_LLM_BASE_URL: "https://llm.example.test/v1",
          AGENT_LLM_API_KEY: "secret-key",
          AGENT_LLM_MODEL: "gpt-4.1-mini",
        },
        transport: async () => ({
          ok: true,
          status: 200,
          text: async () => {
            const promptName = promptCalls.length === 0
              ? "listing_classifier_extractor"
              : promptCalls.length === 1
                ? "procedure_selector"
                : promptCalls.length === 2
                  ? "draft_generator"
                  : "post_execution_verifier";

            promptCalls.push(promptName);

            switch (promptName) {
              case "listing_classifier_extractor":
                return JSON.stringify({
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
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
                                phones: ["206-555-0114"],
                              },
                              match_confidence: 0.95,
                              evidence_snippets: ["Jane Doe, Seattle, WA"],
                            },
                          ],
                          notes: null,
                        }),
                      },
                    },
                  ],
                });
              case "procedure_selector":
                return JSON.stringify({
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          site: "FastPeopleSearch",
                          procedure_type: "email",
                          required_fields: ["full_name", "privacy_email"],
                          steps: ["Send request to privacy@fastpeoplesearch.test"],
                          source_chunks: [{ doc_id: "fps-1", quote: "Email privacy@fastpeoplesearch.test for removal requests." }],
                        }),
                      },
                    },
                  ],
                });
              case "draft_generator":
                return JSON.stringify({
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          site: "FastPeopleSearch",
                          candidate_url: "https://example.com/listing/jane-doe",
                          submission_channel: "email",
                          procedure_type: "email",
                          required_fields: [
                            { name: "full_name", value: "Jane Doe", required: true },
                            { name: "privacy_email", value: "shield-abc123@detraceme.io", required: true },
                          ],
                          optional_fields: [],
                          manual_review_required: false,
                          review_reasons: [],
                          email: {
                            to: "privacy@fastpeoplesearch.test",
                            subject: "Removal request for Jane Doe",
                            body: "Please remove my listing. Contact only shield-abc123@detraceme.io.",
                          },
                        }),
                      },
                    },
                  ],
                });
              default:
                return JSON.stringify({
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          next_status: "pending",
                          next_action: "await_confirmation",
                          review_reasons: [],
                        }),
                      },
                    },
                  ],
                });
            }
          },
        }),
      },
    });

    const result = await workflow.run({
      context: {
        run_id: "run_prompt_runtime_001",
        policy: {
          match_confidence_threshold: 0.75,
          max_submission_retries: 1,
          require_explicit_consent: true,
          minimize_pii: true,
          require_retrieval_grounding: true,
        },
        review_reasons: [],
        events: [],
      },
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
      site_input: {
        site: "FastPeopleSearch",
        page_text: "fixture page text",
        page_url: "https://example.com/listing/jane-doe",
        retrieved_chunks: [{ doc_id: "fps-1", quote: "Email privacy@fastpeoplesearch.test for removal requests." }],
        execution_result: {
          site: "FastPeopleSearch",
          candidate_url: "https://example.com/listing/jane-doe",
          status: "pending",
          manual_review_required: false,
          confirmation_text: "Request received",
          ticket_ids: [],
          screenshot_ref: null,
          error_text: null,
        },
      },
    });

    expect(promptCalls).toEqual([
      "listing_classifier_extractor",
      "procedure_selector",
      "draft_generator",
      "post_execution_verifier",
    ]);
    expect(result.retrieve_procedure?.procedure_type).toBe("email");
    expect(result.draft_optout?.email?.to).toBe("privacy@fastpeoplesearch.test");
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
  });

  it("formats an OpenAI-compatible structured request and parses the response", async () => {
    let capturedRequest: { url: string; headers: Record<string, string>; body: string } | null = null;

    const adapter = createOpenAiCompatibleStructuredLlmAdapter({
      baseUrl: "https://llm.example.test/v1/",
      apiKey: "secret-key",
      model: "gpt-4.1-mini",
      headers: {
        "X-Test-Header": "agent-suite",
      },
      transport: async (request) => {
        capturedRequest = {
          url: request.url,
          headers: request.headers,
          body: request.body,
        };

        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    site: "FastPeopleSearch",
                    procedure_type: "email",
                    required_fields: ["full_name", "privacy_email"],
                    steps: ["Email privacy@fastpeoplesearch.test"],
                    source_chunks: [
                      {
                        doc_id: "fps-1",
                        quote: "Email privacy@fastpeoplesearch.test for removals.",
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        };
      },
    });

    const result = await adapter.generateStructured({
      prompt: procedureSelectorPrompt,
      input: {
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
                addresses: [],
                relatives: [],
                phones: [],
              },
              match_confidence: 0.95,
              evidence_snippets: ["Jane Doe, Seattle, WA"],
            },
          ],
          notes: null,
        },
        retrieved_chunks: [{ doc_id: "fps-1", quote: "Email privacy@fastpeoplesearch.test for removals." }],
      },
    });

    expect(result.procedure_type).toBe("email");
    expect(capturedRequest?.url).toBe("https://llm.example.test/v1/chat/completions");
    expect(capturedRequest?.headers.Authorization).toBe("Bearer secret-key");
    expect(capturedRequest?.headers["X-Test-Header"]).toBe("agent-suite");

    const body = JSON.parse(capturedRequest?.body ?? "{}");
    expect(body.model).toBe("gpt-4.1-mini");
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[1].content).toContain("Retrieved chunks");
  });

  it("rejects schema-invalid model output", async () => {
    const adapter = createOpenAiCompatibleStructuredLlmAdapter({
      baseUrl: "https://llm.example.test/v1",
      apiKey: "secret-key",
      model: "gpt-4.1-mini",
      transport: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  site: "FastPeopleSearch",
                  procedure_type: "postal_mail",
                  required_fields: ["full_name"],
                  steps: ["Email privacy@fastpeoplesearch.test"],
                  source_chunks: [],
                }),
              },
            },
          ],
        }),
      }),
    });

    await expect(
      adapter.generateStructured({
        prompt: procedureSelectorPrompt,
        input: {
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
                  addresses: [],
                  relatives: [],
                  phones: [],
                },
                match_confidence: 0.95,
                evidence_snippets: ["Jane Doe, Seattle, WA"],
              },
            ],
            notes: null,
          },
          retrieved_chunks: [{ doc_id: "fps-1", quote: "Email privacy@fastpeoplesearch.test for removals." }],
        },
      }),
    ).rejects.toMatchObject({
      name: "StructuredLlmOutputValidationError",
      promptName: "procedure_selector",
      rawOutput: {
        site: "FastPeopleSearch",
        procedure_type: "postal_mail",
        required_fields: ["full_name"],
        steps: ["Email privacy@fastpeoplesearch.test"],
        source_chunks: [],
      },
    });
  });

  it("fails closed at workflow execution when a prompt returns schema-invalid output", async () => {
    const adapter = createFixtureLlmAdapter({
      listing_classifier_extractor: {
        site: "FastPeopleSearch",
        scan_timestamp: "2026-03-12T12:00:00.000Z",
        found: true,
        candidates: [
          {
            url: "https://example.com/listing/jane-doe",
            extracted: {
              name: "Jane Doe",
              age: "35",
              addresses: [],
              relatives: [],
              phones: [],
            },
            match_confidence: 0.95,
            evidence_snippets: ["Jane Doe, Seattle, WA"],
          },
        ],
        notes: null,
      },
      procedure_selector: {
        site: "FastPeopleSearch",
        procedure_type: "email",
        required_fields: ["full_name", "privacy_email"],
        steps: ["Send request to privacy@fastpeoplesearch.test"],
        source_chunks: [{ doc_id: "fps-1", quote: "Email privacy@fastpeoplesearch.test for removal requests." }],
      },
      draft_generator: {
        site: "FastPeopleSearch",
        candidate_url: "https://example.com/listing/jane-doe",
        submission_channel: "webform",
        procedure_type: "email",
        required_fields: [
          { name: "full_name", value: "Jane Doe", required: true },
        ],
        optional_fields: [],
        manual_review_required: false,
        review_reasons: [],
        email: {
          to: "privacy@fastpeoplesearch.test",
          subject: "Removal request for Jane Doe",
          body: "Please remove my listing.",
        },
      },
    });

    const workflow = createAgentWorkflow({
      nodes: createPromptBackedNodes(adapter),
    });

    const result = workflow.run({
      context: {
        run_id: "run_prompt_invalid_001",
        policy: {
          match_confidence_threshold: 0.75,
          max_submission_retries: 1,
          require_explicit_consent: true,
          minimize_pii: true,
          require_retrieval_grounding: true,
        },
        review_reasons: [],
        events: [],
      },
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
      site_input: {
        site: "FastPeopleSearch",
        page_text: "fixture page text",
        page_url: "https://example.com/listing/jane-doe",
        retrieved_chunks: [{ doc_id: "fps-1", quote: "Email privacy@fastpeoplesearch.test for removal requests." }],
      },
    });

    await expect(result).rejects.toBeInstanceOf(WorkflowNodeExecutionError);
    await expect(result).rejects.toMatchObject({
      cause: expect.objectContaining({
        name: "StructuredLlmOutputValidationError",
        promptName: "draft_generator",
      }),
    });
  });
});
