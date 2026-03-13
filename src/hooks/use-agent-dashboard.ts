import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentApiClient } from "@/lib/agent/runtime";
import { useAuth } from "@/lib/auth-context";
import {
  buildBrokerSites,
  buildChatMessagesFromApi,
  buildHistoryEntries,
  type BrokerSite,
  type ChatMessage,
  type HistoryEntry,
} from "@/lib/mock-data";

export interface DashboardSnapshot {
  runId: string;
  brokerSites: BrokerSite[];
  history: HistoryEntry[];
  chatMessages: ChatMessage[];
}

export const agentQueryKeys = {
  runs: ["agent", "runs"] as const,
  run: (runId: string | null) => ["agent", "run", runId] as const,
  messages: (runId: string | null) => ["agent", "messages", runId] as const,
} as const;

async function buildDashboardSnapshot(runId: string): Promise<DashboardSnapshot> {
  const [runResponse, messagesResponse] = await Promise.all([
    agentApiClient.getRun(runId),
    agentApiClient.listChatMessages(runId),
  ]);

  const run = runResponse.run;
  return {
    runId: run.runId,
    brokerSites: buildBrokerSites(run),
    history: buildHistoryEntries(run),
    chatMessages: buildChatMessagesFromApi(messagesResponse.messages),
  };
}

export function useAgentDashboard() {
  const { user } = useAuth();
  const runId = user?.runId ?? null;

  return useQuery({
    queryKey: agentQueryKeys.run(runId),
    queryFn: () => buildDashboardSnapshot(runId ?? ""),
    enabled: Boolean(runId),
  });
}

export function useStartAgentRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: agentApiClient.startRun,
    onSuccess: async (response) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: agentQueryKeys.runs }),
        queryClient.invalidateQueries({ queryKey: agentQueryKeys.run(response.run.runId) }),
      ]);
    },
  });
}

export function useAgentChat() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const runId = user?.runId ?? null;

  return useMutation({
    mutationFn: async (message: string) => {
      if (!runId) {
        throw new Error("No active run.");
      }
      return agentApiClient.sendChatCommand(runId, { message });
    },
    onSuccess: async () => {
      if (!runId) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: agentQueryKeys.run(runId) }),
        queryClient.invalidateQueries({ queryKey: agentQueryKeys.messages(runId) }),
      ]);
    },
  });
}

export function useTriggerRescan() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const runId = user?.runId ?? null;

  return useMutation({
    mutationFn: async (reason?: string) => {
      if (!runId) {
        throw new Error("No active run.");
      }
      return agentApiClient.triggerRescan(runId, { siteIds: [], reason });
    },
    onSuccess: async () => {
      if (!runId) return;
      await queryClient.invalidateQueries({ queryKey: agentQueryKeys.run(runId) });
    },
  });
}
