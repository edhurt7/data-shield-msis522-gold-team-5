import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { mockAgentService } from "@/lib/agent/mock-service";
import type { DemoHarnessCaptchaSessionSnapshot, DemoHarnessRun } from "@/lib/automation/demo-harness";
import { prependSessionHistory } from "@/lib/session-history";
import type { BrokerSite, ChatMessage, HistoryEntry } from "@/lib/mock-data";

export const agentQueryKeys = {
  dashboard: ["agent", "dashboard"] as const,
  liveDemo: ["agent", "live-demo"] as const,
} as const;

const localDemoBaseUrl = "http://127.0.0.1:8787";
const demoScanDelayMs = 5000;

export interface LiveDemoSummary {
  browserMode: "fixture_confirmation" | "live_browser";
  runId: string;
  siteIds: string[];
  totalRuns: number;
  completedSites: string[];
}

export interface LiveDemoDashboardSnapshot {
  runId: string;
  brokerSites: BrokerSite[];
  history: HistoryEntry[];
  chatMessages: ChatMessage[];
}

export interface LiveDemoResponse {
  startedAt: string;
  completedAt: string;
  summary: LiveDemoSummary;
  runs: DemoHarnessRun[];
  dashboard: LiveDemoDashboardSnapshot;
  captchaSessions?: DemoHarnessCaptchaSessionSnapshot[];
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: unknown; message?: string };
  if (!response.ok) {
    throw new Error(
      typeof payload.message === "string"
        ? payload.message
        : typeof payload.error === "object"
          ? JSON.stringify(payload.error, null, 2)
          : `Local demo request failed with status ${response.status}.`,
    );
  }

  return payload;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useAgentDashboard() {
  return useQuery({
    queryKey: agentQueryKeys.dashboard,
    queryFn: () => mockAgentService.getDashboardSnapshot(),
  });
}

export function useAgentChat() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (message: string) => mockAgentService.sendChatCommand(message),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentQueryKeys.dashboard });
    },
  });
}

export function useLiveDemoStatus() {
  return useQuery({
    queryKey: agentQueryKeys.liveDemo,
    queryFn: async () => {
      const response = await fetch(`${localDemoBaseUrl}/demo/runs/latest`);
      return parseResponse<LiveDemoResponse>(response);
    },
    retry: false,
  });
}

export function useRunLiveDemo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (browserMode: LiveDemoSummary["browserMode"]) => {
      const response = await fetch(`${localDemoBaseUrl}/demo/runs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ browserMode }),
      });

      const payload = await parseResponse<LiveDemoResponse>(response);

      if (browserMode === "fixture_confirmation") {
        await delay(demoScanDelayMs);
      }

      return payload;
    },
    onSuccess: async (response) => {
      response.dashboard.history.forEach((entry) => {
        prependSessionHistory(entry);
      });

      await queryClient.invalidateQueries({ queryKey: agentQueryKeys.dashboard });
      await queryClient.invalidateQueries({ queryKey: agentQueryKeys.liveDemo });
    },
  });
}

export function useResumeCaptchaSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await fetch(`${localDemoBaseUrl}/demo/captcha-sessions/${sessionId}/resume`, {
        method: "POST",
      });

      return parseResponse<LiveDemoResponse>(response);
    },
    onSuccess: async (response) => {
      response.dashboard.history.forEach((entry) => {
        prependSessionHistory(entry);
      });

      await queryClient.invalidateQueries({ queryKey: agentQueryKeys.dashboard });
      await queryClient.invalidateQueries({ queryKey: agentQueryKeys.liveDemo });
    },
  });
}
