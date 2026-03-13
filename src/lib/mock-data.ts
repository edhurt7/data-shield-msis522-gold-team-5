import type { AgentRunState } from "@/lib/agent/contracts";
import { mockAgentRunState } from "@/lib/agent/mock-run";

export type ScanStatus = "scanning" | "found" | "not_found" | "opted_out" | "needs_review" | "blocked" | "failed";
export type HistoryStatus = "in_progress" | "completed" | "needs_attention";

export interface BrokerSite {
  id: string;
  name: string;
  url: string;
  status: ScanStatus;
  demoMetadata?: {
    isFixtureBacked?: boolean;
    manualFallbackReady?: boolean;
    outcomeLabel?: string;
    outcomeDetail?: string;
    captchaSession?: {
      sessionId: string;
      instruction: string;
      browserHint: string;
      updatedAt: string;
    };
  };
  foundData?: {
    fields: string[];
    optOutMessage?: string;
    failureReason?: string;
    manualFallback?: {
      packet: string;
      entryUrl?: string;
      inputs: Array<{
        key: string;
        label: string;
        value: string;
        description?: string;
      }>;
      recommendedNextStep?: string;
    };
    evidence?: {
      finalPageText?: string;
      htmlSnapshot?: string;
      screenshotBase64?: string;
      screenshotRef?: string;
      stepLog?: string;
    };
  };
}

