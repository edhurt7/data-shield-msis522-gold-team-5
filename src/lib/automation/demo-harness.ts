import type { ActionHandoff, ProcedureStep } from "@/lib/agent/contracts";

import { executeAutomation } from "@/lib/automation/runner";
import type { AutomationBrowser, AutomationExecutionRecord, AutomationPage } from "@/lib/automation/types";
import { BROKER_DIRECTORY, createScanHistoryEntry, type BrokerSite, type ChatMessage, type HistoryEntry } from "@/lib/mock-data";

export type DemoHarnessBrowserMode =
  | "fixture_confirmation"
  | "live_browser";

export type DemoHarnessSiteId =
  | "fastpeoplesearch"
  | "spokeo"
  | "whitepages"
  | "truepeoplesearch"
  | "radaris";

export interface DemoHarnessRunSummary {
  browserMode: DemoHarnessBrowserMode;
  usedFixtureBrowser: boolean;
  site: string;
  siteId: DemoHarnessSiteId;
  runId: string;
  procedureType: string | null;
  draftChannel: string | null;
  handoffMode: string | null;
  automationStatus: string | null;
  manualReviewRequired: boolean | null;
  terminalPath: string | null;
  interpretResult: {
    next_status: string;
    next_action: string;
    review_reasons: string[];
  } | null;
}

export interface DemoHarnessRun {
  siteId: DemoHarnessSiteId;
  siteName: string;
  handoff: ActionHandoff;
  automationRecord: AutomationExecutionRecord;
  summary: DemoHarnessRunSummary;
}

export interface DemoHarnessCaptchaSessionSnapshot {
  sessionId: string;
  runId: string;
  siteId: DemoHarnessSiteId;
  siteName: string;
  createdAt: string;
  updatedAt: string;
  instruction: string;
  browserHint: string;
  screenshotBase64?: string;
  pageText?: string;
}

export interface DemoHarnessDashboardSnapshot {
  runId: string;
  brokerSites: BrokerSite[];
  history: HistoryEntry[];
  chatMessages: ChatMessage[];
}

export interface DemoHarnessBatchSummary {
  runId: string;
  browserMode: DemoHarnessBrowserMode;
  siteIds: DemoHarnessSiteId[];
  totalRuns: number;
  completedSites: string[];
}

export interface DemoHarnessBatchResult {
  startedAt: string;
  completedAt: string;
  summary: DemoHarnessBatchSummary;
  runs: DemoHarnessRun[];
  dashboard: DemoHarnessDashboardSnapshot;
  captchaSessions?: DemoHarnessCaptchaSessionSnapshot[];
}

const defaultNow = () => new Date();

class ConfirmationPage implements AutomationPage {
  readonly operations: string[] = [];

  constructor(private readonly pageText: string) {}

  async goto(url: string) {
    this.operations.push(`goto:${url}`);
  }

  async fill(selector: string, value: string) {
    this.operations.push(`fill:${selector}=${value}`);
  }

  async selectOption(selector: string, value: string | string[]) {
    this.operations.push(`select:${selector}=${Array.isArray(value) ? value.join("|") : value}`);
  }

  async click(selector: string) {
    this.operations.push(`click:${selector}`);
  }

  async waitForTimeout(timeout: number) {
    this.operations.push(`wait:${timeout}`);
  }

  async content() {
    return `<html><body>${this.pageText}</body></html>`;
  }

  async innerText(selector: string) {
    return selector === "body" ? this.pageText : null;
  }

  async screenshot() {
    return Buffer.from("demo-harness-shot");
  }

  async close() {
    this.operations.push("close:page");
  }
}

class ConfirmationBrowser implements AutomationBrowser {
  constructor(private readonly page: ConfirmationPage) {}

  async newPage() {
    return this.page;
  }

  async close() {
    return;
  }
}

function createFixtureBrowser(confirmationText: string) {
  return new ConfirmationBrowser(new ConfirmationPage(confirmationText));
}

const placeholderStep: ProcedureStep = {
  stepId: "placeholder",
  action: "manual_review",
  instruction: "This step list should be replaced by the site adapter.",
};

