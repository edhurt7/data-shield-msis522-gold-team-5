import { describe, expect, it } from "vitest";

import { demoHarnessSiteIds, runDemoHarness, runDemoSiteHarness } from "@/lib/automation/demo-harness";

describe("demo harness", () => {
  it("runs each supported site through the fixture-backed harness", async () => {
    const result = await runDemoHarness({
      browserMode: "fixture_confirmation",
      now: () => new Date("2026-03-13T13:06:00.000Z"),
    });

    expect(result.summary.siteIds).toEqual(demoHarnessSiteIds);
    expect(result.summary.totalRuns).toBe(demoHarnessSiteIds.length);
    expect(result.runs).toHaveLength(demoHarnessSiteIds.length);
    expect(result.runs.every((run) => run.summary.automationStatus === "pending")).toBe(true);
    expect(result.dashboard.brokerSites.filter((site) => site.status === "found")).toHaveLength(demoHarnessSiteIds.length);
    expect(result.dashboard.brokerSites.filter((site) => site.status === "opted_out")).toHaveLength(0);
  });

  it("preserves the single-site compatibility path for FastPeopleSearch", async () => {
    const result = await runDemoSiteHarness({
      siteId: "fastpeoplesearch",
      browserMode: "fixture_confirmation",
      now: () => new Date("2026-03-13T13:06:00.000Z"),
    });

    expect(result.summary.site).toBe("FastPeopleSearch");
    expect(result.summary.automationStatus).toBe("pending");
    expect(result.summary.terminalPath).toBe("await_confirmation");
    expect(result.automationRecord.executionResult.confirmation_text?.toLowerCase()).toContain("pending review");
  });
});
