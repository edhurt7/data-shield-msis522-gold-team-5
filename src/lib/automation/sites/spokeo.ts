import type { ActionHandoff } from "@/lib/agent/contracts";

import { createAutomationArtifact, createStepOutcome } from "@/lib/automation/artifacts";
import type { AutomationSiteExecutor } from "@/lib/automation/types";
import {
  buildGenericAdapterResult,
  findFinalPageText,
  getRequiredStringField,
  hasAnyPhrase,
  matchesConfirmationText,
  passthroughGenericFailure,
  requireSubmissionChannel,
} from "@/lib/automation/sites/shared";

export const SPOKEO_ENTRY_URL = "https://www.spokeo.com/optout";

export const spokeoSelectors = {
  listingUrl: "#optout-url",
  email: "#optout-email",
  searchButton: "#search-profile",
  submitButton: "#submit-optout",
} as const;

export const spokeoConfirmationPhrases = [
  "check your inbox",
  "confirmation email",
] as const;

export const spokeoFallbackPhrases = {
  captcha: ["captcha", "verify you are human"],
  blocked: ["access denied", "unusual traffic", "rate limit"],
} as const;

function normalizeSpokeoHandoff(handoff: ActionHandoff): ActionHandoff {
  requireSubmissionChannel(handoff, "webform", "Spokeo");

  const privacyEmail = getRequiredStringField(handoff, "privacy_email", "Spokeo");
  const listingUrl = getRequiredStringField(handoff, "listing_url", "Spokeo");

  return {
    ...handoff,
    payload: {
      ...handoff.payload,
      fields: {
        ...handoff.payload.fields,
        privacy_email: privacyEmail,
        listing_url: listingUrl,
        candidate_url: typeof handoff.payload.fields.candidate_url === "string"
          ? handoff.payload.fields.candidate_url
          : listingUrl,
      },
      steps: [
        {
          stepId: "spokeo_step_1",
          action: "navigate",
          instruction: "Open the Spokeo opt-out entry page.",
          targetUrl: SPOKEO_ENTRY_URL,
        },
        {
          stepId: "spokeo_step_2",
          action: "fill",
          instruction: "Enter the Spokeo listing URL.",
          selector: spokeoSelectors.listingUrl,
          inputKey: "listing_url",
        },
        {
          stepId: "spokeo_step_3",
          action: "fill",
          instruction: "Enter the privacy email address.",
          selector: spokeoSelectors.email,
          inputKey: "privacy_email",
        },
        {
          stepId: "spokeo_step_4",
          action: "click",
          instruction: "Search for the matching Spokeo profile.",
          selector: spokeoSelectors.searchButton,
        },
        {
          stepId: "spokeo_step_5",
          action: "click",
          instruction: "Submit the Spokeo opt-out request.",
          selector: spokeoSelectors.submitButton,
        },
      ],
    },
  };
}

export const spokeoAutomationSite: AutomationSiteExecutor = {
  id: "spokeo-site-adapter",
  siteIds: ["Spokeo", "spokeo"],
  async execute(input, context) {
    const { handoff, startedAt } = input;
    const normalizedHandoff = normalizeSpokeoHandoff(handoff);
    const genericRecord = await context.executeGeneric(normalizedHandoff);
    const completedAt = context.now().toISOString();

    if (genericRecord.executionResult.status !== "submitted") {
      return passthroughGenericFailure({
        handoff: normalizedHandoff,
        executorId: this.id,
        startedAt,
        completedAt,
        genericRecord,
      });
    }

    const finalPageText = findFinalPageText(genericRecord);

    if (hasAnyPhrase(finalPageText, spokeoFallbackPhrases.captcha)) {
      return buildGenericAdapterResult({
        handoff: normalizedHandoff,
        executorId: this.id,
        startedAt,
        completedAt,
        status: "manual_required",
        manualReviewRequired: true,
        confirmationText: finalPageText,
        errorText: "Spokeo presented a CAPTCHA during confirmation review.",
        failureCode: "captcha",
        reviewReasons: ["captcha"],
        genericRecord,
      });
    }

    if (hasAnyPhrase(finalPageText, spokeoFallbackPhrases.blocked)) {
      return buildGenericAdapterResult({
        handoff: normalizedHandoff,
        executorId: this.id,
        startedAt,
        completedAt,
        status: "failed",
        manualReviewRequired: false,
        confirmationText: finalPageText,
        errorText: "Spokeo blocked the automated opt-out flow.",
        failureCode: "rate_limited",
        reviewReasons: ["rate_limited"],
        genericRecord,
      });
    }

    if (!matchesConfirmationText(finalPageText, spokeoConfirmationPhrases, "email_confirmation")) {
      const reviewArtifact = createAutomationArtifact({
        handoff: normalizedHandoff,
        kind: "execution_log",
        suffix: "confirmation-review",
        createdAt: completedAt,
        label: "Spokeo confirmation review",
        contentType: "text/plain",
        content: "Spokeo did not present the expected confirmation-email language after submission.",
      });

      return buildGenericAdapterResult({
        handoff: normalizedHandoff,
        executorId: this.id,
        startedAt,
        completedAt,
        status: "manual_required",
        manualReviewRequired: true,
        confirmationText: null,
        errorText: "Spokeo confirmation page did not match expected text.",
        failureCode: "manual_review_required",
        reviewReasons: ["manual_submission_required"],
        genericRecord,
        extraArtifacts: [reviewArtifact],
        extraStepOutcomes: [createStepOutcome({
          step: {
            stepId: "spokeo_confirmation_review",
            action: "manual_review",
            instruction: "Review the Spokeo confirmation page manually.",
          },
          startedAt,
          completedAt,
          status: "manual_review_required",
          artifactIds: [reviewArtifact.artifactId],
          notes: "Expected confirmation-email text was not detected after submission.",
        })],
      });
    }

    return buildGenericAdapterResult({
      handoff: normalizedHandoff,
      executorId: this.id,
      startedAt,
      completedAt,
      status: "pending",
      manualReviewRequired: false,
      confirmationText: finalPageText,
      errorText: null,
      genericRecord,
    });
  },
};
