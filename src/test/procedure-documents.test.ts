import { describe, expect, it } from "vitest";

import { builtInProcedureDocuments } from "@/lib/agent/procedure-documents";

describe("built-in procedure documents", () => {
  it("covers the broker adapters used by the demo harness", () => {
    const sites = new Set(builtInProcedureDocuments.map((document) => document.site));

    expect(sites.has("FastPeopleSearch")).toBe(true);
    expect(sites.has("Spokeo")).toBe(true);
    expect(sites.has("WhitePages")).toBe(true);
    expect(sites.has("TruePeopleSearch")).toBe(true);
    expect(sites.has("Radaris")).toBe(true);
  });
});
