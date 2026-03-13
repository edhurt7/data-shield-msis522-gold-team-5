import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { runFastPeopleSearchMilestone } from "@/lib/agent/milestone";
import { BROKER_DIRECTORY, type BrokerSite, type ChatMessage, type HistoryEntry } from "@/lib/mock-data";

const PORT = Number.parseInt(process.env.AGENT_DEMO_SERVER_PORT ?? "8787", 10);
const latestResultPath = resolve(process.cwd(), "artifacts", "milestones", "fastpeoplesearch-latest.json");

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];

    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => {
      resolveBody(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

function toErrorDetails(error) {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  const details = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };

  if ("promptName" in error) {
    details.promptName = error.promptName;
  }
  if ("issues" in error) {
    details.issues = error.issues;
  }
  if ("rawOutput" in error) {
    details.rawOutput = error.rawOutput;
  }
  if ("cause" in error && error.cause !== undefined) {
    details.cause = toErrorDetails(error.cause);
  }

  return details;
}

function buildFastPeopleSearchDemoSite(output): BrokerSite {
  const candidate = output.discovery_parse.candidates?.[0];
  const fields = candidate
    ? [
      candidate.extracted.name ? "name" : null,
      candidate.extracted.age ? "age" : null,
      ...candidate.extracted.addresses.map(() => "address"),
      ...candidate.extracted.relatives.map(() => "relative"),
      ...candidate.extracted.phones.map(() => "phone"),
    ].filter(Boolean)
    : [];
  const status = output.automation_record?.executionResult.status === "pending"
    || output.automation_record?.executionResult.status === "submitted"
    ? "opted_out"
    : output.automation_record?.executionResult.status === "manual_required"
      || output.automation_record?.executionResult.status === "failed"
      ? "failed"
      : output.discovery_parse.found
        ? "found"
        : "not_found";

  return {
    id: "fastpeoplesearch",
    name: "FastPeopleSearch",
    url: "fastpeoplesearch.com",
    status,
    foundData: {
      fields,
      optOutMessage: output.draft_optout?.email?.body
        ?? output.draft_optout?.webform?.fields.map((field) => `${field.name}: ${field.value}`).join("\n")
        ?? output.automation_record?.executionResult.confirmation_text
        ?? output.interpret_result?.next_action
        ?? undefined,
    },
  };
}

function buildDemoSites(output): BrokerSite[] {
  const fastPeopleSearch = buildFastPeopleSearchDemoSite(output);

  return BROKER_DIRECTORY.map((site) => {
    if (site.id === "fastpeoplesearch") {
      return fastPeopleSearch;
    }

    return {
      ...site,
      status: "not_found",
    };
  });
}

function buildDemoHistory(startedAt: string, summary): HistoryEntry[] {
  return [{
    id: summary.runId,
    date: startedAt.slice(0, 10),
    site: summary.site,
    action: `Demo run completed with ${summary.automationStatus ?? "unknown"} status via ${summary.browserMode}.`,
    status: summary.automationStatus === "pending" || summary.automationStatus === "submitted" ? "confirmed" : "pending",
  }];
}

function buildDemoChat(startedAt: string, summary): ChatMessage[] {
  return [{
    id: `demo_${summary.runId}`,
    role: "assistant",
    content: summary.browserMode === "fixture_confirmation"
      ? `Live LLM workflow completed for ${summary.site}. The local success path reached ${summary.automationStatus} and is awaiting confirmation.`
      : `Live browser attempt completed for ${summary.site}. The workflow ended at ${summary.terminalPath} with next action ${summary.interpretResult?.next_action ?? "n/a"}.`,
    timestamp: startedAt,
  }];
}

function buildPayload(startedAt: string, completedAt: string, result) {
  return {
    startedAt,
    completedAt,
    summary: result.summary,
    output: result.output,
    dashboard: {
      runId: result.summary.runId,
      brokerSites: buildDemoSites(result.output),
      history: buildDemoHistory(startedAt, result.summary),
      chatMessages: buildDemoChat(completedAt, result.summary),
    },
  };
}

const server = createServer(async (request, response) => {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);

  if (method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    response.end();
    return;
  }

  if (method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok", port: PORT });
    return;
  }

  if (method === "GET" && url.pathname === "/demo/run-fastpeoplesearch/latest") {
    try {
      const raw = await readFile(latestResultPath, "utf8");
      sendJson(response, 200, JSON.parse(raw));
    } catch {
      sendJson(response, 404, {
        status: "missing",
        message: "No FastPeopleSearch demo run has been recorded yet.",
      });
    }
    return;
  }

  if (method === "POST" && url.pathname === "/demo/run-fastpeoplesearch") {
    try {
      const rawBody = await readRequestBody(request);
      const parsedBody = rawBody.trim().length > 0 ? JSON.parse(rawBody) : {};
      const browserMode = parsedBody.browserMode === "live_browser" ? "live_browser" : "fixture_confirmation";
      const startedAt = new Date().toISOString();
      const result = await runFastPeopleSearchMilestone({
        env: process.env,
        browserMode,
      });
      const completedAt = new Date().toISOString();
      const payload = buildPayload(startedAt, completedAt, result);

      await mkdir(resolve(process.cwd(), "artifacts", "milestones"), { recursive: true });
      await writeFile(latestResultPath, JSON.stringify(payload, null, 2));

      sendJson(response, 200, payload);
    } catch (error) {
      sendJson(response, 500, {
        status: "error",
        error: toErrorDetails(error),
      });
    }
    return;
  }

  sendJson(response, 404, {
    status: "not_found",
    path: url.pathname,
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`demo server listening on http://127.0.0.1:${PORT}`);
});