const demoProfile = {
  fullName: "Antonyo West",
  age: "35",
  address: "3910 Riverfront BLVD A502",
  previousCity: "Mill Creek",
  phone: "202-677-0811",
  privacyEmail: "atw3@uw.edu",
  cityState: "Seattle, Washington",
  state: "Washington",
} as const;

const demoSiteDefinitions = {
  fastpeoplesearch: {
    siteName: "FastPeopleSearch",
    submissionChannel: "webform",
    candidateUrl: "https://fastpeoplesearch.test/listing/antonyo-west-seattle-wa",
    confirmationText: "Your removal request has been received and is pending review.",
    fields: {
      full_name: demoProfile.fullName,
      age: demoProfile.age,
      address: demoProfile.address,
      previous_city: demoProfile.previousCity,
      phone: demoProfile.phone,
      privacy_email: demoProfile.privacyEmail,
      state: demoProfile.state,
      candidate_url: "https://fastpeoplesearch.test/listing/antonyo-west-seattle-wa",
    },
    draftBody: "Please remove my FastPeopleSearch listing.",
  },
  spokeo: {
    siteName: "Spokeo",
    submissionChannel: "webform",
    candidateUrl: "https://www.spokeo.com/Antonyo-West/Seattle-WA/p3910riverfronta502",
    confirmationText: "Check your inbox for a confirmation email to complete your Spokeo opt out.",
    fields: {
      full_name: demoProfile.fullName,
      age: demoProfile.age,
      address: demoProfile.address,
      previous_city: demoProfile.previousCity,
      phone: demoProfile.phone,
      listing_url: "https://www.spokeo.com/Antonyo-West/Seattle-WA/p3910riverfronta502",
      privacy_email: demoProfile.privacyEmail,
      candidate_url: "https://www.spokeo.com/Antonyo-West/Seattle-WA/p3910riverfronta502",
    },
    draftBody: "Please remove my Spokeo listing.",
  },
  whitepages: {
    siteName: "WhitePages",
    submissionChannel: "webform",
    candidateUrl: "https://www.whitepages.com/name/Antonyo-West/Seattle-WA/3910RiverfrontA502",
    confirmationText: "Check your email for a verification email to complete your WhitePages suppression request.",
    fields: {
      full_name: demoProfile.fullName,
      age: demoProfile.age,
      address: demoProfile.address,
      previous_city: demoProfile.previousCity,
      phone: demoProfile.phone,
      listing_url: "https://www.whitepages.com/name/Antonyo-West/Seattle-WA/3910RiverfrontA502",
      privacy_email: demoProfile.privacyEmail,
      candidate_url: "https://www.whitepages.com/name/Antonyo-West/Seattle-WA/3910RiverfrontA502",
    },
    draftBody: "Please remove my WhitePages listing.",
  },
  truepeoplesearch: {
    siteName: "TruePeopleSearch",
    submissionChannel: "webform",
    candidateUrl: "https://www.truepeoplesearch.com/find/person/Antonyo-West/Seattle-WA",
    confirmationText: "Check your inbox for an email confirmation to complete the TruePeopleSearch removal request.",
    fields: {
      full_name: demoProfile.fullName,
      age: demoProfile.age,
      address: demoProfile.address,
      previous_city: demoProfile.previousCity,
      phone: demoProfile.phone,
      privacy_email: demoProfile.privacyEmail,
      city_state: demoProfile.cityState,
      candidate_url: "https://www.truepeoplesearch.com/find/person/Antonyo-West/Seattle-WA",
    },
    draftBody: "Please remove my TruePeopleSearch listing.",
  },
  radaris: {
    siteName: "Radaris",
    submissionChannel: "email",
    candidateUrl: "https://radaris.com/p/Antonyo-West/Seattle-WA",
    confirmationText: "",
    fields: {
      full_name: demoProfile.fullName,
      age: demoProfile.age,
      address: demoProfile.address,
      previous_city: demoProfile.previousCity,
      phone: demoProfile.phone,
      privacy_email: demoProfile.privacyEmail,
      candidate_url: "https://radaris.com/p/Antonyo-West/Seattle-WA",
    },
    draftBody: "Please remove my Radaris listing and suppress the linked profile.",
  },
} as const satisfies Record<DemoHarnessSiteId, {
  siteName: string;
  submissionChannel: "webform" | "email";
  candidateUrl: string;
  confirmationText: string;
  fields: Record<string, string>;
  draftBody: string;
}>;

