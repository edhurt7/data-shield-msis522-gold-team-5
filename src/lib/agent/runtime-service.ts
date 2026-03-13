import {
  chatMessageSchema,
  mapWorkflowRunOutputToMonitoredTargetSet,
  mapWorkflowRunOutputToAgentRunState,
  sendChatCommandResponseSchema,
  type MonitoredTargetSet,
  type SendChatCommandResponse,
  type ChatMessage as AgentChatMessage,
} from "@/lib/agent/api";
import { type ExecutionResult, type SeedProfile } from "@/lib/agent/contracts";
import { createDocumentProcedureRetriever } from "@/lib/agent/retrieval";
import { createRuntimeFixtureLlmAdapter } from "@/lib/agent/runtime-fixture-llm";
import {
  createAgentWorkflow,
  type WorkflowBatchSiteRegistryInput,
  type WorkflowRunOutput,
  type WorkflowSiteRunOutput,
} from "@/lib/agent/workflow";
import {
  BROKER_DIRECTORY,
  type BrokerSite,
  type ChatMessage,
  type HistoryEntry,
  buildBrokerSites,
  buildHistoryEntries,
} from "@/lib/mock-data";

interface DashboardSnapshot {
  runId: string;
  brokerSites: BrokerSite[];
  history: HistoryEntry[];
  chatMessages: ChatMessage[];
}

export interface RuntimeMonitoredTargetSetService {
  listMonitoredTargetSets(): Promise<MonitoredTargetSet[]>;
  getMonitoredTargetSetForRun(runId: string): Promise<MonitoredTargetSet | null>;
}

interface RuntimeSession {
  runId: string;
  requestedSites: string[];
  seedProfile: SeedProfile;
  requestText: string;
  siteRegistry: WorkflowBatchSiteRegistryInput[];
  workflowOutput: WorkflowRunOutput;
  chatMessages: ChatMessage[];
}

const runtimeSeedProfile: SeedProfile = {
  full_name: "Jane Doe",
  name_variants: ["Jane A Doe", "J. Doe"],
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
};

const siteUrls = new Map<string, string>(BROKER_DIRECTORY.map((site) => [site.name, `https://${site.url}`]));

function nowIso() {
  return new Date().toISOString();
}

function createNoMatchArtifact(site: string) {
  return {
    visible_text: `Directory landing page for ${site}. No matching person listing is available in this captured page text.`,
    url: `${siteUrls.get(site) ?? "https://example.test"}/search`,
    screenshot_ref: null,
    extracted_metadata: {
      page_category: "search_results",
      title: `${site} search results`,
    },
  };
}

function toSiteRegistryEntry(
  site: string,
  artifact: ReturnType<typeof createNoMatchArtifact>,
  executionResult?: ExecutionResult,
): WorkflowBatchSiteRegistryInput {
  return {
    site,
    page_artifact: {
      visible_text: artifact.visible_text,
      url: artifact.url,
      screenshot_ref: artifact.screenshot_ref,
      extracted_metadata: artifact.extracted_metadata,
    },
    execution_result: executionResult,
  };
}

