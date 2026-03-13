import type { RetrieveProceduresResponse } from "@/lib/agent/api";
import type {
  ActionHandoff,
  ExecutionOutcome,
  MatchDecision,
  OptOutDraft,
  ProcedureSelection,
  SearchTarget,
  SeedProfile,
  WorkflowEvent,
} from "@/lib/agent/contracts";
import {
  createBackendProcedureRetriever,
  createStaticProcedureRetrievalBackendClient,
} from "@/lib/agent/retrieval";
import { createRuntimeFixtureLlmAdapter } from "@/lib/agent/runtime-fixture-llm";
import {
  createAgentWorkflow,
  type WorkflowBatchSiteRegistryInput,
  type WorkflowRunOutput,
  type WorkflowSiteRunOutput,
} from "@/lib/agent/workflow";
import { captureLiveDiscoveryArtifact, type DiscoveryMode } from "@/lib/automation/discovery";
import { createWorkflowAutomationHandoff } from "@/lib/automation/handoff";

type WorkerMode = "plan" | "execute";

interface WorkflowWorkerInput {
  mode: WorkerMode;
  runId: string;
  profileId: string;
  seedProfile: SeedProfile;
  requestText: string;
  requestedSites: string[];
  procedureResponses: RetrieveProceduresResponse[];
}

interface WorkflowRemovalRecord {
  siteId: string;
  candidateId: string;
  candidateUrl: string;
  procedureId: string | null;
  submissionChannel: string;
  status: string;
  reviewReasons: string[];
  metadata: Record<string, unknown>;
  ticketIds: string[];
  screenshotRef: string | null;
  confirmationText: string | null;
  errorText: string | null;
  message: string;
}

interface WorkflowWorkerOutput {
  currentPhase: string;
  status: string;
  pendingReviewReasons: string[];
  targets: SearchTarget[];
  candidates: Record<string, unknown>[];
  matchDecisions: MatchDecision[];
  procedures: ProcedureSelection[];
  drafts: OptOutDraft[];
  handoffs: ActionHandoff[];
  outcomes: ExecutionOutcome[];
  timeline: WorkflowEvent[];
  removals: WorkflowRemovalRecord[];
  monitoredTargetSet: Record<string, unknown>;
  automationAttempted: boolean;
  automationError: string | null;
}

