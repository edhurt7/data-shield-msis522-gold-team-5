import {
  createRunResponseSchema,
  getRunResponseSchema,
  sendChatCommandResponseSchema,
  type ChatMessage,
} from "@/lib/agent/api";
import { mockAgentRunState } from "@/lib/agent/mock-run";
import { buildChatMessagesFromTimeline, buildBrokerSites, buildHistoryEntries, createScanHistoryEntry, type BrokerSite, type HistoryEntry } from "@/lib/mock-data";
import { getSessionHistory, prependSessionHistory } from "@/lib/session-history";

interface DashboardSnapshot {
  runId: string;
  brokerSites: BrokerSite[];
  history: HistoryEntry[];
  chatMessages: import("@/lib/mock-data").ChatMessage[];
}

let runState = structuredClone(mockAgentRunState);
let chatMessages: import("@/lib/mock-data").ChatMessage[] = [
  ...buildChatMessagesFromTimeline(runState).slice(0, 1),
  {
    id: "chat_user_seed",
    role: "user",
    content: "Yes, submit removals for Spokeo and WhitePages first.",
    timestamp: "2026-03-08T10:01:00.000Z",
  },
  {
    id: "chat_assistant_seed",
    role: "assistant",
    content: buildChatMessagesFromTimeline(runState).slice(1)[0]?.content ?? "Drafts are ready for review.",
    timestamp: buildChatMessagesFromTimeline(runState).slice(1)[0]?.timestamp ?? runState.updatedAt,
  },
];

function nextTimestamp() {
  return new Date().toISOString();
}

function buildAssistantReply(message: string) {
  const lowered = message.toLowerCase();

  if (lowered.includes("rescan")) {
    return "Re-scanning all broker sites now. I will flag anything that needs review.";
  }

  if (lowered.includes("submit") || lowered.includes("removal")) {
    return "I queued the selected removals for review. You can inspect the drafted requests in the listing detail panel.";
  }

  if (lowered.includes("status") || lowered.includes("progress")) {
    return "The current run is waiting on approval, with 4 listings found and 2 removals already confirmed.";
  }

  return "I logged that request and kept the run in review mode until the backend agent is connected.";
}

function buildSnapshot(): DashboardSnapshot {
  const brokerSites = buildBrokerSites(runState);
  const fallbackHistory = buildHistoryEntries(runState);

  return {
    runId: runState.runId,
    brokerSites,
    history: getSessionHistory(fallbackHistory),
    chatMessages,
  };
}

function delay(ms = 150) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const mockAgentService = {
  async getDashboardSnapshot() {
    await delay();
    return buildSnapshot();
  },

  async getRun() {
    await delay();
    return getRunResponseSchema.parse({ run: runState });
  },

  async createRun() {
    await delay();
    return createRunResponseSchema.parse({ run: runState });
  },

  async sendChatCommand(message: string) {
    await delay();

    const userMessage = {
      id: `chat_user_${Date.now()}`,
      role: "user" as const,
      content: message,
      timestamp: nextTimestamp(),
    };

    const assistantMessage = {
      id: `chat_assistant_${Date.now()}`,
      role: "assistant" as const,
      content: buildAssistantReply(message),
      timestamp: nextTimestamp(),
    };

    chatMessages = [...chatMessages, userMessage, assistantMessage];
    runState = {
      ...runState,
      updatedAt: assistantMessage.timestamp,
    };

    if (message.toLowerCase().includes("rescan")) {
      prependSessionHistory(
        createScanHistoryEntry({
          id: `scan_${runState.runId}_${Date.now()}`,
          runId: runState.runId,
          date: assistantMessage.timestamp.slice(0, 10),
          scan: "Rescan",
          action: `Rescanned ${buildBrokerSites(runState).length} configured data broker sites during this session.`,
          brokerSites: buildBrokerSites(runState),
        }),
      );
    }

    return sendChatCommandResponseSchema.parse({
      message: {
        id: assistantMessage.id,
        role: "assistant" satisfies ChatMessage["role"],
        content: assistantMessage.content,
        createdAt: assistantMessage.timestamp,
      },
      run: runState,
      events: [],
    });
  },
};
