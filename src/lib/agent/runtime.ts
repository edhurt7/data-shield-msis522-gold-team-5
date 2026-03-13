import { createAgentApiClient } from "@/lib/agent/client";

function isLocalBrowserHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function resolveAgentApiBaseUrl() {
  const configured = (import.meta.env.VITE_AGENT_API_BASE_URL as string | undefined)?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (import.meta.env.DEV) {
    return "http://127.0.0.1:8000";
  }

  if (typeof window !== "undefined" && isLocalBrowserHost(window.location.hostname)) {
    return "http://127.0.0.1:8000";
  }

  return "";
}

export const agentApiBaseUrl = resolveAgentApiBaseUrl();
export const agentApiConfigError = agentApiBaseUrl
  ? null
  : "Missing VITE_AGENT_API_BASE_URL. For a Lovable-hosted frontend, set it to your deployed FastAPI backend URL.";

export const agentApiClient = createAgentApiClient({
  baseUrl: agentApiBaseUrl,
});
