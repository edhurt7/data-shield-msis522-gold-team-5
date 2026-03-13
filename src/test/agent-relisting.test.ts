import { describe, expect, it } from "vitest";

import { defaultAgentPolicy } from "@/lib/agent/contracts";
import { mapWorkflowRunOutputToMonitoredTargetSet } from "@/lib/agent/api";
import { compareMonitoredTargetSetToWorkflowRun, planRelistingTriggeredRemovalCycles } from "@/lib/agent/relisting";
import { workflowRunOutputSchema } from "@/lib/agent/workflow";

const seedProfile = {
  full_name: "Jane Doe",
  name_variants: ["J. Doe"],
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
  consent: true as const,
};

function buildWorkflowOutput(input: {
  runId: string;
  candidateUrl: string;
  pageUrl?: string;
  found: boolean;
  monitoring: {
    status: "scheduled" | "awaiting_confirmation" | "rescan_due" | "manual_review" | "not_applicable";
    reason: "none" | "cadence" | "pending_confirmation" | "listing_reappeared" | "review_blocked";
    reappearanceCount: number;
    triggerNewRemovalCycle: boolean;
  };
  terminalPath: "completed" | "await_confirmation" | "manual_review" | "no_match";
  executionStatus?: "submitted" | "pending";
  threshold?: number;
}) {
  const siteRun = {
    site_input: {
      site: "FastPeopleSearch",
      page_artifact: {
        visible_text: input.found
          ? "Jane Doe, age 35, Seattle, Washington. Phone 206-555-0114."
          : "Directory landing page. No matching person listing is available in this captured page text.",
        url: input.pageUrl ?? input.candidateUrl,
        screenshot_ref: null,
      },
      retrieved_chunks: [],
      execution_result: input.executionStatus
        ? {
          site: "FastPeopleSearch",
          candidate_url: input.candidateUrl,
          status: input.executionStatus,
          manual_review_required: false,
          confirmation_text: input.executionStatus === "submitted"
            ? "Your request has been submitted successfully."
            : "Your request has been received.",
          ticket_ids: [],
          screenshot_ref: null,
          error_text: null,
        }
        : undefined,
      retry_count: 0,
    },
    context: {
      run_id: input.runId,
      policy_defaults: defaultAgentPolicy,
      policy_overrides: {
        re_review_listing_reappearance_threshold: input.threshold ?? 1,
      },
      policy: {
        ...defaultAgentPolicy,
        re_review_listing_reappearance_threshold: input.threshold ?? 1,
      },
      review_reasons: [],
      events: [],
    },
    validate_consent: {
      seed_profile: seedProfile,
      normalized_query: "Jane Doe Seattle Washington",
      approved_for_submission: true,
    },
    discovery_parse: {
      site: "FastPeopleSearch",
      scan_timestamp: "2026-03-13T00:00:00.000Z",
      found: input.found,
      candidates: input.found
        ? [
          {
            url: input.candidateUrl,
            extracted: {
              name: "Jane Doe",
              age: "35",
              addresses: ["123 Pine St, Seattle, WA"],
              relatives: ["John Doe"],
              phones: ["206-555-0114"],
            },
            match_confidence: 0.95,
            evidence_snippets: ["Jane Doe, age 35, Seattle, Washington."],
          },
        ]
        : [],
      notes: input.found ? null : "No likely match found in the captured page text.",
    },
    match_decision: input.found
      ? {
        siteId: "fastpeoplesearch",
        candidateId: input.candidateUrl,
        decision: "exact_match",
        confidence: 0.95,
        rationale: "Exact profile match from saved fixture evidence.",
        evidence: [
          {
            sourceType: "listing_page",
            sourceUrl: input.candidateUrl,
            excerpt: "Jane Doe, age 35, Seattle, Washington.",
            capturedAt: "2026-03-13T00:00:00.000Z",
            fields: [],
          },
        ],
        reviewReasons: [],
      }
      : {
        siteId: "fastpeoplesearch",
        candidateId: input.pageUrl ?? input.candidateUrl,
        decision: "no_match",
        confidence: 0,
        rationale: "No matching profile remains visible.",
        evidence: [
          {
            sourceType: "listing_page",
            sourceUrl: input.pageUrl ?? input.candidateUrl,
            excerpt: "No likely match found in the captured page text.",
            capturedAt: "2026-03-13T00:00:00.000Z",
            fields: [],
          },
        ],
        reviewReasons: [],
      },
    retrieve_procedure: null,
    draft_optout: null,
    plan_submission: null,
    interpret_result: input.executionStatus
      ? {
        next_status: input.executionStatus,
        next_action: input.executionStatus === "submitted" ? "none" : "await_confirmation",
        review_reasons: [],
      }
      : null,
    automation_record: null,
    monitoring: {
      status: input.monitoring.status,
      reason: input.monitoring.reason,
      last_scan_at: "2026-03-13T00:00:00.000Z",
      next_scan_at: "2026-04-12T00:00:00.000Z",
      cooldown_ends_at: "2026-04-12T00:00:00.000Z",
      reappearance_count: input.monitoring.reappearanceCount,
      trigger_new_removal_cycle: input.monitoring.triggerNewRemovalCycle,
      backend_required: true,
      notes: "Local relisting fixture state.",
    },
    prompt_trace: {
      discovery_parse: null,
      retrieve_procedure: null,
      draft_optout: null,
      interpret_result: null,
    },
    terminal_path: input.terminalPath,
    checkpoint: null,
  };

  return workflowRunOutputSchema.parse({
    ...siteRun,
    site_runs: [siteRun],
    run_summary: {
      overall_status: "completed",
      partial_success: false,
      requested_sites: ["FastPeopleSearch"],
      processed_sites: ["FastPeopleSearch"],
      total_requested_sites: 1,
      total_processed_sites: 1,
      completed_sites: 1,
      pending_sites: 0,
      successful_sites: 1,
      blocked_sites: 0,
      manual_review_sites: 0,
      matched_sites: input.found ? 1 : 0,
      no_match_sites: input.found ? 0 : 1,
      total_retry_count: 0,
      monitoring: {
        scheduled_sites: input.monitoring.status === "scheduled" ? 1 : 0,
        awaiting_confirmation_sites: input.monitoring.status === "awaiting_confirmation" ? 1 : 0,
        due_sites: input.monitoring.status === "rescan_due" ? 1 : 0,
        manual_review_sites: input.monitoring.status === "manual_review" ? 1 : 0,
        new_removal_cycle_sites: input.monitoring.triggerNewRemovalCycle ? 1 : 0,
      },
      sites_by_terminal_path: {
        [input.terminalPath]: 1,
      },
      site_outcomes: [
        {
          site: "FastPeopleSearch",
          terminal_path: input.terminalPath,
          retry_count: 0,
          review_blocked: false,
          successful: true,
          pending: false,
        },
      ],
    },
    orchestration_checkpoint: null,
  });
}

