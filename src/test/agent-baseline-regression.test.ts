import { describe, expect, it } from "vitest";

import { runBaselineEvaluationSuite } from "@/test/support/baseline-eval-suite";

describe("fixture baseline regression suite", () => {
  it("keeps every saved fixture scenario passing", async () => {
    const scenarios = await runBaselineEvaluationSuite();

    expect(scenarios).toHaveLength(5);

    for (const scenario of scenarios) {
      expect(scenario.passed, scenario.scenario_id).toBe(true);
    }
  });
});
