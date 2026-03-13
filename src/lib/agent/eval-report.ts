import { z } from "zod";

const evaluationChecksSchema = z.record(z.string(), z.boolean());

export const evaluationScenarioReportSchema = z.object({
  scenario_id: z.string().min(1),
  suite: z.string().min(1),
  label: z.string().min(1),
  site: z.string().min(1),
  evaluation_type: z.enum([
    "golden_path",
    "review_fallback",
    "no_grounding_fallback",
    "draft_quality",
    "execution_interpretation",
  ]),
  passed: z.boolean(),
  checks: evaluationChecksSchema,
  terminal_path: z.string().nullable(),
  review_reasons: z.array(z.string()).default([]),
  metrics: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});

export const evaluationReportSchema = z.object({
  schema_version: z.literal(1),
  suite: z.string().min(1),
  generated_at: z.string().datetime(),
  summary: z.object({
    scenario_count: z.number().int().nonnegative(),
    passed_count: z.number().int().nonnegative(),
    failed_count: z.number().int().nonnegative(),
    pass_rate: z.number().min(0).max(1),
  }),
  scenarios: z.array(evaluationScenarioReportSchema).min(1),
});

export const evaluationScenarioTrendSchema = z.object({
  scenario_id: z.string().min(1),
  status: z.enum(["new", "removed", "improved", "regressed", "unchanged"]),
  current_passed: z.boolean().nullable(),
  previous_passed: z.boolean().nullable(),
  changed_checks: z.array(z.string()),
});

export const evaluationReportTrendSchema = z.object({
  suite: z.string().min(1),
  current_generated_at: z.string().datetime(),
  previous_generated_at: z.string().datetime().nullable(),
  summary: z.object({
    current_pass_rate: z.number().min(0).max(1),
    previous_pass_rate: z.number().min(0).max(1).nullable(),
    pass_rate_delta: z.number().nullable(),
    improved_scenarios: z.number().int().nonnegative(),
    regressed_scenarios: z.number().int().nonnegative(),
    unchanged_scenarios: z.number().int().nonnegative(),
    new_scenarios: z.number().int().nonnegative(),
    removed_scenarios: z.number().int().nonnegative(),
  }),
  scenarios: z.array(evaluationScenarioTrendSchema),
});

export type EvaluationScenarioReport = z.infer<typeof evaluationScenarioReportSchema>;
export type EvaluationReport = z.infer<typeof evaluationReportSchema>;
export type EvaluationScenarioTrend = z.infer<typeof evaluationScenarioTrendSchema>;
export type EvaluationReportTrend = z.infer<typeof evaluationReportTrendSchema>;

export function createEvaluationReport(input: {
  suite: string;
  generatedAt?: string;
  scenarios: EvaluationScenarioReport[];
}): EvaluationReport {
  const scenarioCount = input.scenarios.length;
  const passedCount = input.scenarios.filter((scenario) => scenario.passed).length;
  const failedCount = scenarioCount - passedCount;

  return evaluationReportSchema.parse({
    schema_version: 1,
    suite: input.suite,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    summary: {
      scenario_count: scenarioCount,
      passed_count: passedCount,
      failed_count: failedCount,
      pass_rate: scenarioCount === 0 ? 0 : passedCount / scenarioCount,
    },
    scenarios: input.scenarios,
  });
}

function collectChangedChecks(currentChecks: Record<string, boolean>, previousChecks: Record<string, boolean>) {
  const checkNames = new Set([...Object.keys(currentChecks), ...Object.keys(previousChecks)]);

  return Array.from(checkNames)
    .filter((checkName) => currentChecks[checkName] !== previousChecks[checkName])
    .sort();
}