function createInitialSiteRegistry(): WorkflowBatchSiteRegistryInput[] {
  return [
    toSiteRegistryEntry(
      "Spokeo",
      {
        visible_text: "Jane Doe, age 35, Seattle, Washington. 123 Pine Street, Seattle, WA. Phone 206-555-0114.",
        url: `${siteUrls.get("Spokeo")}/jane-doe/seattle-wa`,
        screenshot_ref: null,
        extracted_metadata: {
          page_category: "listing_detail",
          title: "Jane Doe in Seattle, WA | Spokeo",
        },
      },
    ),
    toSiteRegistryEntry("WhitePages", createNoMatchArtifact("WhitePages")),
    toSiteRegistryEntry("BeenVerified", createNoMatchArtifact("BeenVerified")),
    toSiteRegistryEntry("Intelius", createNoMatchArtifact("Intelius")),
    toSiteRegistryEntry("PeopleFinder", createNoMatchArtifact("PeopleFinder")),
    toSiteRegistryEntry("TruePeopleSearch", createNoMatchArtifact("TruePeopleSearch")),
    toSiteRegistryEntry(
      "FastPeopleSearch",
      {
        visible_text: [
          "Jane Doe, age 35, Seattle, Washington.",
          "123 Pine Street, Seattle, WA 98101.",
          "Phone 206-555-0114.",
          "Relatives: John Doe, Alice Doe.",
          "Prior city Tacoma.",
        ].join(" "),
        url: "https://fastpeoplesearch.test/listing/jane-doe-seattle-wa",
        screenshot_ref: null,
        extracted_metadata: {
          page_category: "listing_detail",
          title: "Jane Doe in Seattle, WA | FastPeopleSearch",
        },
      },
      {
        site: "FastPeopleSearch",
        candidate_url: "https://fastpeoplesearch.test/listing/jane-doe-seattle-wa",
        status: "pending",
        manual_review_required: false,
        confirmation_text: "Your request has been received and is awaiting confirmation review.",
        ticket_ids: [],
        screenshot_ref: "fixtures/fastpeoplesearch-confirmation.png",
        error_text: null,
      },
    ),
    toSiteRegistryEntry("ThatsThem", createNoMatchArtifact("ThatsThem")),
    toSiteRegistryEntry(
      "Radaris",
      {
        visible_text: "Jane Doe, Seattle, Washington. Age 35. Prior city Tacoma. Listing URL available for privacy request.",
        url: "https://radaris.test/listing/jane-doe-seattle-wa",
        screenshot_ref: null,
        extracted_metadata: {
          page_category: "listing_detail",
          title: "Jane Doe in Seattle, WA | Radaris",
        },
      },
    ),
    toSiteRegistryEntry("USSearch", createNoMatchArtifact("USSearch")),
    toSiteRegistryEntry("Pipl", createNoMatchArtifact("Pipl")),
    toSiteRegistryEntry("ZabaSearch", createNoMatchArtifact("ZabaSearch")),
  ];
}

function createWorkflowRunner() {
  return createAgentWorkflow({
    llm: {
      adapter: createRuntimeFixtureLlmAdapter(),
    },
    procedureRetriever: createDocumentProcedureRetriever(),
  });
}

function buildRequestText(requestedSites: string[]) {
  const requested = requestedSites.length > 0 ? requestedSites.join(", ") : "all configured sites";
  return `Search for my name in Seattle and prepare opt-out requests for ${requested}.`;
}

function siteIdForName(siteName: string) {
  return BROKER_DIRECTORY.find((site) => site.name === siteName)?.id ?? siteName.toLowerCase();
}

function buildAgentRunStateFromSession(
  session: RuntimeSession,
  overrides: Parameters<typeof mapWorkflowRunOutputToAgentRunState>[1] = {},
) {
  return mapWorkflowRunOutputToAgentRunState(session.workflowOutput, {
    profileId: "runtime_profile_001",
    requestText: session.requestText,
    requestedSites: session.requestedSites,
    requestedActions: ["scan_only", "submit_opt_out"],
    requiresUserApprovalBeforeSubmission: true,
    ...overrides,
  });
}

function buildAssistantSummary(output: WorkflowRunOutput) {
  const matchedSites = output.site_runs.filter((siteRun) => siteRun.discovery_parse.found).map((siteRun) => siteRun.site_input.site);
  const draftedSites = output.site_runs.filter((siteRun) => siteRun.draft_optout !== null).map((siteRun) => siteRun.site_input.site);
  const submittedSites = output.site_runs.filter((siteRun) => siteRun.interpret_result !== null).map((siteRun) => siteRun.site_input.site);

  return [
    `Runtime workflow processed ${output.run_summary.total_processed_sites} sites.`,
    matchedSites.length > 0 ? `Matches: ${matchedSites.join(", ")}.` : "No matches found.",
    draftedSites.length > 0 ? `Drafts ready: ${draftedSites.join(", ")}.` : "No drafts generated.",
    submittedSites.length > 0 ? `Execution evidence recorded: ${submittedSites.join(", ")}.` : "No submissions executed yet.",
  ].join(" ");
}

