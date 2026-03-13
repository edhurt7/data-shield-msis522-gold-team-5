import { actionHandoffSchema, optOutDraftSchema, type ActionHandoff } from "@/lib/agent/contracts";
import type { WorkflowSiteRunOutput } from "@/lib/agent/workflow";

function slugifyWorkflowId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createWorkflowAutomationHandoff(siteRun: WorkflowSiteRunOutput): ActionHandoff | null {
  if (!siteRun.plan_submission || !siteRun.retrieve_procedure || !siteRun.match_decision || !siteRun.discovery_parse.candidates[0]) {
    return null;
  }

  const actionPlan = siteRun.plan_submission.action_plan;
  if (actionPlan.submission_channel !== "webform") {
    return null;
  }

  const siteId = siteRun.site_input.site;
  const candidateId = `${slugifyWorkflowId(siteId)}-candidate-1`;
  const procedureId = `${slugifyWorkflowId(siteId)}-workflow-procedure`;
  const generatedAt = new Date().toISOString();
  const draft = optOutDraftSchema.parse({
    draftId: `${slugifyWorkflowId(siteId)}-draft`,
    siteId,
    candidateId,
    submissionChannel: actionPlan.submission_channel,
    body: actionPlan.email?.body
      ?? `Workflow-generated removal request for ${siteId}.`,
    factsUsed: [
      ...actionPlan.required_fields.map((field) => ({ field: field.name, value: field.value })),
      ...actionPlan.optional_fields.map((field) => ({ field: field.name, value: field.value })),
    ],
    procedureId,
    generatedAt,
  });

  const fields: Record<string, string | number | boolean | string[]> = {
    candidate_url: actionPlan.candidate_url,
    listing_url: actionPlan.candidate_url,
    full_name: siteRun.validate_consent.seed_profile.full_name,
    privacy_email: siteRun.validate_consent.seed_profile.privacy_email,
    state: siteRun.validate_consent.seed_profile.location.state,
  };

  for (const field of actionPlan.required_fields) {
    fields[field.name] = field.value;
  }
  for (const field of actionPlan.optional_fields) {
    fields[field.name] = field.value;
  }

  return actionHandoffSchema.parse({
    handoffId: `${slugifyWorkflowId(siteId)}-${slugifyWorkflowId(siteRun.context.run_id)}-handoff`,
    mode: siteRun.plan_submission.requires_manual_review ? "human_assisted" : "auto",
    requiresUserApproval: false,
    reviewReasons: siteRun.plan_submission.review_reasons,
    createdAt: generatedAt,
    payload: {
      siteId,
      candidateId,
      procedureId,
      procedureVersion: "workflow-v1",
      submissionChannel: actionPlan.submission_channel,
      fields,
      steps: [
        {
          stepId: `${slugifyWorkflowId(siteId)}-site-adapter`,
          action: "manual_review",
          instruction: `Site adapter will expand the workflow handoff for ${siteId}.`,
          required: false,
        },
      ],
      draft,
    },
  });
}
