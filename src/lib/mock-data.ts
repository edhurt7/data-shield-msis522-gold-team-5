import type { AgentRunState } from "@/lib/agent";
import type { ChatMessage as ApiChatMessage } from "@/lib/agent/api";
import { mockAgentRunState } from "@/lib/agent/mock-run";

export type ScanStatus = "scanning" | "found" | "not_found" | "opted_out" | "failed";
export type HistoryStatus = "pending" | "confirmed" | "re_listed";

export interface BrokerSite {
  id: string;
  name: string;
  url: string;
  status: ScanStatus;
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
  };
  action?: string;
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
}

export interface HistoryEntry {
  id: string;
  date: string;
  site: string;
  action: string;
  status: HistoryStatus;
  scan?: string;
  runId?: string;
  totalSites?: number;
  foundSites?: number;
  submittedSites?: number;
  blockedSites?: number;
  sites?: BrokerSite[];
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
  { id: "beenverified", name: "BeenVerified", url: "beenverified.com" },
  { id: "intelius", name: "Intelius", url: "intelius.com" },
  { id: "peoplefinder", name: "PeopleFinder", url: "peoplefinder.com" },
  { id: "truepeoplesearch", name: "TruePeopleSearch", url: "truepeoplesearch.com" },
  { id: "fastpeoplesearch", name: "FastPeopleSearch", url: "fastpeoplesearch.com" },
  { id: "thatsthem", name: "ThatsThem", url: "thatsthem.com" },
  { id: "radaris", name: "Radaris", url: "radaris.com" },
  { id: "ussearch", name: "USSearch", url: "ussearch.com" },
  { id: "pipl", name: "Pipl", url: "pipl.com" },
  { id: "zabasearch", name: "ZabaSearch", url: "zabasearch.com" },
] as const;

function getSiteStatus(run: AgentRunState, siteId: string): ScanStatus {
  const outcome = run.outcomes.find((item) => item.siteId === siteId);
  if (outcome && ["submitted", "confirmed", "needs_follow_up"].includes(outcome.status)) {
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

function getFoundData(run: AgentRunState, siteId: string) {
  const candidate = run.candidates.find((item) => item.siteId === siteId);
  const draft = run.drafts.find((item) => item.siteId === siteId);

  if (!candidate) return undefined;

  return {
    fields: candidate.extractedFields.map((field) => field.field),
    optOutMessage: draft?.body,
  };
}

export function buildBrokerSites(run: AgentRunState): BrokerSite[] {
  return BROKER_DIRECTORY.map((site) => {
    const status = getSiteStatus(run, site.id);
    return {
      ...site,
      status,
      action: run.timeline.find((event) => event.siteId === site.id)?.message ?? "No activity recorded yet.",
      foundData: status === "found" ? getFoundData(run, site.id) : undefined,
    };
  });
}

export function buildHistoryEntries(run: AgentRunState): HistoryEntry[] {
  const sites = buildBrokerSites(run);
  const summary = getScanSummary(sites);
  const eventEntries = run.timeline
    .filter((event) => event.siteId)
    .map((event) => {
      const action = event.message;
      let status: HistoryStatus = "pending";

      if (action.includes("re-listed")) {
        status = "re_listed";
      } else if (
        event.status === "completed" ||
        action.includes("not found") ||
        action.includes("Opt-out submitted")
      ) {
        status = "confirmed";
      }

      return {
        id: event.eventId,
        date: event.createdAt.slice(0, 10),
        site: BROKER_DIRECTORY.find((site) => site.id === event.siteId)?.name ?? event.siteId ?? "Unknown",
        scan: `Scan ${run.runId.slice(-6)}`,
        runId: run.runId,
        totalSites: summary.total,
        foundSites: summary.found,
        submittedSites: summary.optedOut,
        blockedSites: summary.failed,
        sites,
        action,
        status,
      };
    });

  return eventEntries.sort((a, b) => b.date.localeCompare(a.date));
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

export function buildChatMessagesFromApi(messages: ApiChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role === "system" ? "assistant" : message.role,
    content: message.content,
    timestamp: message.createdAt,
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
    scanning: sites.filter((s) => s.status === "scanning").length,
    notFound: sites.filter((s) => s.status === "not_found").length,
    failed: sites.filter((s) => s.status === "failed").length,
  };
}
