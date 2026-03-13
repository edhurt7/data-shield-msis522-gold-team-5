import type { ActionHandoff, ProcedureStep } from "@/lib/agent/contracts";

import {
  createAutomationArtifact,
  createContractExecutionResult,
  createExecutionRecord,
  createStepOutcome,
} from "@/lib/automation/artifacts";
import type { AutomationSiteExecutor } from "@/lib/automation/types";
import {
  getOptionalStringField,
  getRequiredStringField,
  requireSubmissionChannel,
} from "@/lib/automation/sites/shared";

export const RADARIS_REMOVAL_EMAIL = "privacy@radaris.example";

function normalizeRadarisHandoff(handoff: ActionHandoff): ActionHandoff {
  requireSubmissionChannel(handoff, "email", "Radaris");

  const fullName = getRequiredStringField(handoff, "full_name", "Radaris");
  const privacyEmail = getRequiredStringField(handoff, "privacy_email", "Radaris");
  const candidateUrl = getOptionalStringField(handoff, "candidate_url")
    ?? getOptionalStringField(handoff, "listing_url")
    ?? `https://www.radaris.com/p/${encodeURIComponent(fullName.toLowerCase().replace(/\s+/g, "-"))}`;

  return {
    ...handoff,
    payload: {
      ...handoff.payload,
      fields: {
        ...handoff.payload.fields,
        full_name: fullName,
        privacy_email: privacyEmail,
        candidate_url: candidateUrl,
        removal_email_to: getOptionalStringField(handoff, "removal_email_to") ?? RADARIS_REMOVAL_EMAIL,
      },
      steps: handoff.payload.steps.length > 0 ? handoff.payload.steps : [
        {
          stepId: "radaris_email_prepare",
          action: "submit",
          instruction: "Prepare the Radaris removal email payload for delivery.",
        },
      ],
    },
  };
}

function createCompletionStep(handoff: ActionHandoff): ProcedureStep {
  return handoff.payload.steps[0] ?? {
    stepId: "radaris_email_prepare",
    action: "submit",
    instruction: "Prepare the Radaris removal email payload for delivery.",
  };
}

export const radarisAutomationSite: AutomationSiteExecutor = {
  id: "radaris-site-adapter",
  siteIds: ["Radaris", "radaris"],
  async execute(input, context) {
    const { handoff, startedAt } = input;
    const normalizedHandoff = normalizeRadarisHandoff(handoff);
    const completedAt = context.now().toISOString();
    const recipient = String(normalizedHandoff.payload.fields.removal_email_to);
    const draftSubject = normalizedHandoff.payload.draft.subject ?? "Radaris removal request";
    const draftBody = normalizedHandoff.payload.draft.body;
    const emailPayload = {
      to: recipient,
      from: normalizedHandoff.payload.fields.privacy_email,
      subject: draftSubject,
      body: draftBody,
      candidate_url: normalizedHandoff.payload.fields.candidate_url,
    };
    const emailArtifact = createAutomationArtifact({
      handoff: normalizedHandoff,
      kind: "execution_log",
      suffix: "email-payload",
      createdAt: completedAt,
      label: "Radaris email payload",
      contentType: "application/json",
      content: JSON.stringify(emailPayload, null, 2),
    });
    const executionResult = createContractExecutionResult({
      handoff: normalizedHandoff,
      status: "pending",
      manualReviewRequired: false,
      confirmationText: `Prepared Radaris removal email to ${recipient}. Delivery transport is not wired in this harness.`,
      errorText: null,
    });

    return createExecutionRecord({
      handoff: normalizedHandoff,
      executorId: this.id,
      startedAt,
      completedAt,
      executionResult,
      failureCode: null,
      reviewReasons: [],
      artifacts: [emailArtifact],
      stepOutcomes: [createStepOutcome({
        step: createCompletionStep(normalizedHandoff),
        startedAt,
        completedAt,
        status: "completed",
        artifactIds: [emailArtifact.artifactId],
        notes: `Serialized outbound removal email for ${recipient}.`,
      })],
    });
  },
};