function buildDashboardSnapshot(session: RuntimeSession): DashboardSnapshot {
  const runState = buildAgentRunStateFromSession(session);

  return {
    runId: session.runId,
    brokerSites: buildBrokerSites(runState),
    history: buildHistoryEntries(runState),
    chatMessages: session.chatMessages,
  };
}

function buildMonitoredTargetSetFromSession(session: RuntimeSession) {
  return mapWorkflowRunOutputToMonitoredTargetSet(session.workflowOutput, {
    profileId: "runtime_profile_001",
    targetSetId: `mts_${session.runId}`,
  });
}

async function runWorkflowSession(input: {
  runId: string;
  requestedSites: string[];
  seedProfile: SeedProfile;
  siteRegistry: WorkflowBatchSiteRegistryInput[];
}) {
  const workflow = createWorkflowRunner();

  return workflow.run({
    context: {
      run_id: input.runId,
      review_reasons: [],
      events: [],
    },
    seed_profile: input.seedProfile,
    request_text: buildRequestText(input.requestedSites),
    requested_sites: input.requestedSites,
    site_registry: input.siteRegistry,
  });
}

function cloneSiteRegistry(siteRegistry: WorkflowBatchSiteRegistryInput[]) {
  return structuredClone(siteRegistry);
}

function findSubmittableSites(output: WorkflowRunOutput) {
  return output.site_runs.filter((siteRun) => siteRun.plan_submission && !siteRun.site_input.execution_result);
}

function createExecutionResult(siteRun: WorkflowSiteRunOutput): ExecutionResult {
  const candidateUrl = siteRun.draft_optout?.candidate_url ?? siteRun.discovery_parse.candidates[0]?.url ?? siteRun.site_input.page_artifact.url;

  if (siteRun.draft_optout?.procedure_type === "email") {
    return {
      site: siteRun.site_input.site,
      candidate_url: candidateUrl,
      status: "submitted",
      manual_review_required: false,
      confirmation_text: "Your email removal request has been received and submitted successfully.",
      ticket_ids: [`${siteIdForName(siteRun.site_input.site).toUpperCase()}-EMAIL-001`],
      screenshot_ref: null,
      error_text: null,
    };
  }

  return {
    site: siteRun.site_input.site,
    candidate_url: candidateUrl,
    status: "pending",
    manual_review_required: false,
    confirmation_text: "Your request has been received and is awaiting final confirmation.",
    ticket_ids: [],
    screenshot_ref: `runtime/${siteIdForName(siteRun.site_input.site)}-confirmation.png`,
    error_text: null,
  };
}

function applyExecutionResults(
  siteRegistry: WorkflowBatchSiteRegistryInput[],
  siteRuns: WorkflowSiteRunOutput[],
  siteNames: string[],
) {
  const executionBySite = new Map(
    siteRuns
      .filter((siteRun) => siteNames.includes(siteRun.site_input.site))
      .map((siteRun) => [siteRun.site_input.site, createExecutionResult(siteRun)]),
  );

  return siteRegistry.map((entry) => ({
    ...entry,
    execution_result: executionBySite.get(entry.site) ?? entry.execution_result,
  }));
}

function buildAssistantMessage(message: string, session: RuntimeSession, submittedSites: string[]) {
  const lowered = message.toLowerCase();

  if (lowered.includes("submit") || lowered.includes("removal")) {
    return submittedSites.length > 0
      ? `Submitted the pending workflow drafts for ${submittedSites.join(", ")}. The dashboard now reflects the runtime execution results.`
      : "There were no runtime drafts ready for submission.";
  }

  if (lowered.includes("rescan") || lowered.includes("status") || lowered.includes("progress")) {
    return buildAssistantSummary(session.workflowOutput);
  }

  return "Logged that request against the local runtime session. The dashboard is still backed by the workflow output rather than the old mock state.";
}

