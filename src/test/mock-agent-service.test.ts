import { describe, expect, it } from "vitest";

import { runtimeAgentService } from "@/lib/agent/runtime-service";

describe("runtime agent service", () => {
  it("returns a dashboard snapshot derived from the agent run", async () => {
    await runtimeAgentService.resetDemoSession();
    const snapshot = await runtimeAgentService.getDashboardSnapshot();

    expect(snapshot.runId).toBe("run_runtime_demo_001");
    expect(snapshot.brokerSites.length).toBeGreaterThan(0);
    expect(snapshot.chatMessages.length).toBeGreaterThan(0);
    expect(snapshot.brokerSites.some((site) => site.status === "found" || site.status === "opted_out")).toBe(true);
  });

  it("submits pending runtime drafts through the workflow-backed service", async () => {
    await runtimeAgentService.resetDemoSession();
    const before = await runtimeAgentService.getDashboardSnapshot();
    const beforeOptedOut = before.brokerSites.filter((site) => site.status === "opted_out").length;

    await runtimeAgentService.sendChatCommand("submit the pending removals");

    const after = await runtimeAgentService.getDashboardSnapshot();
    const afterOptedOut = after.brokerSites.filter((site) => site.status === "opted_out").length;

    expect(after.chatMessages.length).toBe(before.chatMessages.length + 2);
    expect(after.chatMessages.at(-1)?.role).toBe("assistant");
    expect(afterOptedOut).toBeGreaterThanOrEqual(beforeOptedOut);
  });

  it("derives monitored target sets from the current runtime workflow output", async () => {
    await runtimeAgentService.resetDemoSession();

    const targetSets = await runtimeAgentService.listMonitoredTargetSets();
    const targetSet = await runtimeAgentService.getMonitoredTargetSetForRun("run_runtime_demo_001");

    expect(targetSets.length).toBe(1);
    expect(targetSet?.sourceRunId).toBe("run_runtime_demo_001");
    expect(targetSet?.targetCount).toBeGreaterThan(0);
    expect(targetSet?.targets.some((target) => target.monitoringStatus === "awaiting_confirmation")).toBe(true);
  });
});
