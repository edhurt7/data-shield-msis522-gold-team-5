import type { ActionHandoff } from "@/lib/agent/contracts";

import {
  createAutomationArtifact,
  createContractExecutionResult,
  createExecutionRecord,
  createStepOutcome,
} from "@/lib/automation/artifacts";
import { ManualReviewRequiredAutomationError } from "@/lib/automation/errors";
import type { AutomationSiteExecutor } from "@/lib/automation/types";

export const SITE_TEMPLATE_ENTRY_URL = "https://example.com/opt-out";

export const siteTemplateSelectors = {
  email: "#email",
  name: "#name",
  searchButton: "#search",
  submitButton: "#submit",
} as const;

export const siteTemplateConfirmationPhrases = [
  "request received",
  "pending review",
] as const;

function getRequiredStringField(handoff: ActionHandoff, key: string) {
  const value = handoff.payload.fields[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  throw new ManualReviewRequiredAutomationError(
    `Site adapter template requires a non-empty "${key}" field.`,
  );
}

function normalizeTemplateHandoff(handoff: ActionHandoff): ActionHandoff {
  const privacyEmail = getRequiredStringField(handoff, "privacy_email");
  const fullName = getRequiredStringField(handoff, "full_name");

  return {
    ...handoff,
    payload: {
      ...handoff.payload,
      fields: {
        ...handoff.payload.fields,
        privacy_email: privacyEmail,
        full_name: fullName,
      },
      steps: [
        {
          stepId: "template_step_1",
          action: "navigate",
          instruction: "Open the site-specific opt-out entry page.",
          targetUrl: SITE_TEMPLATE_ENTRY_URL,
        },
        {
          stepId: "template_step_2",
          action: "fill",
          instruction: "Enter the privacy email.",
          selector: siteTemplateSelectors.email,
          inputKey: "privacy_email",
        },
        {
          stepId: "template_step_3",
          action: "fill",
          instruction: "Enter the full name.",
          selector: siteTemplateSelectors.name,
          inputKey: "full_name",
        },
        {
          stepId: "template_step_4",
          action: "click",
          instruction: "Search for the record.",
          selector: siteTemplateSelectors.searchButton,
        },
        {
          stepId: "template_step_5",
          action: "click",
          instruction: "Submit the removal request.",
          selector: siteTemplateSelectors.submitButton,
        },
      ],
    },
  };
}

export const siteAdapterTemplate: AutomationSiteExecutor = {
  id: "site-adapter-template",
  siteIds: ["ExampleSite"],
  async execute(input, context) {
    const normalizedHandoff = normalizeTemplateHandoff(input.handoff);
    const genericRecord = await context.executeGeneric(normalizedHandoff);
    const completedAt = context.now().toISOString();
    const finalPageText = genericRecord.evidence.artifacts
      .find((artifact) => artifact.kind === "page_text" && artifact.label === "Final page text capture")
      ?.content ?? "";

    const hasConfirmation = siteTemplateConfirmationPhrases.some((phrase) =>
      finalPageText.toLowerCase().includes(phrase),
    );

    if (!hasConfirmation) {
      const reviewArtifact = createAutomationArtifact({
        handoff: normalizedHandoff,
        kind: "execution_log",
        suffix: "confirmation-review",
        createdAt: completedAt,
        label: "Site adapter template confirmation review",
        contentType: "text/plain",
        content: "Expected confirmation text was not found after submission.",
      });

      return createExecutionRecord({
        handoff: normalizedHandoff,
        executorId: this.id,
        startedAt: input.startedAt,
        completedAt,
        executionResult: createContractExecutionResult({
          handoff: normalizedHandoff,
          status: "manual_required",
          manualReviewRequired: true,
          confirmationText: null,
          errorText: "Expected confirmation text was not found after submission.",
        }),
        artifacts: [...genericRecord.evidence.artifacts, reviewArtifact],
        stepOutcomes: [
          ...genericRecord.evidence.stepOutcomes,
          createStepOutcome({
            step: {
              stepId: "template_confirmation_review",
              action: "manual_review",
              instruction: "Review the post-submit page manually.",
            },
            startedAt: input.startedAt,
            completedAt,
            status: "manual_review_required",
            artifactIds: [reviewArtifact.artifactId],
            notes: "Template adapter requires confirmation matching before marking success.",
          }),
        ],
      });
    }

    return createExecutionRecord({
      handoff: normalizedHandoff,
      executorId: this.id,
      startedAt: input.startedAt,
      completedAt,
      executionResult: createContractExecutionResult({
        handoff: normalizedHandoff,
        status: "pending",
        manualReviewRequired: false,
        confirmationText: finalPageText,
        screenshotRef: genericRecord.executionResult.screenshot_ref,
      }),
      artifacts: genericRecord.evidence.artifacts,
      stepOutcomes: genericRecord.evidence.stepOutcomes,
    });
  },
};
