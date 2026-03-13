import type { ActionHandoff } from "@/lib/agent/contracts";

import { createAutomationArtifact, createStepOutcome } from "@/lib/automation/artifacts";
import type { AutomationSiteExecutor } from "@/lib/automation/types";
import {
  buildGenericAdapterResult,
  findFinalPageText,
  getOptionalStringField,
  getRequiredStringField,
  hasAnyPhrase,
  matchesConfirmationText,
  passthroughGenericFailure,
  requireSubmissionChannel,
} from "@/lib/automation/sites/shared";

export const TRUE_PEOPLE_SEARCH_ENTRY_URL = "https://www.truepeoplesearch.com/removal";

export const truePeopleSearchSelectors = {
  name: "#tps-name",
  cityState: "#tps-location",
  searchButton: "#tps-search",
  firstResultButton: "#tps-result-0",
  email: "#tps-email",
  submitButton: "#tps-submit",
} as const;

export const truePeopleSearchConfirmationPhrases = [
  "check your inbox",
  "email confirmation",
] as const;

export const truePeopleSearchFallbackPhrases = {
  captcha: ["captcha", "verify you are human"],
  blocked: ["access denied", "unusual traffic", "rate limit"],
} as const;

function normalizeTruePeopleSearchHandoff(handoff: ActionHandoff): ActionHandoff {
  requireSubmissionChannel(handoff, "webform", "TruePeopleSearch");

  const fullName = getRequiredStringField(handoff, "full_name", "TruePeopleSearch");
  const privacyEmail = getRequiredStringField(handoff, "privacy_email", "TruePeopleSearch");
  const cityState = getOptionalStringField(handoff, "city_state") ?? "Seattle, Washington";

  return {
    ...handoff,
    payload: {
      ...handoff.payload,
      fields: {
        ...handoff.payload.fields,
        full_name: fullName,
        privacy_email: privacyEmail,
        city_state: cityState,
        candidate_url: typeof handoff.payload.fields.candidate_url === "string"
          ? handoff.payload.fields.candidate_url
          : `https://www.truepeoplesearch.com/find/${encodeURIComponent(fullName.toLowerCase().replace(/\s+/g, "-"))}`,
      },
      steps: [
        {
          stepId: "truepeoplesearch_step_1",
          action: "navigate",
          instruction: "Open the TruePeopleSearch removal page.",
          targetUrl: TRUE_PEOPLE_SEARCH_ENTRY_URL,
        },
        {
          stepId: "truepeoplesearch_step_2",
          action: "fill",
          instruction: "Enter the full name to search.",
          selector: truePeopleSearchSelectors.name,
          inputKey: "full_name",
        },
        {
          stepId: "truepeoplesearch_step_3",
          action: "fill",
          instruction: "Enter the city and state for the listing.",
          selector: truePeopleSearchSelectors.cityState,
          inputKey: "city_state",
        },
        {
          stepId: "truepeoplesearch_step_4",
          action: "click",
          instruction: "Search for the matching TruePeopleSearch record.",
          selector: truePeopleSearchSelectors.searchButton,
        },
        {
          stepId: "truepeoplesearch_step_5",
          action: "click",
          instruction: "Select the first matching result.",
          selector: truePeopleSearchSelectors.firstResultButton,
        },
        {
          stepId: "truepeoplesearch_step_6",
          action: "fill",
          instruction: "Enter the privacy email address.",
          selector: truePeopleSearchSelectors.email,
          inputKey: "privacy_email",
        },
        {
          stepId: "truepeoplesearch_step_7",
          action: "click",
          instruction: "Submit the TruePeopleSearch removal request.",
          selector: truePeopleSearchSelectors.submitButton,
        },
      ],
    },
  };
}

export const truePeopleSearchAutomationSite: AutomationSiteExecutor = {
  id: "truepeoplesearch-site-adapter",
  siteIds: ["TruePeopleSearch", "truepeoplesearch"],
  async execute(input, context) {
    const { handoff, startedAt } = input;
    const normalizedHandoff = normalizeTruePeopleSearchHandoff(handoff);
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

    if (hasAnyPhrase(finalPageText, truePeopleSearchFallbackPhrases.captcha)) {
      return buildGenericAdapterResult({
        handoff: normalizedHandoff,
        executorId: this.id,
        startedAt,
        completedAt,
        status: "manual_required",
        manualReviewRequired: true,
        confirmationText: finalPageText,
        errorText: "TruePeopleSearch presented a CAPTCHA during confirmation review.",
        failureCode: "captcha",
        reviewReasons: ["captcha"],
        genericRecord,
      });
    }

    if (hasAnyPhrase(finalPageText, truePeopleSearchFallbackPhrases.blocked)) {
      return buildGenericAdapterResult({
        handoff: normalizedHandoff,
        executorId: this.id,
        startedAt,
        completedAt,
        status: "failed",
        manualReviewRequired: false,
        confirmationText: finalPageText,
        errorText: "TruePeopleSearch blocked the automated removal flow.",
        failureCode: "rate_limited",
        reviewReasons: ["rate_limited"],
        genericRecord,
      });
    }

    if (!matchesConfirmationText(finalPageText, truePeopleSearchConfirmationPhrases, "email_confirmation")) {
      const reviewArtifact = createAutomationArtifact({
        handoff: normalizedHandoff,
        kind: "execution_log",
        suffix: "confirmation-review",
        createdAt: completedAt,
        label: "TruePeopleSearch confirmation review",
        contentType: "text/plain",
        content: "TruePeopleSearch did not present the expected email-confirmation language after submission.",
      });

      return buildGenericAdapterResult({
        handoff: normalizedHandoff,
        executorId: this.id,
        startedAt,
        completedAt,
        status: "manual_required",
        manualReviewRequired: true,
        confirmationText: null,
        errorText: "TruePeopleSearch confirmation page did not match expected text.",
        failureCode: "manual_review_required",
        reviewReasons: ["manual_submission_required"],
        genericRecord,
        extraArtifacts: [reviewArtifact],
        extraStepOutcomes: [createStepOutcome({
          step: {
            stepId: "truepeoplesearch_confirmation_review",
            action: "manual_review",
            instruction: "Review the TruePeopleSearch confirmation page manually.",
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