export interface HistoryEntry {
  id: string;
  runId: string;
  date: string;
  scan: string;
  action: string;
  status: HistoryStatus;
  totalSites: number;
  foundSites: number;
  submittedSites: number;
  needsReviewSites: number;
  blockedSites: number;
  failedSites: number;
  sites: Array<{
    id: string;
    name: string;
    url: string;
    status: ScanStatus;
    action: string;
    fields?: string[];
  }>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export const BROKER_DIRECTORY = [
  { id: "spokeo", name: "Spokeo", url: "spokeo.com" },
  { id: "whitepages", name: "WhitePages", url: "whitepages.com" },
  { id: "truepeoplesearch", name: "TruePeopleSearch", url: "truepeoplesearch.com" },
  { id: "fastpeoplesearch", name: "FastPeopleSearch", url: "fastpeoplesearch.com" },
  { id: "radaris", name: "Radaris", url: "radaris.com" },
] as const;

function getSiteStatus(run: AgentRunState, siteId: string): ScanStatus {
  const outcome = run.outcomes.find((item) => item.siteId === siteId);
  if (outcome?.status === "needs_follow_up") {
    return "needs_review";
  }

  if (outcome && ["submitted", "confirmed"].includes(outcome.status)) {
    return "opted_out";
  }

  const failedEvent = run.timeline.find((event) => event.siteId === siteId && event.status === "failed");
  if (failedEvent) {
    return "failed";
  }

  const matchedSite = run.matchDecisions.find(
    (decision) => decision.siteId === siteId && decision.decision !== "no_match",
  );
  if (matchedSite) {
    return "found";
  }

  const activeScan = run.timeline.find(
    (event) => event.siteId === siteId && event.phase === "scan" && event.status === "in_progress",
  );
  if (activeScan) {
    return "scanning";
  }

  return "not_found";
}

function getSiteDetail(run: AgentRunState, siteId: string, status: ScanStatus) {
  const candidate = run.candidates.find((item) => item.siteId === siteId);
  const draft = run.drafts.find((item) => item.siteId === siteId);
  const failedEvent = run.timeline.find((event) => event.siteId === siteId && event.status === "failed");

  if (status === "failed" || status === "needs_review" || status === "blocked") {
    return {
      fields: candidate?.extractedFields.map((field) => field.field) ?? [],
      optOutMessage: draft?.body,
      failureReason: failedEvent?.message
        ?? (status === "blocked"
          ? "Destination site blocked the automated browser session."
          : status === "needs_review"
          ? "Automation needs manual review before this broker can be completed."
          : "Scan completed with a failure or manual follow-up required."),
    };
  }

  if (!candidate) return undefined;

  return {
    fields: candidate.extractedFields.map((field) => field.field),
    optOutMessage: draft?.body,
    failureReason: undefined,
  };
}

export function buildBrokerSites(run: AgentRunState): BrokerSite[] {
  return BROKER_DIRECTORY.map((site) => {
    const status = getSiteStatus(run, site.id);
    return {
      ...site,
      status,
      foundData: status !== "not_found" && status !== "scanning" ? getSiteDetail(run, site.id, status) : undefined,
    };
  });
}

function describeSiteHistoryAction(site: BrokerSite) {
  switch (site.status) {
    case "opted_out":
      return "Removal request submitted successfully.";
    case "needs_review":
      return "Automation paused and now needs manual review before submission can continue.";
    case "blocked":
      return "Destination site blocked automation. Evidence was captured so the opt-out can be completed manually.";
    case "found":
      return "Listing found and queued for removal review.";
    case "failed":
      return "Scan completed with a failure or manual follow-up required.";
    case "scanning":
      return "Scan is still in progress.";
    default:
      return "No matching listing found during this scan.";
  }
}

export function createScanHistoryEntry(input: {
  id: string;
  runId: string;
  date: string;
  scan: string;
  action: string;
  brokerSites: BrokerSite[];
}): HistoryEntry {
  const { brokerSites } = input;
  const summary = getScanSummary(brokerSites);
  const status: HistoryStatus = summary.scanning > 0
    ? "in_progress"
    : summary.failed > 0 || summary.needsReview > 0
      ? "needs_attention"
      : "completed";

  return {
    id: input.id,
    runId: input.runId,
    date: input.date,
    scan: input.scan,
    action: input.action,
    status,
    totalSites: summary.total,
    foundSites: summary.found,
    submittedSites: summary.optedOut,
    needsReviewSites: summary.needsReview,
    blockedSites: summary.blocked,
    failedSites: summary.failed,
    sites: brokerSites.map((site) => ({
      id: site.id,
      name: site.name,
      url: site.url,
      status: site.status,
      action: describeSiteHistoryAction(site),
      fields: site.foundData?.fields,
    })),
  };
}

export function buildHistoryEntries(run: AgentRunState): HistoryEntry[] {
  const brokerSites = buildBrokerSites(run);
  return [
    createScanHistoryEntry({
      id: `scan_${run.runId}`,
      runId: run.runId,
      date: run.updatedAt.slice(0, 10),
      scan: "Initial Scan",
      action: `Scanned ${brokerSites.length} configured data broker sites for the current session.`,
      brokerSites,
    }),
  ];
}

export function buildChatMessagesFromTimeline(run: AgentRunState): ChatMessage[] {
  return run.timeline
    .filter((event) => event.eventId.startsWith("evt_chat_"))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((event, index) => ({
      id: `chat_timeline_${index}`,
      role: "assistant" as const,
      content: event.message,
      timestamp: event.createdAt,
    }));
}

export const mockBrokerSites: BrokerSite[] = buildBrokerSites(mockAgentRunState);
export const mockHistory: HistoryEntry[] = buildHistoryEntries(mockAgentRunState);
export const mockChatMessages: ChatMessage[] = [
  ...buildChatMessagesFromTimeline(mockAgentRunState).slice(0, 1),
  {
    id: "c2",
    role: "user",
    content: "Yes, submit removals for Spokeo and WhitePages first.",
    timestamp: "2026-03-08T10:01:00.000Z",
  },
  ...buildChatMessagesFromTimeline(mockAgentRunState).slice(1),
];

export const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia",
  "Wisconsin", "Wyoming",
];

export function generateProxyEmail(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `shield-${code}@detraceme.io`;
}

export function getScanSummary(sites: BrokerSite[]) {
  return {
    total: sites.length,
    found: sites.filter((s) => s.status === "found").length,
    optedOut: sites.filter((s) => s.status === "opted_out").length,
    needsReview: sites.filter((s) => s.status === "needs_review").length,
    blocked: sites.filter((s) => s.status === "blocked").length,
    scanning: sites.filter((s) => s.status === "scanning").length,
    notFound: sites.filter((s) => s.status === "not_found").length,
    failed: sites.filter((s) => s.status === "failed").length,
  };
}
