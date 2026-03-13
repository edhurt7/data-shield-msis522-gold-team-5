import type { ActionHandoff } from "@/lib/agent/contracts";

import {
  createAutomationArtifact,
  createStepOutcome,
} from "@/lib/automation/artifacts";
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

export const FAST_PEOPLE_SEARCH_ENTRY_URL = "https://www.fastpeoplesearch.com/removal";

export const fastPeopleSearchSelectors = {
  email: "#fp_email",
  name: "#fp_name",
  state: "#fp_state",
  searchButton: "#search-record",
  firstResultCheckbox: "input[name='selected-record']",
  removalReason: "#removal-reason",
  submitButton: "#submit-removal",
} as const;

export const fastPeopleSearchConfirmationPhrases = [
  "your removal request has been received",
  "pending review",
] as const;

export const fastPeopleSearchFallbackPhrases = {
  captcha: ["captcha", "verify you are human"],
  blocked: ["access denied", "unusual traffic", "rate limit"],
} as const;

function normalizeFastPeopleSearchHandoff(handoff: ActionHandoff): ActionHandoff {
  requireSubmissionChannel(handoff, "webform", "FastPeopleSearch");

  const privacyEmail = getRequiredStringField(handoff, "privacy_email", "FastPeopleSearch");
  const fullName = getRequiredStringField(handoff, "full_name", "FastPeopleSearch");
  const state = getOptionalStringField(handoff, "state") ?? "Washington";

  return {
    ...handoff,
    payload: {
      ...handoff.payload,
      fields: {
        ...handoff.payload.fields,
        privacy_email: privacyEmail,
        full_name: fullName,
        state,
        candidate_url: typeof handoff.payload.fields.candidate_url === "string"
          ? handoff.payload.fields.candidate_url
          : `https://www.fastpeoplesearch.com/name/${encodeURIComponent(fullName.replace(/\s+/g, "-").toLowerCase())}`,
      },
      steps: [
        {
          stepId: "fps_step_1",
          action: "navigate",
          instruction: "Open the FastPeopleSearch removal page.",
          targetUrl: FAST_PEOPLE_SEARCH_ENTRY_URL,
        },
        {
          stepId: "fps_step_2",
          action: "fill",
          instruction: "Enter the privacy email address.",
          selector: fastPeopleSearchSelectors.email,
          inputKey: "privacy_email",
        },
        {
          stepId: "fps_step_3",
          action: "fill",
          instruction: "Enter the full name to search for the record.",
          selector: fastPeopleSearchSelectors.name,
          inputKey: "full_name",
        },
        {
          stepId: "fps_step_4",
          action: "select",
          instruction: "Select the state associated with the listing.",
          selector: fastPeopleSearchSelectors.state,
          inputKey: "state",
        },
        {
          stepId: "fps_step_5",
          action: "click",
          instruction: "Search for the matching FastPeopleSearch record.",
          selector: fastPeopleSearchSelectors.searchButton,
        },
        {
          stepId: "fps_step_6",
          action: "click",
          instruction: "Select the first matching record for removal.",
          selector: fastPeopleSearchSelectors.firstResultCheckbox,
        },
        {
          stepId: "fps_step_7",
          action: "select",
          instruction: "Choose the default privacy removal reason.",
          selector: fastPeopleSearchSelectors.removalReason,
          inputKey: "removal_reason",
          required: false,
        },
        {
          stepId: "fps_step_8",
          action: "click",
          instruction: "Submit the FastPeopleSearch removal request.",
          selector: fastPeopleSearchSelectors.submitButton,
        },
      ],
    },
  };
}

export const fastPeopleSearchAutomationSite: AutomationSiteExecutor = {
  id: "fastpeoplesearch-site-adapter",
  siteIds: ["FastPeopleSearch", "fastpeoplesearch"],
  async execute(input, context) {
    const { handoff, startedAt } = input;
    const normalizedHandoff = normalizeFastPeopleSearchHandoff(handoff);
    normalizedHandoff.payload.fields.removal_reason = typeof normalizedHandoff.payload.fields.removal_reason === "string"
      ? normalizedHandoff.payload.fields.removal_reason
      : "This is my personal information";

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

    if (hasAnyPhrase(finalPageText, fastPeopleSearchFallbackPhrases.captcha)) {
      return buildGenericAdapterResult({
        handoff: normalizedHandoff,
        executorId: this.id,
        startedAt,
        completedAt,
        status: "manual_required",
        manualReviewRequired: true,
        confirmationText: finalPageText,
        errorText: "FastPeopleSearch presented a CAPTCHA during confirmation review.",
        failureCode: "captcha",
        reviewReasons: ["captcha"],
        genericRecord,
      });
    }

    if (hasAnyPhrase(finalPageText, fastPeopleSearchFallbackPhrases.blocked)) {
      return buildGenericAdapterResult({
        handoff: normalizedHandoff,
        executorId: this.id,
        startedAt,
        completedAt,
        status: "failed",
        manualReviewRequired: false,
        confirmationText: finalPageText,
        errorText: "FastPeopleSearch blocked the automated removal flow.",
        failureCode: "rate_limited",
        reviewReasons: ["rate_limited"],
        genericRecord,
      });
    }

    if (!matchesConfirmationText(finalPageText, fastPeopleSearchConfirmationPhrases, "submission_received")) {
      const manualReviewArtifact = createAutomationArtifact({
        handoff: normalizedHandoff,
        kind: "execution_log",
        suffix: "confirmation-review",
        createdAt: completedAt,
        label: "FastPeopleSearch confirmation review",
        contentType: "text/plain",
        content: "FastPeopleSearch did not present the expected confirmation language after submission.",
      });

      return buildGenericAdapterResult({
        handoff: normalizedHandoff,
        executorId: this.id,
        startedAt,
        completedAt,
        status: "manual_required",
        manualReviewRequired: true,
        confirmationText: null,
        errorText: "FastPeopleSearch confirmation page did not match expected text.",
        failureCode: "manual_review_required",
        reviewReasons: ["manual_submission_required"],
        genericRecord,
        extraArtifacts: [manualReviewArtifact],
        extraStepOutcomes: [createStepOutcome({
          step: {
            stepId: "fps_confirmation_review",
            action: "manual_review",
            instruction: "Review the FastPeopleSearch confirmation page manually.",
          },
          startedAt,
          completedAt,
          status: "manual_review_required",
          artifactIds: [manualReviewArtifact.artifactId],
          notes: "Expected confirmation text was not detected after submission.",
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
      failureCode: null,
      reviewReasons: [],
      genericRecord,
    });
  },
};
