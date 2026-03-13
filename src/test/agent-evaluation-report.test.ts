import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { compareEvaluationReports, renderEvaluationTrendMarkdown, type EvaluationReport } from "@/lib/agent";
import { createBaselineEvaluationReport, baselineSuiteName } from "@/test/support/baseline-eval-suite";
import { describe, expect, it } from "vitest";

const reportsRoot = path.resolve(process.cwd(), "artifacts", "eval-reports", baselineSuiteName);

function formatTimestampForFile(timestamp: string) {
  return timestamp.replaceAll(":", "-").replaceAll(".", "-");
}

async function listSavedReportFiles() {
  if (!existsSync(reportsRoot)) {
    return [];
  }

  const entries = await readdir(reportsRoot, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "latest.json")
    .map((entry) => entry.name)
    .sort();
}

async function readSavedReport(filename: string): Promise<EvaluationReport> {
  const raw = await readFile(path.join(reportsRoot, filename), "utf8");
  return JSON.parse(raw) as EvaluationReport;
}

describe("agent evaluation reporting", () => {
  it("persists a baseline evaluation report and trend comparison", async () => {
    const previousFiles = await listSavedReportFiles();
    const previousLatestFile = previousFiles.at(-1);
    const previousReport = previousLatestFile ? await readSavedReport(previousLatestFile) : null;

    const report = await createBaselineEvaluationReport();
    const trend = compareEvaluationReports(report, previousReport);

    const timestamp = formatTimestampForFile(report.generated_at);
    const reportFilename = `${timestamp}__pass-${report.summary.passed_count}-of-${report.summary.scenario_count}.json`;
    const reportPath = path.join(reportsRoot, reportFilename);
    const latestPath = path.join(reportsRoot, "latest.json");
    const trendPath = path.join(reportsRoot, "latest-trend.md");

    await mkdir(reportsRoot, { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
    await writeFile(latestPath, JSON.stringify(report, null, 2), "utf8");
    await writeFile(trendPath, renderEvaluationTrendMarkdown(trend), "utf8");

    expect(existsSync(reportPath)).toBe(true);
    expect(existsSync(latestPath)).toBe(true);
    expect(existsSync(trendPath)).toBe(true);
    expect(report.summary.scenario_count).toBe(5);
    expect(report.summary.failed_count).toBe(0);
    expect(trend.suite).toBe(baselineSuiteName);
    expect(trend.previous_generated_at).toBe(previousReport?.generated_at ?? null);
  });
});
