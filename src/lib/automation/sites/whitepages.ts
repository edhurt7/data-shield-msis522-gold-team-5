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

export const WHITEPAGES_ENTRY_URL = "https://www.whitepages.com/suppression-requests";

export const whitePagesSelectors = {
  listingUrl: "#wp-record-url",
  email: "#wp-email",
  consentCheckbox: "#wp-consent",
  submitButton: "#wp-submit",
} as const;

export const whitePagesConfirmationPhrases = [
  "verification email",
  "check your email",
] as const;

export const whitePagesFallbackPhrases = {
  captcha: ["captcha", "verify you are human"],
  blocked: ["access denied", "unusual traffic", "rate limit"],
} as const;

function normalizeWhitePagesHandoff(handoff: ActionHandoff): ActionHandoff {
  requireSubmissionChannel(handoff, "webform", "WhitePages");

  const privacyEmail = getRequiredStringField(handoff, "privacy_email", "WhitePages");
  const listingUrl = getRequiredStringField(handoff, "listing_url", "WhitePages");

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
          stepId: "whitepages_step_1",
          action: "navigate",
          instruction: "Open the WhitePages suppression request page.",
          targetUrl: WHITEPAGES_ENTRY_URL,
        },
        {
          stepId: "whitepages_step_2",
          action: "fill",
          instruction: "Enter the WhitePages listing URL.",
          selector: whitePagesSelectors.listingUrl,
          inputKey: "listing_url",
        },
        {
          stepId: "whitepages_step_3",
          action: "fill",
          instruction: "Enter the privacy email address.",
          selector: whitePagesSelectors.email,
          inputKey: "privacy_email",
        },
        {
          stepId: "whitepages_step_4",
          action: "click",
          instruction: "Accept the WhitePages request confirmation checkbox.",
          selector: whitePagesSelectors.consentCheckbox,
        },
        {
          stepId: "whitepages_step_5",
          action: "click",
          instruction: "Submit the WhitePages suppression request.",
          selector: whitePagesSelectors.submitButton,
        },
      ],
    },
  };
}

export const whitePagesAutomationSite: AutomationSiteExecutor = {
  id: "whitepages-site-adapter",
  siteIds: ["WhitePages", "whitepages"],
  async execute(input, context) {
    const { handoff, startedAt } = input;
    const normalizedHandoff = normalizeWhitePagesHandoff(handoff);
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

    if (hasAnyPhrase(finalPageText, whitePagesFallbackPhrases.captcha)) {
      return buildGenericAdapterResult({
        handoff: normalizedHandoff,
        executorId: this.id,
        startedAt,
        completedAt,
        status: "manual_required",
        manualReviewRequired: true,
        confirmationText: finalPageText,
        errorText: "WhitePages presented a CAPTCHA during confirmation review.",
        failureCode: "captcha",
        reviewReasons: ["captcha"],
        genericRecord,
      });
    }

    if (hasAnyPhrase(finalPageText, whitePagesFallbackPhrases.blocked)) {
      return buildGenericAdapterResult({
        handoff: normalizedHandoff,
        executorId: this.id,
        startedAt,
        completedAt,
        status: "failed",
        manualReviewRequired: false,
        confirmationText: finalPageText,
        errorText: "WhitePages blocked the automated suppression flow.",
        failureCode: "rate_limited",
        reviewReasons: ["rate_limited"],
        genericRecord,
      });
    }

    if (!matchesConfirmationText(finalPageText, whitePagesConfirmationPhrases, "email_confirmation")) {
      const reviewArtifact = createAutomationArtifact({
        handoff: normalizedHandoff,
        kind: "execution_log",
        suffix: "confirmation-review",
        createdAt: completedAt,
        label: "WhitePages confirmation review",
        contentType: "text/plain",
        content: "WhitePages did not present the expected email verification language after submission.",
      });

      return buildGenericAdapterResult({
        handoff: normalizedHandoff,
        executorId: this.id,
        startedAt,
        completedAt,
        status: "manual_required",
        manualReviewRequired: true,
        confirmationText: null,
        errorText: "WhitePages confirmation page did not match expected text.",
        failureCode: "manual_review_required",
        reviewReasons: ["manual_submission_required"],
        genericRecord,
        extraArtifacts: [reviewArtifact],
        extraStepOutcomes: [createStepOutcome({
          step: {
            stepId: "whitepages_confirmation_review",
            action: "manual_review",
            instruction: "Review the WhitePages confirmation page manually.",
          },
          startedAt,
          completedAt,
          status: "manual_review_required",
          artifactIds: [reviewArtifact.artifactId],
          notes: "Expected verification-email text was not detected after submission.",
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
