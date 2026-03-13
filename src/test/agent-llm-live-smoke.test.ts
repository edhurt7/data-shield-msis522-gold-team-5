import { describe, expect, it } from "vitest";

import {
  createAgentWorkflow,
  createPromptBackedNodes,
  createStructuredLlmAdapterFromEnv,
  resolveAgentLlmConfig,
} from "@/lib/agent";
import { procedureSelectorPrompt } from "@/lib/agent/prompts";

function readFlag(name: string) {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function canResolveLiveLlmConfig() {
  try {
    resolveAgentLlmConfig(process.env);
    return true;
  } catch {
    return false;
  }
}

const livePromptSmokeEnabled = readFlag("AGENT_LLM_SMOKE_TESTS") && canResolveLiveLlmConfig();
const liveWorkflowSmokeEnabled = livePromptSmokeEnabled && readFlag("AGENT_LLM_WORKFLOW_SMOKE");

const livePromptIt = livePromptSmokeEnabled ? it : it.skip;
const liveWorkflowIt = liveWorkflowSmokeEnabled ? it : it.skip;

describe("live structured llm smoke", () => {
  livePromptIt("returns a schema-valid procedure selection from the configured live model", async () => {
    const adapter = createStructuredLlmAdapterFromEnv({
      env: process.env,
    });

    const result = await adapter.generateStructured({
      prompt: procedureSelectorPrompt,
      input: {
        seed_profile: {
          full_name: "Jane Doe",
          name_variants: ["J. Doe"],
          location: { city: "Seattle", state: "Washington" },
          approx_age: "35",
          privacy_email: "shield-abc123@detraceme.io",
          optional: { phone_last4: "0114", prior_cities: ["Tacoma"] },
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
                addresses: ["123 Pine St, Seattle, WA"],
                relatives: ["John Doe"],
                phones: ["206-555-0114"],
              },
              match_confidence: 0.95,
              evidence_snippets: ["Jane Doe, Seattle, WA"],
            },
          ],
          notes: "Smoke-test fixture input for procedure selection.",
        },
        retrieved_chunks: [
          {
            doc_id: "fps-live-smoke-1",
            quote: "Use the FastPeopleSearch removal webform and provide full name plus privacy email.",
          },
          {
            doc_id: "fps-live-smoke-2",
            quote: "If the site requires email instead, send the removal request from the privacy email address.",
          },
        ],
      },
    });

    expect(result.site).toBe("FastPeopleSearch");
    expect(["email", "webform", "procedure_unknown"]).toContain(result.procedure_type);
    expect(Array.isArray(result.required_fields)).toBe(true);
    expect(Array.isArray(result.steps)).toBe(true);
  }, 15_000);

  liveWorkflowIt("runs the prompt-backed workflow end to end against the configured live model", async () => {
    const workflow = createAgentWorkflow({
      nodes: createPromptBackedNodes(createStructuredLlmAdapterFromEnv({
        env: process.env,
      })),
    });

    const result = await workflow.run({
      context: {
        run_id: "run_live_llm_smoke_workflow_001",
        review_reasons: [],
        events: [],
      },
      seed_profile: {
        full_name: "Jane Doe",
        name_variants: ["Jane A Doe", "J. Doe"],
        location: { city: "Seattle", state: "Washington" },
        approx_age: "35",
        privacy_email: "shield-abc123@detraceme.io",
        optional: { phone_last4: "0114", prior_cities: ["Tacoma"] },
        consent: true,
      },
      request_text: "Search for my name + Seattle and prepare removal submissions for safe matches.",
      site_input: {
        site: "FastPeopleSearch",
        page_artifact: {
          visible_text: [
            "Jane Doe, age 35, Seattle, Washington.",
            "123 Pine St, Seattle, WA 98101.",
            "Phone 206-555-0114.",
            "Relatives: John Doe.",
          ].join(" "),
          url: "https://example.com/listing/jane-doe",
          screenshot_ref: null,
          extracted_metadata: {
            title: "Jane Doe in Seattle, WA | FastPeopleSearch",
            page_category: "listing_detail",
          },
        },
        retrieved_chunks: [
          {
            doc_id: "fps-live-workflow-1",
            quote: "Use the FastPeopleSearch removal webform to request record suppression.",
          },
          {
            doc_id: "fps-live-workflow-2",
            quote: "Required fields: full name and privacy email. Check the consent checkbox before form submission.",
          },
        ],
        execution_result: {
          site: "FastPeopleSearch",
          candidate_url: "https://example.com/listing/jane-doe",
          status: "pending",
          manual_review_required: false,
          confirmation_text: "Your request has been received and is awaiting confirmation.",
          ticket_ids: [],
          screenshot_ref: null,
          error_text: null,
        },
      },
    });

    expect(result.discovery_parse.site).toBe("FastPeopleSearch");
    expect(result.match_decision).not.toBeNull();
    expect(result.retrieve_procedure).not.toBeNull();
    expect(result.draft_optout).not.toBeNull();
    expect(result.interpret_result).not.toBeNull();
  }, 30_000);
});
