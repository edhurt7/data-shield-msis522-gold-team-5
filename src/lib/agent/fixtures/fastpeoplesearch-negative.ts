import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ExecutionResult, SeedProfile } from "@/lib/agent";

const sharedSeedProfile: SeedProfile = {
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

const sharedExecutionResult: ExecutionResult = {
  site: "FastPeopleSearch",
  candidate_url: "https://fastpeoplesearch.test/listing/possible-jane-doe",
  status: "manual_required",
  confirmation: {
    ticket: null,
    page_text: "Manual review required.",
    screenshot_ref: null,
  },
  error: null,
};

const fixtureArtifactPath = (...pathSegments: string[]) =>
  resolve(process.cwd(), "src", "lib", "agent", "fixtures", "artifacts", ...pathSegments);

export const ambiguousFastPeopleSearchFixture = {
  site: "FastPeopleSearch",
  requestText: "Search for my name + Seattle and submit removals for everything you find.",
  seedProfile: sharedSeedProfile,
  listingPageText: readFileSync(
    fixtureArtifactPath("fastpeoplesearch", "listing-page-ambiguous.txt"),
    "utf8",
  ).trim(),
  candidateUrl: "https://fastpeoplesearch.test/listing/possible-jane-doe",
  executionResult: sharedExecutionResult,
  expected: {
    maxConfidence: 0.74,
    requiredReviewReason: "low_confidence_match" as const,
  },
};

function makeListingFixture(pageText: string, candidateUrl: string) {
  return {
    site: "FastPeopleSearch",
    requestText: "Search for my name + Seattle and submit removals for everything you find.",
    seedProfile: sharedSeedProfile,
    listingPageText: pageText,
    candidateUrl,
  };
}

export const sameNameWrongCityFixture = {
  ...makeListingFixture(
    "Jane Doe, age 35, Portland, Oregon. Possible associates listed. No matching home-state records shown.",
    "https://fastpeoplesearch.test/listing/jane-doe-portland-or",
  ),
  expected: {
    maxConfidence: 0.74,
    requiredReviewReason: "low_confidence_match" as const,
  },
};

export const sameNameWrongAgeFixture = {
  ...makeListingFixture(
    "Jane Doe, age 52, Seattle, Washington. Phone 206-555-0999. Relatives: Alice Doe.",
    "https://fastpeoplesearch.test/listing/jane-doe-seattle-wa-age-52",
  ),
  expected: {
    maxConfidence: 0.74,
    requiredReviewReason: "low_confidence_match" as const,
  },
};

export const partialNameMatchFixture = {
  ...makeListingFixture(
    "J. Doe, Seattle, Washington. Current address listed in Seattle metro area.",
    "https://fastpeoplesearch.test/listing/j-doe-seattle-wa",
  ),
  expected: {
    maxConfidence: 0.74,
    requiredReviewReason: "low_confidence_match" as const,
  },
};

export const weakEvidenceSingleFieldFixture = {
  ...makeListingFixture(
    "Jane Doe appears in a broad directory result with no city, age, or phone details.",
    "https://fastpeoplesearch.test/listing/jane-doe-broad-match",
  ),
  expected: {
    maxConfidence: 0.74,
    requiredReviewReason: "low_confidence_match" as const,
  },
};

export const contradictoryProcedureFixture = {
  status: "contradictory" as const,
  chunks: [
    { doc_id: "fps-contradict-1", quote: "Submit by email to privacy@fastpeoplesearch.test." },
    { doc_id: "fps-contradict-2", quote: "Use the webform only; email requests are not accepted." },
  ],
  notes: "Procedure sources disagree on the submission channel.",
  review_reasons: ["contradictory_procedure"] as const,
};

export const staleProcedureFixture = {
  status: "stale" as const,
  chunks: [
    { doc_id: "fps-stale-1", quote: "Legacy FastPeopleSearch removal webform instructions from 2024." },
  ],
  notes: "Procedure source is older than the freshness window.",
  review_reasons: ["stale_procedure"] as const,
};

export const incompleteProcedureFixture = {
  chunks: [
    { doc_id: "fps-incomplete-1", quote: "Use the FastPeopleSearch removal webform." },
  ],
};

export const emailDraftQualityFixture = {
  site: "Radaris",
  requestText: "Find me and submit the opt-out.",
  seedProfile: sharedSeedProfile,
  listingPageText: "Jane Doe, Seattle, Washington. Age 35. Prior city Tacoma.",
  candidateUrl: "https://radaris.test/listing/jane-doe-seattle-wa",
  procedureChunks: [
    { doc_id: "radaris-proc-1", quote: "Email privacy@radaris.example with a removal request." },
    { doc_id: "radaris-proc-2", quote: "Required fields: full name and privacy email." },
  ],
};

export const executionInterpretationFixtures = {
  clearSuccess: {
    status: "submitted" as const,
    confirmation: {
      ticket: "FPS-12345",
      page_text: "Your request has been received and submitted successfully.",
      screenshot_ref: "fixtures/fastpeoplesearch-success.png",
    },
    error: null,
    expected: {
      nextStatus: "submitted" as const,
      nextAction: "none" as const,
    },
  },
  pendingConfirmation: {
    status: "pending" as const,
    confirmation: {
      ticket: null,
      page_text: "Check your inbox to finish confirming this request.",
      screenshot_ref: null,
    },
    error: null,
    expected: {
      nextStatus: "pending" as const,
      nextAction: "await_confirmation" as const,
    },
  },
  failureWithRetry: {
    status: "failed" as const,
    confirmation: {
      ticket: null,
      page_text: "Temporary submission error. Please try again.",
      screenshot_ref: null,
    },
    error: "Network timeout",
    expected: {
      nextStatus: "failed" as const,
      nextAction: "retry" as const,
    },
  },
  captchaRequired: {
    status: "failed" as const,
    confirmation: {
      ticket: null,
      page_text: "CAPTCHA required before submission can continue.",
      screenshot_ref: null,
    },
    error: "CAPTCHA challenge encountered",
    expected: {
      nextStatus: "manual_required" as const,
      nextAction: "request_user_review" as const,
      requiredReviewReasons: ["captcha"] as const,
    },
  },
  unclearEvidence: {
    status: "submitted" as const,
    confirmation: {
      ticket: null,
      page_text: null,
      screenshot_ref: null,
    },
    error: null,
    expected: {
      nextStatus: "pending" as const,
      nextAction: "await_confirmation" as const,
      forbidSubmitted: true,
    },
  },
};
