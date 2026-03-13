import { describe, expect, it } from "vitest";

import { mockAgentRunState } from "@/lib/agent/mock-run";
import {
  BROKER_DIRECTORY,
  buildBrokerSites,
  buildHistoryEntries,
  getScanSummary,
  mockBrokerSites,
  mockHistory,
} from "@/lib/mock-data";

describe("mock data adapters", () => {
  it("derives dashboard scan counts from the schema-backed agent state", () => {
    const summary = getScanSummary(mockBrokerSites);

    expect(summary.total).toBe(BROKER_DIRECTORY.length);
    expect(summary.found + summary.optedOut + summary.scanning + summary.notFound + summary.failed).toBe(summary.total);
  });

  it("exposes found-site details from matched candidates and drafts", () => {
    const spokeo = mockBrokerSites.find((site) => site.id === "spokeo");

    expect(spokeo?.status).toBe("found");
    expect(spokeo?.foundData?.fields).toContain("Full Name");
    expect(spokeo?.foundData?.optOutMessage).toContain("shield-a7x29k@detraceme.io");
  });

  it("exposes failure reasons for failed-site detail panels", () => {
    const candidateSite = mockBrokerSites.find((site) => site.status === "not_found" || site.status === "scanning") ?? mockBrokerSites[0];
    const failedRun = structuredClone(mockAgentRunState);
    failedRun.timeline.push({
      eventId: "evt_test_failed_site",
      phase: "scan",
      status: "failed",
      message: "Synthetic site failure for detail panel coverage.",
      createdAt: "2026-03-13T12:00:00.000Z",
      siteId: candidateSite.id,
    });
    const failedSite = buildBrokerSites(failedRun).find((site) => site.id === candidateSite.id);

    expect(failedSite?.status).toBe("failed");
    expect(failedSite?.foundData?.failureReason).toBeTruthy();
  });

  it("builds aggregate history entries from the broker summary view", () => {
    const history = buildHistoryEntries(mockAgentRunState);

    expect(history).toHaveLength(1);
    expect(history[0]?.totalSites).toBe(BROKER_DIRECTORY.length);
    expect(mockHistory[0]?.runId).toBe(mockAgentRunState.runId);
  });
});