function compareScenario(
  currentScenario: EvaluationScenarioReport | undefined,
  previousScenario: EvaluationScenarioReport | undefined,
): EvaluationScenarioTrend {
  if (currentScenario && !previousScenario) {
    return {
      scenario_id: currentScenario.scenario_id,
      status: "new",
      current_passed: currentScenario.passed,
      previous_passed: null,
      changed_checks: Object.keys(currentScenario.checks).sort(),
    };
  }

  if (!currentScenario && previousScenario) {
    return {
      scenario_id: previousScenario.scenario_id,
      status: "removed",
      current_passed: null,
      previous_passed: previousScenario.passed,
      changed_checks: Object.keys(previousScenario.checks).sort(),
    };
  }

  const changedChecks = collectChangedChecks(currentScenario?.checks ?? {}, previousScenario?.checks ?? {});
  const currentPassed = currentScenario?.passed ?? null;
  const previousPassed = previousScenario?.passed ?? null;

  let status: EvaluationScenarioTrend["status"] = "unchanged";

  if (previousPassed === false && currentPassed === true) {
    status = "improved";
  } else if (previousPassed === true && currentPassed === false) {
    status = "regressed";
  } else if (changedChecks.length > 0) {
    status = currentPassed ? "improved" : "regressed";
  }

  return {
    scenario_id: currentScenario?.scenario_id ?? previousScenario?.scenario_id ?? "unknown",
    status,
    current_passed: currentPassed,
    previous_passed: previousPassed,
    changed_checks: changedChecks,
  };
}

export function compareEvaluationReports(current: EvaluationReport, previous?: EvaluationReport | null): EvaluationReportTrend {
  const currentById = new Map(current.scenarios.map((scenario) => [scenario.scenario_id, scenario]));
  const previousById = new Map((previous?.scenarios ?? []).map((scenario) => [scenario.scenario_id, scenario]));
  const scenarioIds = Array.from(new Set([...currentById.keys(), ...previousById.keys()])).sort();
  const scenarios = scenarioIds.map((scenarioId) => compareScenario(currentById.get(scenarioId), previousById.get(scenarioId)));

  return evaluationReportTrendSchema.parse({
    suite: current.suite,
    current_generated_at: current.generated_at,
    previous_generated_at: previous?.generated_at ?? null,
    summary: {
      current_pass_rate: current.summary.pass_rate,
      previous_pass_rate: previous?.summary.pass_rate ?? null,
      pass_rate_delta: previous ? current.summary.pass_rate - previous.summary.pass_rate : null,
      improved_scenarios: scenarios.filter((scenario) => scenario.status === "improved").length,
      regressed_scenarios: scenarios.filter((scenario) => scenario.status === "regressed").length,
      unchanged_scenarios: scenarios.filter((scenario) => scenario.status === "unchanged").length,
      new_scenarios: scenarios.filter((scenario) => scenario.status === "new").length,
      removed_scenarios: scenarios.filter((scenario) => scenario.status === "removed").length,
    },
    scenarios,
  });
}

export function renderEvaluationTrendMarkdown(trend: EvaluationReportTrend) {
  const lines = [
    `# ${trend.suite} trend`,
    "",
    `Current run: ${trend.current_generated_at}`,
    `Previous run: ${trend.previous_generated_at ?? "none"}`,
    "",
    `Pass rate: ${Math.round(trend.summary.current_pass_rate * 100)}%`,
  ];

  if (trend.summary.previous_pass_rate !== null && trend.summary.pass_rate_delta !== null) {
    const deltaPercent = Math.round(trend.summary.pass_rate_delta * 100);
    const deltaLabel = deltaPercent > 0 ? `+${deltaPercent}` : `${deltaPercent}`;
    lines.push(`Pass rate delta: ${deltaLabel} points`);
  }

  lines.push(
    "",
    `Improved scenarios: ${trend.summary.improved_scenarios}`,
    `Regressed scenarios: ${trend.summary.regressed_scenarios}`,
    `Unchanged scenarios: ${trend.summary.unchanged_scenarios}`,
    `New scenarios: ${trend.summary.new_scenarios}`,
    `Removed scenarios: ${trend.summary.removed_scenarios}`,
    "",
    "## Scenario changes",
  );

  if (trend.scenarios.length === 0) {
    lines.push("", "No scenarios were compared.");
  } else {
    for (const scenario of trend.scenarios) {
      const checks = scenario.changed_checks.length > 0 ? ` (${scenario.changed_checks.join(", ")})` : "";
      lines.push("", `- ${scenario.scenario_id}: ${scenario.status}${checks}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
