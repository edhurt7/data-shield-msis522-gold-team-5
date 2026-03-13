import { describe, expect, it } from "vitest";

import {
  createAgentWorkflow,
  createFixtureLlmAdapter,
  createOpenAiCompatibleStructuredLlmAdapter,
  createPromptBackedNodes,
} from "@/lib/agent";
import { procedureSelectorPrompt } from "@/lib/agent/prompts";

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
        procedure_type: "email",
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
          confirmation: {
            ticket: null,
            page_text: "Request received",
            screenshot_ref: null,
          },
          error: null,
        },
      },
    });

    expect(result.discovery_parse.candidates[0]?.match_confidence).toBe(0.95);
    expect(result.retrieve_procedure?.procedure_type).toBe("email");
    expect(result.draft_optout?.email?.to).toBe("privacy@fastpeoplesearch.test");
    expect(result.interpret_result?.next_action).toBe("await_confirmation");
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
                  procedure_type: "email",
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
    ).resolves.toMatchObject({
      procedure_type: "email",
      source_chunks: [],
    });
  });
});
