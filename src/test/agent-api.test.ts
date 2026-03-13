import { describe, expect, it, vi } from "vitest";

import {
  agentApiPaths,
  createRunRequestSchema,
  createRunResponseSchema,
  createMonitoredTargetSetFromRunResponseSchema,
  listMonitoredTargetSetsResponseSchema,
  mapWorkflowRunOutputToAgentRunState,
  mapWorkflowRunOutputToMonitoredTargetSet,
  mapWorkflowRunOutputToWorkflowEvents,
  retrieveProceduresRequestSchema,
  retrieveProceduresResponseSchema,
  sendChatCommandRequestSchema,
  startAgentRunRequestSchema,
} from "@/lib/agent/api";
import { fastPeopleSearchFixture } from "@/lib/agent/fixtures/fastpeoplesearch";
import { AgentApiError, createAgentApiClient } from "@/lib/agent/client";
import { mockAgentRunState } from "@/lib/agent/mock-run";
import { runFixtureWorkflow } from "@/test/support/fixture-workflow";

describe("agent api transport schemas", () => {
  it("accepts a create-run payload aligned with the shared contracts", () => {
    const payload = createRunRequestSchema.safeParse({
      profile: mockAgentRunState.profile,
      intent: mockAgentRunState.intent,
    });

    expect(payload.success).toBe(true);
  });

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

  it("accepts a create-run response payload", () => {
    const payload = createRunResponseSchema.safeParse({ run: mockAgentRunState });

    expect(payload.success).toBe(true);
  });

  it("accepts a procedure-retrieval request payload", () => {
    const payload = retrieveProceduresRequestSchema.safeParse({
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
      site: "FastPeopleSearch",
    });

    expect(payload.success).toBe(true);
  });

  it("accepts a procedure-retrieval response payload", () => {
    const payload = retrieveProceduresResponseSchema.safeParse({
      site: "FastPeopleSearch",
      retrieved_at: "2026-03-12T12:00:00.000Z",
      procedures: [
        {
          procedure_id: "fps-webform-v2",
          site: "FastPeopleSearch",
          updated_at: "2026-03-10T00:00:00.000Z",
          channel_hint: "webform",
          source_chunks: [
            {
              doc_id: "fps-proc-1",
              quote: "Use the FastPeopleSearch removal webform.",
              source_id: "fps-webform-v2",
              source_updated_at: "2026-03-10T00:00:00.000Z",
              retrieved_at: "2026-03-12T12:00:00.000Z",
            },
          ],
        },
      ],
    });

    expect(payload.success).toBe(true);
  });

  it("rejects empty chat commands", () => {
    const payload = sendChatCommandRequestSchema.safeParse({ message: "" });

    expect(payload.success).toBe(false);
  });

  it("maps workflow output into the shared agent run contract", async () => {
    const workflowOutput = await runFixtureWorkflow({
      runId: "run_api_workflow_map_001",
      site: fastPeopleSearchFixture.site,
      requestText: fastPeopleSearchFixture.requestText,
      seedProfile: fastPeopleSearchFixture.seedProfile,
      listingPageText: fastPeopleSearchFixture.listingPageText,
      candidateUrl: fastPeopleSearchFixture.candidateUrl,
      executionResult: fastPeopleSearchFixture.executionResult,
    });

    const runState = mapWorkflowRunOutputToAgentRunState(workflowOutput, {
      profileId: "profile_api_workflow_map_001",
      requestText: fastPeopleSearchFixture.requestText,
      requestedSites: [fastPeopleSearchFixture.site],
    });

    expect(runState.runId).toBe("run_api_workflow_map_001");
    expect(runState.profile.proxyEmail).toBe(fastPeopleSearchFixture.seedProfile.privacy_email);
    expect(runState.matchDecisions[0]?.siteId).toBe("fastpeoplesearch");
    expect(runState.procedures[0]?.submissionChannel).toBe("webform");
    expect(runState.drafts[0]?.submissionChannel).toBe("webform");
    expect(runState.outcomes[0]?.status).toBe("needs_follow_up");
    expect(runState.timeline[0]?.siteId).toBe("fastpeoplesearch");
  });

  it("emits workflow events that validate against the shared event schema", async () => {
    const workflowOutput = await runFixtureWorkflow({
      runId: "run_api_workflow_events_001",
      site: fastPeopleSearchFixture.site,
      requestText: fastPeopleSearchFixture.requestText,
      seedProfile: fastPeopleSearchFixture.seedProfile,
      listingPageText: fastPeopleSearchFixture.listingPageText,
      candidateUrl: fastPeopleSearchFixture.candidateUrl,
    });

    const events = mapWorkflowRunOutputToWorkflowEvents(workflowOutput);

    expect(events).toHaveLength(1);
    expect(events[0]?.runId).toBe("run_api_workflow_events_001");
    expect(events[0]?.phase).toBe("approval");
  });

  it("maps completed workflow outcomes into a monitored target set contract", async () => {
    const workflowOutput = await runFixtureWorkflow({
      runId: "run_api_monitoring_map_001",
      site: fastPeopleSearchFixture.site,
      requestText: fastPeopleSearchFixture.requestText,
      seedProfile: fastPeopleSearchFixture.seedProfile,
      listingPageText: fastPeopleSearchFixture.listingPageText,
      candidateUrl: fastPeopleSearchFixture.candidateUrl,
      executionResult: fastPeopleSearchFixture.executionResult,
    });

    const targetSet = mapWorkflowRunOutputToMonitoredTargetSet(workflowOutput, {
      profileId: "profile_api_monitoring_001",
    });

    expect(targetSet).toMatchObject({
      targetSetId: "mts_run_api_monitoring_map_001",
      sourceRunId: "run_api_monitoring_map_001",
      profileId: "profile_api_monitoring_001",
      status: "needs_attention",
      targetCount: 1,
      needsAttentionCount: 1,
      storageBacked: false,
    });
    expect(targetSet.targets[0]).toMatchObject({
      siteId: "fastpeoplesearch",
      monitoringStatus: "awaiting_confirmation",
      triggerNewRemovalCycle: false,
    });
  });
});

