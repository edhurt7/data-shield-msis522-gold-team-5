import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { DiscoveryResult, ExecutionResult, PageContentArtifact, ProcedureSourceChunk, SeedProfile } from "@/lib/agent";

export const fastPeopleSearchSeedProfile: SeedProfile = {
  full_name: "Jane Doe",
  name_variants: ["Jane A Doe", "J. Doe"],
  location: {
    city: "Seattle",
    state: "Washington",
  },
  approx_age: "35",
  privacy_email: "shield-abc123@detraceme.io",
  optional: {
    phone_last4: "0114",
    prior_cities: ["Tacoma"],
  },
  consent: true,
};

const fixtureArtifactPath = (...pathSegments: string[]) =>
  resolve(process.cwd(), "src", "lib", "agent", "fixtures", "artifacts", ...pathSegments);

export const fastPeopleSearchListingPageText = readFileSync(
  fixtureArtifactPath("fastpeoplesearch", "listing-page.txt"),
  "utf8",
).trim();

export const fastPeopleSearchCandidateUrl = "https://fastpeoplesearch.test/listing/jane-doe-seattle-wa";
export const fastPeopleSearchPageArtifact: PageContentArtifact = {
  visible_text: fastPeopleSearchListingPageText,
  url: fastPeopleSearchCandidateUrl,
  screenshot_ref: "fixtures/fastpeoplesearch-listing.png",
  extracted_metadata: {
    title: "Jane Doe in Seattle, WA | FastPeopleSearch",
    page_category: "listing_detail",
  },
};

export const fastPeopleSearchProcedureChunks: ProcedureSourceChunk[] = [
  {
    doc_id: "fps-proc-1",
    quote: "Use the FastPeopleSearch removal webform to request record suppression.",
  },
  {
    doc_id: "fps-proc-2",
    quote: "Required fields: full name and privacy email. Check the consent checkbox before form submission.",
  },
];

export const fastPeopleSearchExecutionResult: ExecutionResult = {
  site: "FastPeopleSearch",
  candidate_url: fastPeopleSearchCandidateUrl,
  status: "pending",
  manual_review_required: false,
  confirmation_text: readFileSync(fixtureArtifactPath("fastpeoplesearch", "confirmation-page.txt"), "utf8").trim(),
  ticket_ids: [],
  screenshot_ref: "fixtures/fastpeoplesearch-confirmation.png",
  error_text: null,
};

export const expectedFastPeopleSearchDiscovery: Partial<DiscoveryResult> = {
  site: "FastPeopleSearch",
  found: true,
};

export const fastPeopleSearchFixture = {
  site: "FastPeopleSearch",
  requestText: "Search for my name + Seattle and submit removals for everything you find.",
  seedProfile: fastPeopleSearchSeedProfile,
  pageArtifact: fastPeopleSearchPageArtifact,
  listingPageText: fastPeopleSearchListingPageText,
  candidateUrl: fastPeopleSearchCandidateUrl,
  procedureChunks: fastPeopleSearchProcedureChunks,
  executionResult: fastPeopleSearchExecutionResult,
  expected: {
    minConfidence: 0.75,
    decision: "exact_match" as const,
    procedureType: "webform" as const,
    requiredFieldNames: ["full_name", "privacy_email"],
    nextStatus: "pending" as const,
    nextAction: "await_confirmation" as const,
  },
};
