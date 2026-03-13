import { describe, expect, it } from "vitest";

import {
  getAutomationSupportEntry,
  getAutomationSupportMatrix,
  isAutomationRunnable,
} from "@/lib/automation/site-registry";

describe("automation support matrix", () => {
  it("exposes support metadata for registered sites", () => {
    const matrix = getAutomationSupportMatrix();
    const fastPeopleSearch = matrix.find((entry) => entry.siteId === "FastPeopleSearch");

    expect(fastPeopleSearch).toMatchObject({
      status: "partial",
      verifiedAt: "2026-03-13",
    });
    expect(fastPeopleSearch?.knownIssues[0]).toContain("Just a moment");
  });

  it("provides lookup helpers for scheduling and UI gating", () => {
    expect(getAutomationSupportEntry("FastPeopleSearch")?.status).toBe("partial");
    expect(isAutomationRunnable("FastPeopleSearch")).toBe(true);
    expect(isAutomationRunnable("Spokeo")).toBe(true);
    expect(isAutomationRunnable("WhitePages")).toBe(true);
    expect(isAutomationRunnable("TruePeopleSearch")).toBe(true);
    expect(isAutomationRunnable("Radaris")).toBe(true);
  });
});
