import { describe, expect, it } from "vitest";

import {
  actionHandoffSchema,
  agentRunStateSchema,
  canTransitionPhase,
  defaultAgentPolicy,
  discoveryResultSchema,
  executionResultSchema,
  pageContentArtifactSchema,
  phaseTransitions,
  procedureSourceChunkSchema,
  procedureRetrievalSchema,
  procedureSelectionSchema,
  resolveAgentPolicy,
  seedProfileSchema,
  submissionPayloadSchema,
} from "@/lib/agent";

describe("agent contracts", () => {
  it("accepts the exact seed profile shape from the project spec", () => {
    const result = seedProfileSchema.safeParse({
      full_name: "Jane Doe",
      name_variants: ["Jane A. Doe", "J. Doe"],
      location: {
        city: "Seattle",
        state: "Washington",
      },
      approx_age: "35",
      privacy_email: "shield-abc123@detraceme.io",
      optional: {
        phone_last4: "0114",
        prior_cities: ["Tacoma"],
      },
      consent: true,
    });

    expect(result.success).toBe(true);
  });

  it("accepts a spec-aligned discovery result with audit evidence", () => {
    const result = discoveryResultSchema.safeParse({
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
          evidence_snippets: ["Jane Doe, age 35, Seattle, WA"],
        },
      ],
      notes: null,
    });

    expect(result.success).toBe(true);
  });

  it("accepts known procedures without source chunks so workflow policy can gate grounding", () => {
    const result = procedureRetrievalSchema.safeParse({
      site: "FastPeopleSearch",
      procedure_type: "email",
      required_fields: ["full_name", "privacy_email"],
      steps: ["Send removal request to privacy@site.test"],
      source_chunks: [],
    });

    expect(result.success).toBe(true);
  });

  it("resolves the production default policy when no override is provided", () => {
    expect(resolveAgentPolicy()).toEqual(defaultAgentPolicy);
  });

  it("applies per-run policy overrides without mutating the shared defaults", () => {
    const resolved = resolveAgentPolicy({
      match_confidence_threshold: 0.6,
      monitoring_cadence_days: 14,
      re_review_cooldown_days: 7,
      minimize_pii: false,
      low_confidence_match_strategy: "allow_with_review",
    });

    expect(resolved).toMatchObject({
      match_confidence_threshold: 0.6,
      monitoring_cadence_days: 14,
      re_review_cooldown_days: 7,
      minimize_pii: false,
      low_confidence_match_strategy: "allow_with_review",
    });
    expect(defaultAgentPolicy).toMatchObject({
      match_confidence_threshold: 0.75,
      monitoring_cadence_days: 30,
      re_review_cooldown_days: 30,
      re_review_listing_reappearance_threshold: 1,
      minimize_pii: true,
      low_confidence_match_strategy: "block",
    });
  });

  it("accepts monitoring cadence and re-review threshold policy fields", () => {
    const resolved = resolveAgentPolicy({
      monitoring_cadence_days: 21,
      re_review_cooldown_days: 10,
      re_review_listing_reappearance_threshold: 2,
    });

    expect(resolved).toMatchObject({
      monitoring_cadence_days: 21,
      re_review_cooldown_days: 10,
      re_review_listing_reappearance_threshold: 2,
    });
  });

  it("enforces email and webform payload requirements", () => {
    expect(
      submissionPayloadSchema.safeParse({
        site: "FastPeopleSearch",
        candidate_url: "https://example.com/listing/jane-doe",
        submission_channel: "email",
        procedure_type: "email",
        required_fields: [
          { name: "full_name", value: "Jane Doe", required: true },
        ],
        email: {
          to: "privacy@example.com",
          subject: "Removal Request",
          body: "Please remove my listing.",
        },
      }).success,
    ).toBe(true);

    expect(
      submissionPayloadSchema.safeParse({
        site: "FastPeopleSearch",
        candidate_url: "https://example.com/listing/jane-doe",
        submission_channel: "webform",
        procedure_type: "webform",
        required_fields: [
          { name: "full_name", value: "Jane Doe", required: true },
        ],
      }).success,
    ).toBe(false);

    expect(
      submissionPayloadSchema.safeParse({
        site: "FastPeopleSearch",
        candidate_url: "https://example.com/listing/jane-doe",
        submission_channel: "webform",
        procedure_type: "webform",
        required_fields: [
          { name: "full_name", value: "Jane Doe", required: true },
        ],
        email: {
          to: "privacy@example.com",
          subject: "Removal Request",
          body: "Please remove my listing.",
        },
        webform: {
          fields: [{ name: "full_name", value: "Jane Doe" }],
          consent_checkboxes: [],
        },
      }).success,
    ).toBe(false);
  });

  it("accepts the execution result shape from automation", () => {
    const result = executionResultSchema.safeParse({
      site: "FastPeopleSearch",
      candidate_url: "https://example.com/listing/jane-doe",
      status: "pending",
      manual_review_required: false,
      confirmation_text: "Your request has been received.",
      ticket_ids: [],
      screenshot_ref: "s3://bucket/confirm.png",
      error_text: null,
    });

    expect(result.success).toBe(true);
  });

  it("normalizes procedure chunks with source identity and freshness metadata", () => {
    const result = procedureSourceChunkSchema.parse({
      doc_id: "fps-1",
      quote: "Use the removal form.",
    });

    expect(result).toEqual({
      doc_id: "fps-1",
      quote: "Use the removal form.",
      source_id: "fps-1",
      source_updated_at: null,
      retrieved_at: null,
    });
  });

  it("accepts the Playwright page-content artifact contract for discovery", () => {
    const result = pageContentArtifactSchema.safeParse({
      visible_text: "Jane Doe, age 35, Seattle, WA",
      url: "https://example.com/listing/jane-doe",
      screenshot_ref: "artifacts/jane-doe.png",
      extracted_metadata: {
        title: "Jane Doe in Seattle, WA",
        canonical_url: "https://example.com/listing/jane-doe",
        page_category: "listing_detail",
        captured_at: "2026-03-13T12:00:00.000Z",
        headings: ["Jane Doe", "Seattle, WA"],
      },
    });

    expect(result.success).toBe(true);
  });

  it("requires manual review reasons on executable payloads when automation should not proceed blindly", () => {
    const result = submissionPayloadSchema.safeParse({
      site: "FastPeopleSearch",
      candidate_url: "https://example.com/listing/jane-doe",
      submission_channel: "webform",
      procedure_type: "webform",
      required_fields: [
        { name: "full_name", value: "Jane Doe", required: true },
      ],
      manual_review_required: true,
      review_reasons: [],
      webform: {
        fields: [{ name: "full_name", value: "Jane Doe" }],
        consent_checkboxes: [],
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts a representative agent run state", () => {
    const result = agentRunStateSchema.safeParse({
      runId: "run_001",
      profile: {
        profileId: "profile_001",
        firstName: "Jane",
        lastName: "Doe",
        city: "Seattle",
        state: "Washington",
        proxyEmail: "shield-abc123@detraceme.io",
      },
      intent: {
        requestText: "Search for my name + Seattle and submit removals for everything you find.",
        requestedActions: ["scan_only", "submit_opt_out"],
        geographicHint: "Seattle",
        requestedSites: ["spokeo", "fastpeoplesearch"],
        requiresUserApprovalBeforeSubmission: true,
      },
      currentPhase: "approval",
      status: "awaiting_user",
      consentConfirmed: true,
      targets: [
        {
          siteId: "spokeo",
          siteName: "Spokeo",
          query: "Jane Doe Seattle WA",
        },
      ],
      candidates: [
        {
          candidateId: "cand_001",
          siteId: "spokeo",
          siteName: "Spokeo",
          listingUrl: "https://example.com/listing/jane-doe",
          displayName: "Jane Doe",
          extractedFields: [
            { field: "full_name", value: "Jane Doe" },
            { field: "city", value: "Seattle" },
          ],
          evidence: [
            {
              sourceType: "listing_page",
              sourceUrl: "https://example.com/listing/jane-doe",
              excerpt: "Jane Doe, Seattle, WA",
              capturedAt: "2026-03-12T12:00:00.000Z",
              fields: [{ field: "city", value: "Seattle" }],
            },
          ],
        },
      ],
      matchDecisions: [
        {
          siteId: "spokeo",
          candidateId: "cand_001",
          decision: "likely_match",
          confidence: 0.93,
          rationale: "Name and city match the user's profile.",
          evidence: [
            {
              sourceType: "listing_page",
              excerpt: "Jane Doe, Seattle, WA",
              capturedAt: "2026-03-12T12:00:00.000Z",
              fields: [{ field: "city", value: "Seattle" }],
            },
          ],
        },
      ],
      procedures: [
        {
          siteId: "spokeo",
          procedureId: "proc_spokeo_v3",
          source: "rag",
          sourceDocumentUri: "sites/spokeo/procedure-v3.md",
          sourceVersion: "v3",
          retrievedAt: "2026-03-12T12:01:00.000Z",
          submissionChannel: "webform",
          freshnessDays: 5,
          isComplete: true,
          requiredInputs: [
            {
              key: "full_name",
              label: "Full name",
              required: true,
              source: "profile",
            },
            {
              key: "proxy_email",
              label: "Proxy email",
              required: true,
              source: "system",
            },
          ],
          steps: [
            {
              stepId: "step_1",
              action: "navigate",
              instruction: "Open the site opt-out page.",
              targetUrl: "https://example.com/opt-out",
            },
            {
              stepId: "step_2",
              action: "fill",
              instruction: "Provide the requester's full name.",
              inputKey: "full_name",
            },
          ],
        },
      ],
      drafts: [
        {
          draftId: "draft_001",
          siteId: "spokeo",
          candidateId: "cand_001",
          submissionChannel: "webform",
          body: "Please remove my personal information from your site.",
          factsUsed: [
            { field: "full_name", value: "Jane Doe" },
            { field: "city", value: "Seattle" },
          ],
          procedureId: "proc_spokeo_v3",
          generatedAt: "2026-03-12T12:02:00.000Z",
        },
      ],
      handoffs: [
        {
          handoffId: "handoff_001",
          mode: "human_assisted",
          requiresUserApproval: true,
          reviewReasons: ["manual_submission_required"],
          createdAt: "2026-03-12T12:03:00.000Z",
          payload: {
            siteId: "spokeo",
            candidateId: "cand_001",
            procedureId: "proc_spokeo_v3",
            procedureVersion: "v3",
            submissionChannel: "webform",
            fields: {
              full_name: "Jane Doe",
              proxy_email: "shield-abc123@detraceme.io",
            },
            steps: [
              {
                stepId: "step_1",
                action: "navigate",
                instruction: "Open the site opt-out page.",
                targetUrl: "https://example.com/opt-out",
              },
            ],
            draft: {
              draftId: "draft_001",
              siteId: "spokeo",
              candidateId: "cand_001",
              submissionChannel: "webform",
              body: "Please remove my personal information from your site.",
              factsUsed: [{ field: "full_name", value: "Jane Doe" }],
              procedureId: "proc_spokeo_v3",
              generatedAt: "2026-03-12T12:02:00.000Z",
            },
          },
        },
      ],
      outcomes: [],
      pendingReviewReasons: ["manual_submission_required"],
      timeline: [
        {
          eventId: "evt_001",
          runId: "run_001",
          phase: "scan",
          status: "in_progress",
          message: "Scanning started for Spokeo.",
          createdAt: "2026-03-12T12:00:30.000Z",
          siteId: "spokeo",
        },
      ],
      createdAt: "2026-03-12T12:00:00.000Z",
      updatedAt: "2026-03-12T12:03:00.000Z",
    });

    expect(result.success).toBe(true);
  });

  it("rejects impossible confidence scores", () => {
    const result = agentRunStateSchema.safeParse({
      runId: "run_invalid",
      profile: {
        profileId: "profile_invalid",
        firstName: "Jane",
        lastName: "Doe",
      },
      intent: {
        requestText: "scan",
        requestedActions: ["scan_only"],
      },
      currentPhase: "match",
      status: "in_progress",
      consentConfirmed: true,
      matchDecisions: [
        {
          siteId: "spokeo",
          candidateId: "cand_invalid",
          decision: "likely_match",
          confidence: 1.5,
          rationale: "Invalid score",
          evidence: [
            {
              sourceType: "listing_page",
              excerpt: "Jane Doe",
              capturedAt: "2026-03-12T12:00:00.000Z",
            },
          ],
        },
      ],
      createdAt: "2026-03-12T12:00:00.000Z",
      updatedAt: "2026-03-12T12:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });

  it("requires review reasons for incomplete procedures", () => {
    const result = procedureSelectionSchema.safeParse({
      siteId: "spokeo",
      procedureId: "proc_spokeo_v4",
      source: "rag",
      sourceDocumentUri: "sites/spokeo/procedure-v4.md",
      sourceVersion: "v4",
      retrievedAt: "2026-03-12T12:01:00.000Z",
      submissionChannel: "webform",
      freshnessDays: 45,
      isComplete: false,
      requiredInputs: [],
      steps: [
        {
          stepId: "step_1",
          action: "manual_review",
          instruction: "Procedure is missing required confirmation details.",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("requires review reasons for non-auto handoffs", () => {
    const result = actionHandoffSchema.safeParse({
      handoffId: "handoff_invalid",
      mode: "blocked",
      requiresUserApproval: true,
      createdAt: "2026-03-12T12:03:00.000Z",
      payload: {
        siteId: "spokeo",
        candidateId: "cand_001",
        procedureId: "proc_spokeo_v3",
        procedureVersion: "v3",
        submissionChannel: "webform",
        fields: {
          full_name: "Jane Doe",
        },
        steps: [
          {
            stepId: "step_1",
            action: "navigate",
            instruction: "Open the site opt-out page.",
            targetUrl: "https://example.com/opt-out",
          },
        ],
        draft: {
          draftId: "draft_001",
          siteId: "spokeo",
          candidateId: "cand_001",
          submissionChannel: "webform",
          body: "Please remove my personal information from your site.",
          factsUsed: [{ field: "full_name", value: "Jane Doe" }],
          procedureId: "proc_spokeo_v3",
          generatedAt: "2026-03-12T12:02:00.000Z",
        },
      },
    });

    expect(result.success).toBe(false);
  });
});

describe("agent state machine", () => {
  it("allows the core workflow transitions", () => {
    expect(canTransitionPhase("intake", "scan")).toBe(true);
    expect(canTransitionPhase("scan", "match")).toBe(true);
    expect(canTransitionPhase("logging", "completed")).toBe(true);
    expect(canTransitionPhase("draft", "scan")).toBe(false);
  });

  it("defines transitions for each operational phase", () => {
    expect(phaseTransitions.length).toBeGreaterThan(0);
    expect(
      phaseTransitions.some((transition) => transition.from === "execution" && transition.to === "verification"),
    ).toBe(true);
  });
});