describe("relisting comparison", () => {
  it("detects relisting by exact candidate url against a monitored target set", () => {
    const priorRun = buildWorkflowOutput({
      runId: "run_relisting_prior_exact_001",
      candidateUrl: "https://fastpeoplesearch.test/listing/jane-doe-seattle-wa",
      found: true,
      monitoring: {
        status: "scheduled",
        reason: "cadence",
        reappearanceCount: 1,
        triggerNewRemovalCycle: false,
      },
      terminalPath: "completed",
      executionStatus: "submitted",
      threshold: 2,
    });
    const targetSet = mapWorkflowRunOutputToMonitoredTargetSet(priorRun, {
      profileId: "profile_relisting_exact_001",
    });
    const rescanRun = buildWorkflowOutput({
      runId: "run_relisting_compare_exact_001",
      candidateUrl: "https://fastpeoplesearch.test/listing/jane-doe-seattle-wa",
      found: true,
      monitoring: {
        status: "scheduled",
        reason: "cadence",
        reappearanceCount: 0,
        triggerNewRemovalCycle: false,
      },
      terminalPath: "completed",
      threshold: 2,
    });

    const report = compareMonitoredTargetSetToWorkflowRun(targetSet, rescanRun);

    expect(report.matchedSites).toEqual(["FastPeopleSearch"]);
    expect(report.detections[0]).toMatchObject({
      reason: "exact_candidate_url",
      confidence: 1,
      previousReappearanceCount: 1,
      newReappearanceCount: 2,
      thresholdMet: true,
      shouldTriggerRemovalCycle: true,
    });
  });

  it("detects relisting heuristically when the listing url changes but the fingerprint is the same", () => {
    const priorRun = buildWorkflowOutput({
      runId: "run_relisting_prior_fingerprint_001",
      candidateUrl: "https://fastpeoplesearch.test/listing/jane-doe-seattle-wa",
      found: true,
      monitoring: {
        status: "scheduled",
        reason: "cadence",
        reappearanceCount: 1,
        triggerNewRemovalCycle: false,
      },
      terminalPath: "completed",
      executionStatus: "submitted",
      threshold: 2,
    });
    const targetSet = mapWorkflowRunOutputToMonitoredTargetSet(priorRun, {
      profileId: "profile_relisting_fingerprint_001",
    });
    const rescanRun = buildWorkflowOutput({
      runId: "run_relisting_compare_fingerprint_001",
      candidateUrl: "https://fastpeoplesearch.test/listing/jane-doe-seattle-wa-2",
      found: true,
      monitoring: {
        status: "scheduled",
        reason: "cadence",
        reappearanceCount: 0,
        triggerNewRemovalCycle: false,
      },
      terminalPath: "completed",
      threshold: 2,
    });

    const report = compareMonitoredTargetSetToWorkflowRun(targetSet, rescanRun);

    expect(report.detections[0]).toMatchObject({
      reason: "profile_fingerprint",
      previousCandidateUrl: "https://fastpeoplesearch.test/listing/jane-doe-seattle-wa",
      currentCandidateUrl: "https://fastpeoplesearch.test/listing/jane-doe-seattle-wa-2",
      thresholdMet: true,
      shouldTriggerRemovalCycle: true,
    });
  });

  it("does not flag relisting when the fresh run has no matching discovery result", () => {
    const priorRun = buildWorkflowOutput({
      runId: "run_relisting_prior_none_001",
      candidateUrl: "https://fastpeoplesearch.test/listing/jane-doe-seattle-wa",
      found: true,
      monitoring: {
        status: "scheduled",
        reason: "cadence",
        reappearanceCount: 0,
        triggerNewRemovalCycle: false,
      },
      terminalPath: "completed",
      executionStatus: "submitted",
      threshold: 1,
    });
    const targetSet = mapWorkflowRunOutputToMonitoredTargetSet(priorRun, {
      profileId: "profile_relisting_none_001",
    });
    const rescanRun = buildWorkflowOutput({
      runId: "run_relisting_compare_none_001",
      candidateUrl: "https://fastpeoplesearch.test/search",
      pageUrl: "https://fastpeoplesearch.test/search",
      found: false,
      monitoring: {
        status: "scheduled",
        reason: "cadence",
        reappearanceCount: 0,
        triggerNewRemovalCycle: false,
      },
      terminalPath: "no_match",
      threshold: 1,
    });

    const report = compareMonitoredTargetSetToWorkflowRun(targetSet, rescanRun);

    expect(report.detections).toEqual([]);
    expect(report.matchedSites).toEqual([]);
    expect(report.unmatchedSites).toEqual(["FastPeopleSearch"]);
  });

  it("plans a new removal cycle immediately when relisting is exact and the threshold is met", () => {
    const priorRun = buildWorkflowOutput({
      runId: "run_relisting_plan_ready_001",
      candidateUrl: "https://fastpeoplesearch.test/listing/jane-doe-seattle-wa",
      found: true,
      monitoring: {
        status: "scheduled",
        reason: "cadence",
        reappearanceCount: 1,
        triggerNewRemovalCycle: false,
      },
      terminalPath: "completed",
      executionStatus: "submitted",
      threshold: 2,
    });
    const targetSet = mapWorkflowRunOutputToMonitoredTargetSet(priorRun, {
      profileId: "profile_relisting_plan_ready_001",
    });
    const rescanRun = buildWorkflowOutput({
      runId: "run_relisting_plan_ready_compare_001",
      candidateUrl: "https://fastpeoplesearch.test/listing/jane-doe-seattle-wa",
      found: true,
      monitoring: {
        status: "scheduled",
        reason: "cadence",
        reappearanceCount: 0,
        triggerNewRemovalCycle: false,
      },
      terminalPath: "completed",
      threshold: 2,
    });

    const report = compareMonitoredTargetSetToWorkflowRun(targetSet, rescanRun);
    const plan = planRelistingTriggeredRemovalCycles(targetSet, report);

    expect(plan).toMatchObject({
      readyCount: 1,
      scheduledCount: 0,
      reviewCount: 0,
    });
    expect(plan.items[0]).toMatchObject({
      action: "start_new_cycle",
      reason: "exact_candidate_url",
      triggerAt: "2026-03-13T00:00:00.000Z",
      backendRequired: true,
    });
  });

  it("schedules a later recheck when relisting is detected below the threshold", () => {
    const priorRun = buildWorkflowOutput({
      runId: "run_relisting_plan_scheduled_001",
      candidateUrl: "https://fastpeoplesearch.test/listing/jane-doe-seattle-wa",
      found: true,
      monitoring: {
        status: "scheduled",
        reason: "cadence",
        reappearanceCount: 0,
        triggerNewRemovalCycle: false,
      },
      terminalPath: "completed",
      executionStatus: "submitted",
      threshold: 3,
    });
    const targetSet = mapWorkflowRunOutputToMonitoredTargetSet(priorRun, {
      profileId: "profile_relisting_plan_scheduled_001",
    });
    const rescanRun = buildWorkflowOutput({
      runId: "run_relisting_plan_scheduled_compare_001",
      candidateUrl: "https://fastpeoplesearch.test/listing/jane-doe-seattle-wa",
      found: true,
      monitoring: {
        status: "scheduled",
        reason: "cadence",
        reappearanceCount: 0,
        triggerNewRemovalCycle: false,
      },
      terminalPath: "completed",
      threshold: 3,
    });

    const report = compareMonitoredTargetSetToWorkflowRun(targetSet, rescanRun);
    const plan = planRelistingTriggeredRemovalCycles(targetSet, report);

    expect(plan).toMatchObject({
      readyCount: 0,
      scheduledCount: 1,
      reviewCount: 0,
    });
    expect(plan.items[0]).toMatchObject({
      action: "schedule_recheck",
      triggerAt: "2026-04-12T00:00:00.000Z",
    });
  });

  it("holds relisting for review when the threshold is met but the match is heuristic only", () => {
    const priorRun = buildWorkflowOutput({
      runId: "run_relisting_plan_review_001",
      candidateUrl: "https://fastpeoplesearch.test/listing/jane-doe-seattle-wa",
      found: true,
      monitoring: {
        status: "scheduled",
        reason: "cadence",
        reappearanceCount: 1,
        triggerNewRemovalCycle: false,
      },
      terminalPath: "completed",
      executionStatus: "submitted",
      threshold: 2,
    });
    const targetSet = mapWorkflowRunOutputToMonitoredTargetSet(priorRun, {
      profileId: "profile_relisting_plan_review_001",
    });
    const rescanRun = buildWorkflowOutput({
      runId: "run_relisting_plan_review_compare_001",
      candidateUrl: "https://fastpeoplesearch.test/listing/jane-doe-seattle-wa-2",
      found: true,
      monitoring: {
        status: "scheduled",
        reason: "cadence",
        reappearanceCount: 0,
        triggerNewRemovalCycle: false,
      },
      terminalPath: "completed",
      threshold: 2,
    });

    const report = compareMonitoredTargetSetToWorkflowRun(targetSet, rescanRun);
    const plan = planRelistingTriggeredRemovalCycles(targetSet, report);

    expect(plan).toMatchObject({
      readyCount: 0,
      scheduledCount: 0,
      reviewCount: 1,
    });
    expect(plan.items[0]).toMatchObject({
      action: "hold_for_review",
      reason: "profile_fingerprint",
      triggerAt: null,
    });
  });
});
