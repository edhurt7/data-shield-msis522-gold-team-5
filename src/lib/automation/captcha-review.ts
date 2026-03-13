import type { ExecutionResult, ReviewReason } from "@/lib/agent/contracts";
import { fastPeopleSearchConfirmationPhrases, fastPeopleSearchFallbackPhrases } from "@/lib/automation/sites/fastpeoplesearch";
import { spokeoConfirmationPhrases, spokeoFallbackPhrases } from "@/lib/automation/sites/spokeo";
import { matchesConfirmationText, hasAnyPhrase } from "@/lib/automation/sites/shared";
import { truePeopleSearchConfirmationPhrases, truePeopleSearchFallbackPhrases } from "@/lib/automation/sites/truepeoplesearch";
import { whitePagesConfirmationPhrases, whitePagesFallbackPhrases } from "@/lib/automation/sites/whitepages";
import type { AutomationErrorCode } from "@/lib/automation/errors";

export type CaptchaReviewSiteId =
  | "fastpeoplesearch"
  | "spokeo"
  | "truepeoplesearch"
  | "whitepages";

interface CaptchaReviewConfig {
  siteId: CaptchaReviewSiteId;
  siteName: string;
  confirmationMode: "email_confirmation" | "submission_received";
  confirmationPhrases: readonly string[];
  fallbackPhrases: {
    captcha: readonly string[];
    blocked: readonly string[];
  };
}

export interface CaptchaReviewOutcome {
  status: ExecutionResult["status"];
  manualReviewRequired: boolean;
  failureCode: AutomationErrorCode | null;
  reviewReasons: ReviewReason[];
  confirmationText: string | null;
  errorText: string | null;
}

const captchaReviewConfigs: Record<CaptchaReviewSiteId, CaptchaReviewConfig> = {
  fastpeoplesearch: {
    siteId: "fastpeoplesearch",
    siteName: "FastPeopleSearch",
    confirmationMode: "submission_received",
    confirmationPhrases: fastPeopleSearchConfirmationPhrases,
    fallbackPhrases: fastPeopleSearchFallbackPhrases,
  },
  spokeo: {
    siteId: "spokeo",
    siteName: "Spokeo",
    confirmationMode: "email_confirmation",
    confirmationPhrases: spokeoConfirmationPhrases,
    fallbackPhrases: spokeoFallbackPhrases,
  },
  truepeoplesearch: {
    siteId: "truepeoplesearch",
    siteName: "TruePeopleSearch",
    confirmationMode: "email_confirmation",
    confirmationPhrases: truePeopleSearchConfirmationPhrases,
    fallbackPhrases: truePeopleSearchFallbackPhrases,
  },
  whitepages: {
    siteId: "whitepages",
    siteName: "WhitePages",
    confirmationMode: "email_confirmation",
    confirmationPhrases: whitePagesConfirmationPhrases,
    fallbackPhrases: whitePagesFallbackPhrases,
  },
};

export function normalizeCaptchaReviewSiteId(siteId: string): CaptchaReviewSiteId | null {
  const normalized = siteId.toLowerCase().replace(/\s+/g, "");

  switch (normalized) {
    case "fastpeoplesearch":
      return "fastpeoplesearch";
    case "spokeo":
      return "spokeo";
    case "truepeoplesearch":
      return "truepeoplesearch";
    case "whitepages":
      return "whitepages";
    default:
      return null;
  }
}

export function classifyCaptchaReviewOutcome(siteId: string, pageText: string): CaptchaReviewOutcome {
  const normalizedSiteId = normalizeCaptchaReviewSiteId(siteId);
  if (!normalizedSiteId) {
    return {
      status: "manual_required",
      manualReviewRequired: true,
      failureCode: "manual_review_required",
      reviewReasons: ["manual_submission_required"],
      confirmationText: pageText,
      errorText: "This site still needs manual review after the CAPTCHA step.",
    };
  }

  const config = captchaReviewConfigs[normalizedSiteId];
  if (hasAnyPhrase(pageText, config.fallbackPhrases.captcha)) {
    return {
      status: "manual_required",
      manualReviewRequired: true,
      failureCode: "captcha",
      reviewReasons: ["captcha"],
      confirmationText: pageText,
      errorText: `${config.siteName} still shows a CAPTCHA challenge.`,
    };
  }

  if (hasAnyPhrase(pageText, config.fallbackPhrases.blocked)) {
    return {
      status: "failed",
      manualReviewRequired: false,
      failureCode: "rate_limited",
      reviewReasons: ["rate_limited"],
      confirmationText: pageText,
      errorText: `${config.siteName} blocked the automated flow after the CAPTCHA step.`,
    };
  }

  if (matchesConfirmationText(pageText, config.confirmationPhrases, config.confirmationMode)) {
    return {
      status: "pending",
      manualReviewRequired: false,
      failureCode: null,
      reviewReasons: [],
      confirmationText: pageText,
      errorText: null,
    };
  }

  return {
    status: "manual_required",
    manualReviewRequired: true,
    failureCode: "manual_review_required",
    reviewReasons: ["manual_submission_required"],
    confirmationText: pageText,
    errorText: `${config.siteName} no longer shows a CAPTCHA, but the page still needs manual review.`,
  };
}
