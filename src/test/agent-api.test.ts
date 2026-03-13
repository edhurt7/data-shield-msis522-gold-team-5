import { describe, expect, it, vi } from "vitest";

import {
  agentApiPaths,
  sendChatCommandRequestSchema,
  startAgentRunRequestSchema,
  startAgentRunResponseSchema,
} from "@/lib/agent/api";
import { AgentApiError, createAgentApiClient } from "@/lib/agent/client";
import { mockAgentRunState } from "@/lib/agent/mock-run";

describe("agent api transport schemas", () => {
  it("accepts a spec-aligned start-run payload with seed profile input", () => {
    const payload = startAgentRunRequestSchema.safeParse({
      seed_profile: {
        full_name: "Jane Doe",
        name_variants: ["J. Doe"],
        location: {
          city: "Seattle",
          state: "Washington",
        },
        approx_age: "35",
        privacy_email: "shield-abc123@detraceme.io",
        optional: {
          phone_last4: null,
          prior_cities: ["Tacoma"],
        },
        consent: true,
      },
      request_text: "Search for my name + Seattle and submit removals for everything you find.",
      requested_sites: ["fastpeoplesearch"],
    });

    expect(payload.success).toBe(true);
  });

  it("accepts a start-run response payload", () => {
    const payload = startAgentRunResponseSchema.safeParse({ run: mockAgentRunState, events: [] });

    expect(payload.success).toBe(true);
  });

  it("rejects empty chat commands", () => {
    const payload = sendChatCommandRequestSchema.safeParse({ message: "" });

    expect(payload.success).toBe(false);
  });
});

describe("agent api client", () => {
  it("posts validated payloads to the expected endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ run: mockAgentRunState, events: [] })),
    });

    const client = createAgentApiClient({ baseUrl: "https://example.test", fetchFn: fetchFn as typeof fetch });
    const response = await client.startRun({
      seed_profile: {
        full_name: "Jane Doe",
        name_variants: ["J. Doe"],
        location: {
          city: "Seattle",
          state: "Washington",
        },
        approx_age: "35",
        privacy_email: "shield-abc123@detraceme.io",
        optional: {
          phone_last4: null,
          prior_cities: ["Tacoma"],
        },
        consent: true,
      },
      request_text: "Search for my name + Seattle and submit removals for everything you find.",
      requested_sites: ["fastpeoplesearch"],
    });

    expect(fetchFn).toHaveBeenCalledWith(
      `https://example.test${agentApiPaths.startRun}`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(response.run.runId).toBe(mockAgentRunState.runId);
  });

  it("throws a typed error for non-2xx responses", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      text: () => Promise.resolve(JSON.stringify({ code: "conflict", message: "Run already exists." })),
    });

    const client = createAgentApiClient({ fetchFn: fetchFn as typeof fetch });

    await expect(client.getRun("run_missing")).rejects.toBeInstanceOf(AgentApiError);
  });

  it("throws a clear error when the backend base URL is missing", async () => {
    const fetchFn = vi.fn();
    const client = createAgentApiClient({ baseUrl: "", fetchFn: fetchFn as typeof fetch });

    await expect(client.getRun("run_missing")).rejects.toMatchObject({
      name: "AgentApiError",
      status: 0,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
