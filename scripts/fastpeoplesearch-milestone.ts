import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { runFastPeopleSearchMilestone } from "@/lib/agent/milestone";

function readBrowserMode() {
  const value = process.env.AGENT_FPS_BROWSER_MODE?.trim().toLowerCase();
  return value === "live_browser" ? "live_browser" : "fixture_confirmation";
}

function toErrorDetails(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return {
      message: String(error),
    };
  }

  const details: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };

  const withCause = error as Error & { cause?: unknown };
  const withRawOutput = error as Error & { rawOutput?: unknown; promptName?: unknown; issues?: unknown };

  if (withRawOutput.promptName !== undefined) {
    details.promptName = withRawOutput.promptName;
  }
  if (withRawOutput.issues !== undefined) {
    details.issues = withRawOutput.issues;
  }
  if (withRawOutput.rawOutput !== undefined) {
    details.rawOutput = withRawOutput.rawOutput;
  }
  if (withCause.cause !== undefined) {
    details.cause = toErrorDetails(withCause.cause);
  }

  return details;
}

async function main() {
  const browserMode = readBrowserMode();
  const startedAt = new Date().toISOString();
  const result = await runFastPeopleSearchMilestone({
    env: process.env,
    browserMode,
  });
  const completedAt = new Date().toISOString();
  const outputPath = resolve(process.cwd(), "artifacts", "milestones", "fastpeoplesearch-latest.json");

  await mkdir(resolve(process.cwd(), "artifacts", "milestones"), { recursive: true });
  await writeFile(outputPath, JSON.stringify({
    startedAt,
    completedAt,
    summary: result.summary,
    output: result.output,
  }, null, 2));

  console.log(JSON.stringify({
    status: "ok",
    outputPath,
    summary: result.summary,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "error",
    error: toErrorDetails(error),
  }, null, 2));
  process.exitCode = 1;
});