export const demoHarnessSiteIds = Object.keys(demoSiteDefinitions) as DemoHarnessSiteId[];

function createDemoHandoff(siteId: DemoHarnessSiteId, runId: string, now: () => Date): ActionHandoff {
  const definition = demoSiteDefinitions[siteId];
  const createdAt = now().toISOString();

  return {
    handoffId: `${siteId}_${runId}`,
    mode: "auto",
    requiresUserApproval: false,
    reviewReasons: [],
    createdAt,
    payload: {
      siteId: definition.siteName,
      candidateId: `${siteId}_candidate_001`,
      procedureId: `${siteId}_procedure_v1`,
      procedureVersion: "v1",
      submissionChannel: definition.submissionChannel,
      fields: definition.fields,
      steps: [placeholderStep],
      draft: {
        draftId: `${siteId}_draft_001`,
        siteId: definition.siteName,
        candidateId: `${siteId}_candidate_001`,
        submissionChannel: definition.submissionChannel,
        subject: `${definition.siteName} removal request`,
        body: definition.draftBody,
        factsUsed: [{ field: "full_name", value: definition.fields.full_name ?? demoProfile.fullName }],
        procedureId: `${siteId}_procedure_v1`,
        generatedAt: createdAt,
      },
    },
  };
}

function toInterpretResult(record: AutomationExecutionRecord) {
  if (record.executionResult.status === "pending" || record.executionResult.status === "submitted") {
    return {
      next_status: "pending",
      next_action: "await_confirmation",
      review_reasons: record.evidence.reviewReasons,
    };
  }

  if (record.executionResult.status === "manual_required") {
    return {
      next_status: "needs_review",
      next_action: "request_user_review",
      review_reasons: record.evidence.reviewReasons,
    };
  }

  return {
    next_status: "failed",
    next_action: "retry_submission",
    review_reasons: record.evidence.reviewReasons,
  };
}

function toTerminalPath(record: AutomationExecutionRecord) {
  switch (record.executionResult.status) {
    case "pending":
    case "submitted":
      return "await_confirmation";
    case "manual_required":
      return "manual_review_required";
    default:
      return "submission_failed";
  }
}

export function summarizeDemoHarnessRun(
  siteId: DemoHarnessSiteId,
  runId: string,
  browserMode: DemoHarnessBrowserMode,
  handoff: ActionHandoff,
  record: AutomationExecutionRecord,
): DemoHarnessRunSummary {
  return {
    browserMode,
    usedFixtureBrowser: browserMode === "fixture_confirmation" || handoff.payload.submissionChannel === "email",
    site: handoff.payload.siteId,
    siteId,
    runId,
    procedureType: handoff.payload.submissionChannel,
    draftChannel: handoff.payload.draft.submissionChannel,
    handoffMode: handoff.mode,
    automationStatus: record.executionResult.status,
    manualReviewRequired: record.executionResult.manual_review_required,
    terminalPath: toTerminalPath(record),
    interpretResult: toInterpretResult(record),
  };
}

function buildBrokerSites(runs: DemoHarnessRun[]): BrokerSite[] {
  const byId = new Map(runs.map((run) => [run.siteId, run]));

  return BROKER_DIRECTORY.map((site) => {
    const run = byId.get(site.id as DemoHarnessSiteId);

    if (!run) {
      return {
        ...site,
        status: "not_found",
      };
    }

    const blockedBySite = run.automationRecord.evidence.failureCode === "rate_limited";

    const status = run.automationRecord.executionResult.status === "pending"
      || run.automationRecord.executionResult.status === "submitted"
      ? "opted_out"
      : blockedBySite
        ? "blocked"
      : run.automationRecord.executionResult.status === "manual_required"
        ? "needs_review"
        : run.automationRecord.executionResult.status === "failed"
        ? "failed"
        : "not_found";

    const foundDataFields = Object.keys(run.handoff.payload.fields)
      .filter((field) => field !== "candidate_url");

    return {
      ...site,
      status,
      foundData: {
        fields: foundDataFields,
        optOutMessage: run.automationRecord.executionResult.confirmation_text
          ?? run.automationRecord.executionResult.error_text
          ?? undefined,
        failureReason: status === "failed" || status === "needs_review" || status === "blocked"
          ? run.automationRecord.executionResult.error_text
            ?? (blockedBySite
              ? "Destination site blocked the automated browser session."
              : status === "needs_review"
              ? "Automation needs manual review before this broker can be completed."
              : "Scan completed with a failure or manual follow-up required.")
          : undefined,
      },
    };
  });
}