function normalizeSiteId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function toDisplaySiteName(siteId: string) {
  const normalized = normalizeSiteId(siteId);
  switch (normalized) {
    case "fastpeoplesearch":
      return "FastPeopleSearch";
    case "spokeo":
      return "Spokeo";
    case "radaris":
      return "Radaris";
    case "whitepages":
      return "WhitePages";
    case "truepeoplesearch":
      return "TruePeopleSearch";
    default:
      return siteId
        .split(/[_\-\s]+/)
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
        .join("");
  }
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function nowIso() {
  return new Date().toISOString();
}

function readDiscoveryMode(): DiscoveryMode {
  const value = process.env.WORKFLOW_DISCOVERY_MODE?.trim().toLowerCase();
  if (value === "live" || value === "fixture" || value === "hybrid") {
    return value;
  }
  return "hybrid";
}

function buildListingUrl(siteName: string, seedProfile: SeedProfile) {
  const slug = seedProfile.full_name.toLowerCase().replace(/\s+/g, "-");
  const citySlug = seedProfile.location.city.toLowerCase().replace(/\s+/g, "-");
  const stateSlug = seedProfile.location.state.toLowerCase().replace(/\s+/g, "-");
  const normalized = normalizeSiteId(siteName);
  switch (normalized) {
    case "spokeo":
      return `https://www.spokeo.com/${slug}/${citySlug}-${stateSlug}`;
    case "fastpeoplesearch":
      return `https://www.fastpeoplesearch.com/name/${slug}_${citySlug}-${stateSlug}`;
    case "radaris":
      return `https://radaris.com/p/${seedProfile.full_name.replace(/\s+/g, "/")}/${citySlug}-${stateSlug}`;
    case "whitepages":
      return `https://www.whitepages.com/name/${slug}/${citySlug}-${stateSlug}`;
    case "truepeoplesearch":
      return `https://www.truepeoplesearch.com/results?name=${encodeURIComponent(seedProfile.full_name)}&citystatezip=${encodeURIComponent(`${seedProfile.location.city}, ${seedProfile.location.state}`)}`;
    default:
      return `https://www.${normalized}.example/${slug}/${citySlug}-${stateSlug}`;
  }
}

function createNoMatchArtifact(siteName: string, seedProfile: SeedProfile) {
  return {
    visible_text: `Directory landing page for ${siteName}. No matching listing for ${seedProfile.full_name} was found in this captured page text.`,
    url: `https://www.${normalizeSiteId(siteName)}.example/search`,
    screenshot_ref: null,
    extracted_metadata: {
      page_category: "search_results",
      title: `${siteName} search results`,
    },
  };
}

function createMatchArtifact(siteName: string, seedProfile: SeedProfile) {
  const listingUrl = buildListingUrl(siteName, seedProfile);
  const phone = seedProfile.optional.phone_last4
    ? `(206) 555-${seedProfile.optional.phone_last4}`
    : "(206) 555-0147";
  const priorCity = seedProfile.optional.prior_cities[0];
  const baseText = [
    `${seedProfile.full_name}, age ${seedProfile.approx_age ?? "unknown"}, ${seedProfile.location.city}, ${seedProfile.location.state}.`,
    `123 Pine Street, ${seedProfile.location.city}, ${seedProfile.location.state}.`,
    `Phone ${phone}.`,
  ];
  if (priorCity) {
    baseText.push(`Prior city ${priorCity}.`);
  }
  return {
    visible_text: baseText.join(" "),
    url: listingUrl,
    screenshot_ref: null,
    extracted_metadata: {
      page_category: "listing_detail",
      title: `${seedProfile.full_name} in ${seedProfile.location.city}, ${seedProfile.location.state} | ${siteName}`,
    },
  };
}

async function createSiteRegistry(input: WorkflowWorkerInput): Promise<WorkflowBatchSiteRegistryInput[]> {
  const requestedSites = input.requestedSites.length > 0 ? input.requestedSites : ["spokeo", "fastpeoplesearch", "radaris"];
  const discoveryMode = readDiscoveryMode();
  return await Promise.all(requestedSites.map(async (siteId) => {
    const siteName = toDisplaySiteName(siteId);
    const normalized = normalizeSiteId(siteId);
    const fixtureArtifact = ["spokeo", "fastpeoplesearch", "radaris"].includes(normalized)
      ? createMatchArtifact(siteName, input.seedProfile)
      : createNoMatchArtifact(siteName, input.seedProfile);
    const liveArtifact = discoveryMode === "fixture"
      ? null
      : await captureLiveDiscoveryArtifact({
          site: siteName,
          seedProfile: input.seedProfile,
        });
    const pageArtifact = liveArtifact ?? fixtureArtifact;
    return {
      site: siteName,
      enabled: true,
      notes: liveArtifact
        ? `Playwright-captured discovery artifact for ${siteName}.`
        : discoveryMode === "live"
          ? `Live discovery fallback artifact for ${siteName}.`
          : `Backend-generated fallback artifact for ${siteName}.`,
      default_procedure_chunks: [],
      page_artifact: pageArtifact,
      retrieved_chunks: [],
      retry_count: 0,
    };
  }));
}

function toTarget(siteRun: WorkflowSiteRunOutput): SearchTarget {
  return {
    siteId: normalizeSiteId(siteRun.site_input.site),
    siteName: siteRun.site_input.site,
    query: siteRun.validate_consent.normalized_query,
  };
}

function toCandidate(siteRun: WorkflowSiteRunOutput) {
  const candidate = siteRun.discovery_parse.candidates[0];
  if (!candidate) {
    return null;
  }
  return {
    candidateId: candidate.url,
    siteId: normalizeSiteId(siteRun.site_input.site),
    siteName: siteRun.site_input.site,
    listingUrl: candidate.url,
    displayName: candidate.extracted.name,
    extractedFields: [
      { field: "Full Name", value: candidate.extracted.name },
      ...(candidate.extracted.age ? [{ field: "Age", value: candidate.extracted.age }] : []),
      ...candidate.extracted.addresses.map((address) => ({ field: "Address", value: address })),
      ...candidate.extracted.phones.map((phone) => ({ field: "Phone", value: phone })),
      ...candidate.extracted.relatives.map((relative) => ({ field: "Relative", value: relative })),
    ],
    evidence: (siteRun.match_decision?.evidence ?? []).length > 0
      ? siteRun.match_decision?.evidence
      : [
          {
            sourceType: "listing_page",
            sourceUrl: candidate.url,
            excerpt: candidate.evidence_snippets[0] ?? `${candidate.extracted.name} listing`,
            capturedAt: siteRun.discovery_parse.scan_timestamp,
            fields: [],
          },
        ],
  };
}

function toProcedure(siteRun: WorkflowSiteRunOutput): ProcedureSelection | null {
  if (!siteRun.retrieve_procedure) {
    return null;
  }
  const siteId = normalizeSiteId(siteRun.site_input.site);
  const procedureId = `${siteId}-workflow`;
  const submissionChannel = siteRun.retrieve_procedure.procedure_type === "email" ? "email" : "webform";
  const reviewReasons = unique([
    ...siteRun.context.review_reasons,
    ...(siteRun.plan_submission?.review_reasons ?? []),
  ]);
  const steps = siteRun.retrieve_procedure.steps.length > 0
    ? siteRun.retrieve_procedure.steps.map((step, index) => ({
        stepId: `step_${siteId}_${index + 1}`,
        action: submissionChannel === "email"
          ? "manual_review"
          : index === 0
            ? "navigate"
            : index === siteRun.retrieve_procedure!.steps.length - 1
              ? "submit"
              : "fill",
        instruction: step,
        required: true,
      }))
    : [
        {
          stepId: `step_${siteId}_1`,
          action: "manual_review",
          instruction: `Review the ${siteRun.site_input.site} procedure manually.`,
          required: true,
        },
      ];

  return {
    siteId,
    procedureId,
    source: "rag",
    sourceDocumentUri: `${procedureId}-source`,
    sourceVersion: "workflow-v1",
    retrievedAt: nowIso(),
    submissionChannel,
    freshnessDays: 0,
    isComplete: siteRun.retrieve_procedure.procedure_type !== "procedure_unknown",
    requiredInputs: siteRun.retrieve_procedure.required_fields.map((field) => ({
      key: field,
      label: field.replace(/_/g, " "),
      required: true,
      source: field === "privacy_email" ? "system" : "profile",
    })),
    steps,
    reviewReasons: reviewReasons.length > 0 ? reviewReasons : siteRun.retrieve_procedure.procedure_type === "procedure_unknown" ? ["missing_procedure"] : [],
  };
}

function toDraft(siteRun: WorkflowSiteRunOutput): OptOutDraft | null {
  const candidate = siteRun.discovery_parse.candidates[0];
  if (!siteRun.draft_optout || !candidate) {
    return null;
  }
  const siteId = normalizeSiteId(siteRun.site_input.site);
  return {
    draftId: `draft_${siteId}`,
    siteId,
    candidateId: candidate.url,
    submissionChannel: siteRun.draft_optout.submission_channel,
    subject: siteRun.draft_optout.email?.subject,
    body: siteRun.draft_optout.email?.body ?? JSON.stringify(siteRun.draft_optout.webform ?? {}, null, 2),
    factsUsed: [
      ...siteRun.draft_optout.required_fields.map((field) => ({ field: field.name, value: field.value })),
      ...siteRun.draft_optout.optional_fields.map((field) => ({ field: field.name, value: field.value })),
    ],
    procedureId: `${siteId}-workflow`,
    generatedAt: nowIso(),
  };
}

function buildGenericHandoff(siteRun: WorkflowSiteRunOutput, draft: OptOutDraft | null, procedure: ProcedureSelection | null): ActionHandoff | null {
  const candidate = siteRun.discovery_parse.candidates[0];
  if (!siteRun.plan_submission || !candidate || !draft || !procedure) {
    return null;
  }
  const siteId = normalizeSiteId(siteRun.site_input.site);
  return {
    handoffId: `handoff_${siteId}_${siteRun.context.run_id}`,
    mode: siteRun.plan_submission.requires_manual_review ? "human_assisted" : "auto",
    requiresUserApproval: true,
    reviewReasons: siteRun.plan_submission.review_reasons.length > 0 ? siteRun.plan_submission.review_reasons : ["manual_submission_required"],
    createdAt: nowIso(),
    payload: {
      siteId,
      candidateId: candidate.url,
      procedureId: procedure.procedureId,
      procedureVersion: procedure.sourceVersion,
      submissionChannel: procedure.submissionChannel,
      fields: Object.fromEntries([
        ...siteRun.plan_submission.action_plan.required_fields.map((field) => [field.name, field.value]),
        ...siteRun.plan_submission.action_plan.optional_fields.map((field) => [field.name, field.value]),
        ["candidate_url", candidate.url],
      ]),
      steps: procedure.steps,
      draft,
    },
  };
}

function toOutcome(siteRun: WorkflowSiteRunOutput): ExecutionOutcome | null {
  const candidate = siteRun.discovery_parse.candidates[0];
  if (!siteRun.interpret_result || !candidate) {
    return null;
  }
  return {
    siteId: normalizeSiteId(siteRun.site_input.site),
    candidateId: candidate.url,
    status: siteRun.interpret_result.next_status === "pending" ? "needs_follow_up" : siteRun.interpret_result.next_status,
    confirmationId: siteRun.automation_record?.executionResult.ticket_ids[0],
    observedAt: nowIso(),
    evidence: siteRun.automation_record
      ? [
          {
            sourceType: "execution_log",
            sourceUrl: siteRun.automation_record.executionResult.screenshot_ref ?? undefined,
            excerpt: siteRun.automation_record.executionResult.confirmation_text
              ?? siteRun.automation_record.executionResult.error_text
              ?? `Automation result for ${siteRun.site_input.site}`,
            capturedAt: siteRun.automation_record.evidence.completedAt,
            fields: [],
          },
        ]
      : [],
    reviewReasons: siteRun.interpret_result.review_reasons,
  };
}

function buildTimeline(output: WorkflowRunOutput, mode: WorkerMode, automationError: string | null): WorkflowEvent[] {
  const events: WorkflowEvent[] = [];
  for (const siteRun of output.site_runs) {
    const siteId = normalizeSiteId(siteRun.site_input.site);
    const candidateId = siteRun.discovery_parse.candidates[0]?.url;
    events.push({
      eventId: `evt_${output.context.run_id}_${siteId}_scan`,
      runId: output.context.run_id,
      phase: "scan",
      status: siteRun.discovery_parse.found ? "completed" : "completed",
      message: siteRun.discovery_parse.found
        ? `Discovered a likely listing on ${siteRun.site_input.site}.`
        : `No likely listing found on ${siteRun.site_input.site}.`,
      createdAt: nowIso(),
      siteId,
      candidateId,
      reviewReasons: [],
    });

    if (siteRun.match_decision) {
      events.push({
        eventId: `evt_${output.context.run_id}_${siteId}_match`,
        runId: output.context.run_id,
        phase: "match",
        status: "completed",
        message: `Confirmed a ${siteRun.match_decision.decision.replace(/_/g, " ")} on ${siteRun.site_input.site}.`,
        createdAt: nowIso(),
        siteId,
        candidateId,
        reviewReasons: siteRun.match_decision.reviewReasons,
      });
    }

    if (siteRun.retrieve_procedure) {
      const blocked = siteRun.retrieve_procedure.procedure_type === "procedure_unknown";
      events.push({
        eventId: `evt_${output.context.run_id}_${siteId}_procedure`,
        runId: output.context.run_id,
        phase: "retrieve_procedure",
        status: blocked ? "blocked" : "completed",
        message: blocked
          ? `No usable procedure was found for ${siteRun.site_input.site}.`
          : `Retrieved procedure guidance for ${siteRun.site_input.site}.`,
        createdAt: nowIso(),
        siteId,
        candidateId,
        reviewReasons: blocked ? ["missing_procedure"] : siteRun.context.review_reasons,
      });
    }

    if (siteRun.draft_optout) {
      events.push({
        eventId: `evt_${output.context.run_id}_${siteId}_draft`,
        runId: output.context.run_id,
        phase: "draft",
        status: "completed",
        message: `Prepared a draft removal request for ${siteRun.site_input.site}.`,
        createdAt: nowIso(),
        siteId,
        candidateId,
        reviewReasons: siteRun.draft_optout.review_reasons,
      });
    }

    if (siteRun.plan_submission) {
      events.push({
        eventId: `evt_${output.context.run_id}_${siteId}_approval`,
        runId: output.context.run_id,
        phase: "approval",
        status: siteRun.plan_submission.requires_manual_review ? "awaiting_user" : "in_progress",
        message: siteRun.plan_submission.requires_manual_review
          ? `Submission plan is ready for review for ${siteRun.site_input.site}.`
          : `Submission plan is ready for ${siteRun.site_input.site}.`,
        createdAt: nowIso(),
        siteId,
        candidateId,
        reviewReasons: siteRun.plan_submission.review_reasons,
      });
    }

    if (mode === "execute" && siteRun.automation_record) {
      events.push({
        eventId: `evt_${output.context.run_id}_${siteId}_execution`,
        runId: output.context.run_id,
        phase: "execution",
        status: siteRun.automation_record.executionResult.status === "failed" ? "failed" : "completed",
        message: `Automation executed for ${siteRun.site_input.site} with status ${siteRun.automation_record.executionResult.status}.`,
        createdAt: nowIso(),
        siteId,
        candidateId,
        reviewReasons: siteRun.automation_record.evidence.reviewReasons,
      });
    }

    if (siteRun.interpret_result) {
      events.push({
        eventId: `evt_${output.context.run_id}_${siteId}_verification`,
        runId: output.context.run_id,
        phase: "verification",
        status: siteRun.interpret_result.next_status === "failed" ? "failed" : "completed",
        message: `Verification recorded ${siteRun.interpret_result.next_status} for ${siteRun.site_input.site}.`,
        createdAt: nowIso(),
        siteId,
        candidateId,
        reviewReasons: siteRun.interpret_result.review_reasons,
      });
    }
  }

  if (automationError) {
    events.push({
      eventId: `evt_${output.context.run_id}_automation_error`,
      runId: output.context.run_id,
      phase: "execution",
      status: "blocked",
      message: `Automation could not complete: ${automationError}`,
      createdAt: nowIso(),
      reviewReasons: ["manual_submission_required"],
    });
  }

  return events;
}

function summarizeStatus(output: WorkflowRunOutput, mode: WorkerMode, automationError: string | null) {
  const hasInterpretResult = output.site_runs.some((siteRun) => siteRun.interpret_result);
  const hasPendingPlans = output.site_runs.some((siteRun) => siteRun.plan_submission);
  const reviewReasons = unique(
    output.site_runs.flatMap((siteRun) => [
      ...siteRun.context.review_reasons,
      ...(siteRun.plan_submission?.review_reasons ?? []),
      ...(siteRun.interpret_result?.review_reasons ?? []),
    ]),
  );

  if (mode === "execute" && hasInterpretResult && !automationError) {
    const hasFollowUp = output.site_runs.some((siteRun) => {
      const nextStatus = siteRun.interpret_result?.next_status;
      return nextStatus === "pending" || nextStatus === "manual_required";
    });
    if (hasFollowUp) {
      return {
        currentPhase: "verification",
        status: "in_progress",
        pendingReviewReasons: unique([...reviewReasons, ...(hasFollowUp ? ["email_confirmation_required"] : [])]),
      };
    }
    return {
      currentPhase: "completed",
      status: "completed",
      pendingReviewReasons: reviewReasons,
    };
  }

  if (hasPendingPlans) {
    return {
      currentPhase: "approval",
      status: "awaiting_user",
      pendingReviewReasons: unique([...reviewReasons, "manual_submission_required"]),
    };
  }

  if (reviewReasons.length > 0) {
    return {
      currentPhase: "retrieve_procedure",
      status: "blocked",
      pendingReviewReasons: reviewReasons,
    };
  }

  return {
    currentPhase: "completed",
    status: "completed",
    pendingReviewReasons: [],
  };
}

function buildRemovalRecords(siteRuns: WorkflowSiteRunOutput[], mode: WorkerMode): WorkflowRemovalRecord[] {
  const removals: WorkflowRemovalRecord[] = [];
  for (const siteRun of siteRuns) {
    const candidate = siteRun.discovery_parse.candidates[0];
    if (!candidate) {
      continue;
    }
    const siteId = normalizeSiteId(siteRun.site_input.site);
    const draft = toDraft(siteRun);
    const procedure = toProcedure(siteRun);
    const handoff = siteRun.automation_record?.handoff ?? buildGenericHandoff(siteRun, draft, procedure);
    const executionResult = siteRun.automation_record?.executionResult;
    removals.push({
      siteId,
      candidateId: candidate.url,
      candidateUrl: candidate.url,
      procedureId: procedure?.procedureId ?? null,
      submissionChannel: procedure?.submissionChannel ?? siteRun.draft_optout?.submission_channel ?? "webform",
      status: executionResult?.status ?? (siteRun.plan_submission ? "planned" : "unplanned"),
      reviewReasons: unique([
        ...siteRun.context.review_reasons,
        ...(siteRun.plan_submission?.review_reasons ?? []),
        ...(siteRun.interpret_result?.review_reasons ?? []),
      ]),
      metadata: {
        draft,
        procedure,
        handoff,
      },
      ticketIds: executionResult?.ticket_ids ?? [],
      screenshotRef: executionResult?.screenshot_ref ?? null,
      confirmationText: executionResult?.confirmation_text ?? null,
      errorText: executionResult?.error_text ?? null,
      message: executionResult
        ? `Execution result recorded for ${siteRun.site_input.site}: ${executionResult.status}.`
        : mode === "execute"
          ? `Execution could not complete for ${siteRun.site_input.site}.`
          : `Submission plan generated for ${siteRun.site_input.site}.`,
    });
  }
  return removals;
}

function buildMonitoredTargetSet(runId: string, profileId: string, seedProfile: SeedProfile, removals: WorkflowRemovalRecord[]) {
  const needsAttention = removals.filter((removal) => removal.status === "manual_required" || removal.status === "failed");
  const activeTargets = removals.filter((removal) => removal.status === "planned" || removal.status === "pending" || removal.status === "submitted");
  const now = nowIso();
  return {
    targetSetId: `mts_${runId}`,
    sourceRunId: runId,
    profileId,
    profileName: seedProfile.full_name,
    status: needsAttention.length > 0 ? "needs_attention" : activeTargets.length > 0 ? "active" : "completed",
    monitoringPolicy: {
      cadenceDays: 30,
      reReviewCooldownDays: 30,
      reReviewListingReappearanceThreshold: 1,
    },
    targetCount: removals.length,
    activeTargetCount: activeTargets.length,
    needsAttentionCount: needsAttention.length,
    targets: removals.map((removal) => ({
      siteId: removal.siteId,
      candidateId: removal.candidateId,
      candidateUrl: removal.candidateUrl,
      monitoringStatus: removal.status === "submitted"
        ? "scheduled"
        : removal.status === "pending"
          ? "awaiting_confirmation"
          : removal.status === "failed" || removal.status === "manual_required"
            ? "manual_review"
            : "scheduled",
      latestStatus: removal.status,
      triggerNewRemovalCycle: false,
    })),
    materializedFromRunAt: now,
    createdAt: now,
    updatedAt: now,
    storageBacked: false,
  };
}

function normalizeOutput(output: WorkflowRunOutput, input: WorkflowWorkerInput, mode: WorkerMode, automationError: string | null): WorkflowWorkerOutput {
  const targets = output.site_runs.map(toTarget);
  const candidates = output.site_runs.map(toCandidate).filter(Boolean) as Record<string, unknown>[];
  const matchDecisions = output.site_runs.map((siteRun) => siteRun.match_decision).filter(Boolean) as MatchDecision[];
  const procedures = output.site_runs.map(toProcedure).filter(Boolean) as ProcedureSelection[];
  const drafts = output.site_runs.map(toDraft).filter(Boolean) as OptOutDraft[];
  const handoffs = output.site_runs
    .map((siteRun) => {
      const draft = toDraft(siteRun);
      const procedure = toProcedure(siteRun);
      return siteRun.automation_record?.handoff ?? buildGenericHandoff(siteRun, draft, procedure);
    })
    .filter(Boolean) as ActionHandoff[];
  const outcomes = output.site_runs.map(toOutcome).filter(Boolean) as ExecutionOutcome[];
  const timeline = buildTimeline(output, mode, automationError);
  const statusSummary = summarizeStatus(output, mode, automationError);
  const removals = buildRemovalRecords(output.site_runs, mode);
  return {
    currentPhase: statusSummary.currentPhase,
    status: statusSummary.status,
    pendingReviewReasons: statusSummary.pendingReviewReasons,
    targets,
    candidates,
    matchDecisions,
    procedures,
    drafts,
    handoffs,
    outcomes,
    timeline,
    removals,
    monitoredTargetSet: buildMonitoredTargetSet(input.runId, input.profileId, input.seedProfile, removals),
    automationAttempted: mode === "execute",
    automationError,
  };
}

async function readStdin() {
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

async function main() {
  const raw = (await readStdin()).trim();
  if (!raw) {
    throw new Error("No JSON input received by backend workflow runner.");
  }

  const input = JSON.parse(raw) as WorkflowWorkerInput;
  const siteRegistry = await createSiteRegistry(input);
  const workflow = createAgentWorkflow({
    llm: {
      adapter: createRuntimeFixtureLlmAdapter(),
    },
    procedureRetriever: createBackendProcedureRetriever({
      client: createStaticProcedureRetrievalBackendClient(input.procedureResponses),
    }),
  });

  const workflowInput = {
    context: {
      run_id: input.runId,
      review_reasons: [],
      events: [],
    },
    seed_profile: input.seedProfile,
    request_text: input.requestText,
    requested_sites: input.requestedSites.map(toDisplaySiteName),
    site_registry: siteRegistry,
  };

  let output: WorkflowRunOutput;
  let automationError: string | null = null;
  if (input.mode === "execute") {
    try {
      output = await workflow.runWithAutomation(workflowInput);
    } catch (error) {
      automationError = error instanceof Error ? error.message : String(error);
      output = await workflow.run(workflowInput);
    }
  } else {
    output = await workflow.run(workflowInput);
  }

  process.stdout.write(JSON.stringify(normalizeOutput(output, input, input.mode, automationError)));
}

void main().catch((error: unknown) => {
  const payload = {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exit(1);
});