describe("agent api client", () => {
  it("posts validated payloads to the expected endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ run: mockAgentRunState })),
    });

    const client = createAgentApiClient({ baseUrl: "https://example.test", fetchFn: fetchFn as typeof fetch });
    const response = await client.createRun({
      profile: mockAgentRunState.profile,
      intent: mockAgentRunState.intent,
    });

    expect(fetchFn).toHaveBeenCalledWith(
      `https://example.test${agentApiPaths.runs}`,
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

  it("posts procedure retrieval requests to the retrieval endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        site: "FastPeopleSearch",
        retrieved_at: "2026-03-12T12:00:00.000Z",
        procedures: [],
      })),
    });

    const client = createAgentApiClient({ baseUrl: "https://example.test", fetchFn: fetchFn as typeof fetch });
    await client.retrieveProcedures({
      seed_profile: {
        full_name: "Jane Doe",
        name_variants: [],
        location: {
          city: "Seattle",
          state: "Washington",
        },
        approx_age: null,
        privacy_email: "shield-abc123@detraceme.io",
        optional: {
          phone_last4: null,
          prior_cities: [],
        },
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
              age: null,
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
      site: "FastPeopleSearch",
    });

    expect(fetchFn).toHaveBeenCalledWith(
      `https://example.test${agentApiPaths.retrieveProcedures}`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("creates a monitored target set from a run through the dedicated endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(createMonitoredTargetSetFromRunResponseSchema.parse({
        targetSet: {
          targetSetId: "mts_run_001",
          sourceRunId: "run_001",
          profileId: "profile_001",
          profileName: "Jane Doe",
          status: "active",
          monitoringPolicy: {
            cadenceDays: 30,
            reReviewCooldownDays: 30,
            reReviewListingReappearanceThreshold: 1,
          },
          targetCount: 1,
          activeTargetCount: 1,
          needsAttentionCount: 0,
          targets: [],
          materializedFromRunAt: "2026-03-13T00:00:00.000Z",
          createdAt: "2026-03-13T00:00:00.000Z",
          updatedAt: "2026-03-13T00:00:00.000Z",
          storageBacked: false,
        },
      }))),
    });

    const client = createAgentApiClient({ baseUrl: "https://example.test", fetchFn: fetchFn as typeof fetch });
    const response = await client.createMonitoredTargetSetFromRun("run_001", {
      profileId: "profile_001",
    });

    expect(fetchFn).toHaveBeenCalledWith(
      `https://example.test${agentApiPaths.runMonitoredTargetSet("run_001")}`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(response.targetSet.sourceRunId).toBe("run_001");
  });

  it("lists monitored target sets from the monitoring endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(listMonitoredTargetSetsResponseSchema.parse({
        targetSets: [
          {
            targetSetId: "mts_run_001",
            sourceRunId: "run_001",
            profileId: "profile_001",
            profileName: "Jane Doe",
            status: "active",
            monitoringPolicy: {
              cadenceDays: 30,
              reReviewCooldownDays: 30,
              reReviewListingReappearanceThreshold: 1,
            },
            targetCount: 1,
            activeTargetCount: 1,
            needsAttentionCount: 0,
            targets: [],
            materializedFromRunAt: "2026-03-13T00:00:00.000Z",
            createdAt: "2026-03-13T00:00:00.000Z",
            updatedAt: "2026-03-13T00:00:00.000Z",
            storageBacked: false,
          },
        ],
      }))),
    });

    const client = createAgentApiClient({ baseUrl: "https://example.test", fetchFn: fetchFn as typeof fetch });
    const response = await client.listMonitoredTargetSets();

    expect(fetchFn).toHaveBeenCalledWith(
      `https://example.test${agentApiPaths.monitoredTargetSets}`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(response.targetSets).toHaveLength(1);
  });
});
