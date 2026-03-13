import type { AutomationSiteExecutor, AutomationSiteRegistry } from "@/lib/automation/types";
import { fastPeopleSearchAutomationSite } from "@/lib/automation/sites/fastpeoplesearch";
import { radarisAutomationSite } from "@/lib/automation/sites/radaris";
import { spokeoAutomationSite } from "@/lib/automation/sites/spokeo";
import { truePeopleSearchAutomationSite } from "@/lib/automation/sites/truepeoplesearch";
import { whitePagesAutomationSite } from "@/lib/automation/sites/whitepages";

function normalizeSiteId(siteId: string) {
  return siteId.trim().toLowerCase();
}

export type AutomationSupportStatus =
  | "supported"
  | "partial"
  | "manual_only"
  | "blocked";

export interface AutomationSiteSupportEntry {
  siteId: string;
  displayName: string;
  status: AutomationSupportStatus;
  executor?: AutomationSiteExecutor;
  verifiedAt: string | null;
  knownIssues: string[];
  notes?: string;
}

export const defaultAutomationSupportMatrix: AutomationSiteSupportEntry[] = [
  {
    siteId: "FastPeopleSearch",
    displayName: "FastPeopleSearch",
    status: "partial",
    executor: fastPeopleSearchAutomationSite,
    verifiedAt: "2026-03-13",
    knownIssues: [
      "Live verification on 2026-03-13 reached an anti-bot 'Just a moment...' page at https://www.fastpeoplesearch.com/removal and none of the encoded selectors were present.",
      "The adapter currently assumes the first returned record is the intended removal target after workflow matching.",
    ],
    notes: "Adapter is implemented and workflow-integrated, but live execution is currently degraded by anti-bot gating and should be treated as partial support.",
  },
  {
    siteId: "Spokeo",
    displayName: "Spokeo",
    status: "partial",
    executor: spokeoAutomationSite,
    verifiedAt: null,
    knownIssues: [
      "Adapter is fixture-covered but has not been live-verified against the production site in this environment.",
      "Spokeo still requires email-link confirmation after webform submission.",
    ],
    notes: "Adapter is implemented for the listing-URL and privacy-email flow, but should remain partial until live selectors are validated.",
  },
  {
    siteId: "WhitePages",
    displayName: "WhitePages",
    status: "partial",
    executor: whitePagesAutomationSite,
    verifiedAt: null,
    knownIssues: [
      "Adapter is fixture-covered but has not been live-verified against the production site in this environment.",
      "WhitePages commonly defers completion to an email verification step after submission.",
    ],
    notes: "Adapter is implemented for the suppression-request flow, but should remain partial until live selectors are validated.",
  },
  {
    siteId: "TruePeopleSearch",
    displayName: "TruePeopleSearch",
    status: "partial",
    executor: truePeopleSearchAutomationSite,
    verifiedAt: null,
    knownIssues: [
      "Adapter is fixture-covered but has not been live-verified against the production site in this environment.",
      "The adapter currently assumes the first matched record is the intended removal target after workflow matching.",
    ],
    notes: "Adapter is implemented for the search-select-submit flow, but should remain partial until live selectors are validated.",
  },
  {
    siteId: "Radaris",
    displayName: "Radaris",
    status: "partial",
    executor: radarisAutomationSite,
    verifiedAt: null,
    knownIssues: [
      "Radaris procedure coverage remains email-based and does not use a browser flow.",
      "The adapter serializes the outbound email payload, but transport delivery is not wired in this harness.",
    ],
    notes: "Adapter is implemented for email-backed execution records so the workflow/demo path can run end-to-end without browser automation.",
  },
  {
    siteId: "UnknownBroker",
    displayName: "UnknownBroker",
    status: "blocked",
    verifiedAt: null,
    knownIssues: [
      "No validated procedure and no automation adapter.",
    ],
  },
];

export function createAutomationSiteRegistry(executors: AutomationSiteExecutor[] = []): AutomationSiteRegistry {
  const entries = new Map<string, AutomationSiteExecutor>();

  for (const executor of executors) {
    for (const siteId of executor.siteIds) {
      entries.set(normalizeSiteId(siteId), executor);
    }
  }

  return {
    get(siteId: string) {
      return entries.get(normalizeSiteId(siteId));
    },
    has(siteId: string) {
      return entries.has(normalizeSiteId(siteId));
    },
    list() {
      return Array.from(new Set(entries.values()));
    },
  };
}

export function createDefaultAutomationSiteRegistry() {
  return createAutomationSiteRegistry(
    defaultAutomationSupportMatrix
      .filter((entry) => entry.status === "supported" || entry.status === "partial")
      .flatMap((entry) => entry.executor ? [entry.executor] : []),
  );
}

export function getAutomationSupportMatrix(): AutomationSiteSupportEntry[] {
  return defaultAutomationSupportMatrix.map((entry) => ({
    ...entry,
  }));
}

export function getAutomationSupportEntry(siteId: string): AutomationSiteSupportEntry | undefined {
  return defaultAutomationSupportMatrix.find((entry) => normalizeSiteId(entry.siteId) === normalizeSiteId(siteId));
}

export function isAutomationRunnable(siteId: string): boolean {
  const entry = getAutomationSupportEntry(siteId);
  return entry?.status === "supported" || entry?.status === "partial";
}

export {
  fastPeopleSearchAutomationSite,
  radarisAutomationSite,
  spokeoAutomationSite,
  truePeopleSearchAutomationSite,
  whitePagesAutomationSite,
};