function buildHistoryEntries(runs: DemoHarnessRun[], completedAt: string): HistoryEntry[] {
  const brokerSites = buildBrokerSites(runs);
  return [
    createScanHistoryEntry({
      id: `scan_demo_${runs[0]?.summary.runId ?? completedAt}`,
      runId: runs[0]?.summary.runId ?? `demo_${completedAt}`,
      date: completedAt.slice(0, 10),
      scan: "Live Demo Scan",
      action: `Ran the prototype scan across ${brokerSites.length} sites using the demo harness.`,
      brokerSites,
    }),
  ];
}

function buildChatMessages(runs: DemoHarnessRun[], completedAt: string): ChatMessage[] {
  return runs.map((run) => ({
    id: `demo_${run.siteId}_${run.summary.runId}`,
    role: "assistant",
    content: `${run.siteName} finished with ${run.summary.automationStatus}. Next action: ${run.summary.interpretResult?.next_action ?? "n/a"}.`,
    timestamp: completedAt,
  }));
}

export async function runDemoSiteHarness(input: {
  siteId: DemoHarnessSiteId;
  browserMode?: DemoHarnessBrowserMode;
  now?: () => Date;
  browser?: AutomationBrowser;
}): Promise<DemoHarnessRun> {
  const now = input.now ?? defaultNow;
  const browserMode = input.browserMode ?? "fixture_confirmation";
  const runId = `run_demo_${input.siteId}_${now().getTime()}`;
  const definition = demoSiteDefinitions[input.siteId];
  const handoff = createDemoHandoff(input.siteId, runId, now);
  const browser = handoff.payload.submissionChannel === "webform" && browserMode === "fixture_confirmation"
    ? createFixtureBrowser(definition.confirmationText)
    : input.browser;
  const automationRecord = await executeAutomation(handoff, {
    browser,
    now,
  });

  return {
    siteId: input.siteId,
    siteName: definition.siteName,
    handoff,
    automationRecord,
    summary: summarizeDemoHarnessRun(input.siteId, runId, browserMode, handoff, automationRecord),
  };
}

export function buildDemoHarnessDashboardSnapshot(
  runs: DemoHarnessRun[],
  completedAt: string,
  runId = runs[0]?.summary.runId ?? `demo_${completedAt}`,
): DemoHarnessDashboardSnapshot {
  return {
    runId,
    brokerSites: buildBrokerSites(runs),
    history: buildHistoryEntries(runs, completedAt),
    chatMessages: buildChatMessages(runs, completedAt),
  };
}

export async function runDemoHarness(input: {
  siteIds?: DemoHarnessSiteId[];
  browserMode?: DemoHarnessBrowserMode;
  now?: () => Date;
  resolveBrowser?: (siteId: DemoHarnessSiteId, browserMode: DemoHarnessBrowserMode) => Promise<AutomationBrowser | undefined> | AutomationBrowser | undefined;
} = {}): Promise<DemoHarnessBatchResult> {
  const now = input.now ?? defaultNow;
  const browserMode = input.browserMode ?? "fixture_confirmation";
  const siteIds = input.siteIds ?? demoHarnessSiteIds;
  const startedAt = now().toISOString();
  const runs: DemoHarnessRun[] = [];

  for (const siteId of siteIds) {
    runs.push(await runDemoSiteHarness({
      siteId,
      browserMode,
      now,
      browser: await input.resolveBrowser?.(siteId, browserMode),
    }));
  }

  const completedAt = now().toISOString();
  const runId = `run_demo_batch_${now().getTime()}`;

  return {
    startedAt,
    completedAt,
    summary: {
      runId,
      browserMode,
      siteIds,
      totalRuns: runs.length,
      completedSites: runs.map((run) => run.siteName),
    },
    runs,
    dashboard: buildDemoHarnessDashboardSnapshot(runs, completedAt, runId),
  };
}