async function createInitialSession(): Promise<RuntimeSession> {
  const runId = "run_runtime_demo_001";
  const requestedSites = BROKER_DIRECTORY.map((site) => site.name);
  const siteRegistry = createInitialSiteRegistry();
  const workflowOutput = await runWorkflowSession({
    runId,
    requestedSites,
    seedProfile: runtimeSeedProfile,
    siteRegistry,
  });

  return {
    runId,
    requestedSites,
    seedProfile: runtimeSeedProfile,
    requestText: buildRequestText(requestedSites),
    siteRegistry,
    workflowOutput,
    chatMessages: [
      {
        id: "chat_runtime_seed_assistant",
        role: "assistant",
        content: buildAssistantSummary(workflowOutput),
        timestamp: nowIso(),
      },
    ],
  };
}

let sessionPromise: Promise<RuntimeSession> | null = null;

async function loadSession() {
  sessionPromise ??= createInitialSession();
  return sessionPromise;
}

export const runtimeAgentService: RuntimeMonitoredTargetSetService & {
  getDashboardSnapshot(): Promise<DashboardSnapshot>;
  sendChatCommand(message: string): Promise<SendChatCommandResponse>;
  resetDemoSession(): Promise<void>;
} = {
  async getDashboardSnapshot() {
    const session = await loadSession();
    return buildDashboardSnapshot(session);
  },

  async listMonitoredTargetSets() {
    const session = await loadSession();
    return [buildMonitoredTargetSetFromSession(session)];
  },

  async getMonitoredTargetSetForRun(runId: string) {
    const session = await loadSession();
    return session.runId === runId ? buildMonitoredTargetSetFromSession(session) : null;
  },

  async sendChatCommand(message: string) {
    const session = await loadSession();
    const userMessage: ChatMessage = {
      id: `chat_user_${Date.now()}`,
      role: "user",
      content: message,
      timestamp: nowIso(),
    };

    let nextSession = session;
    const lowered = message.toLowerCase();
    let submittedSites: string[] = [];

    if (lowered.includes("submit") || lowered.includes("removal")) {
      submittedSites = findSubmittableSites(session.workflowOutput).map((siteRun) => siteRun.site_input.site);
      const nextSiteRegistry = applyExecutionResults(cloneSiteRegistry(session.siteRegistry), session.workflowOutput.site_runs, submittedSites);
      const nextWorkflowOutput = await runWorkflowSession({
        runId: session.runId,
        requestedSites: session.requestedSites,
        seedProfile: session.seedProfile,
        siteRegistry: nextSiteRegistry,
      });

      nextSession = {
        ...session,
        siteRegistry: nextSiteRegistry,
        workflowOutput: nextWorkflowOutput,
      };
    } else if (lowered.includes("rescan")) {
      const nextWorkflowOutput = await runWorkflowSession({
        runId: session.runId,
        requestedSites: session.requestedSites,
        seedProfile: session.seedProfile,
        siteRegistry: cloneSiteRegistry(session.siteRegistry),
      });

      nextSession = {
        ...session,
        workflowOutput: nextWorkflowOutput,
      };
    }

    const assistantMessage: ChatMessage = {
      id: `chat_assistant_${Date.now()}`,
      role: "assistant",
      content: buildAssistantMessage(message, nextSession, submittedSites),
      timestamp: nowIso(),
    };

    const finalSession: RuntimeSession = {
      ...nextSession,
      chatMessages: [...nextSession.chatMessages, userMessage, assistantMessage],
    };

    sessionPromise = Promise.resolve(finalSession);

    return sendChatCommandResponseSchema.parse({
      message: chatMessageSchema.parse({
        id: assistantMessage.id,
        role: "assistant" satisfies AgentChatMessage["role"],
        content: assistantMessage.content,
        createdAt: assistantMessage.timestamp,
      }),
      run: buildAgentRunStateFromSession(finalSession, {
        currentPhase: "logging",
        status: "in_progress",
        updatedAt: assistantMessage.timestamp,
      }),
      events: [],
    });
  },

  async resetDemoSession() {
    sessionPromise = createInitialSession();
    await sessionPromise;
  },
};

export type { DashboardSnapshot };
