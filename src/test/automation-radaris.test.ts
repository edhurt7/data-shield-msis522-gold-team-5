import { describe, expect, it } from "vitest";

import { executeAutomation } from "@/lib/automation/runner";
import { createDefaultAutomationSiteRegistry, getAutomationSupportEntry } from "@/lib/automation/site-registry";
import { RADARIS_REMOVAL_EMAIL } from "@/lib/automation/sites/radaris";

function createHandoff() {
  return {
    handoffId: "handoff_radaris_001",
    mode: "auto",
    requiresUserApproval: false,
    reviewReasons: [],
    createdAt: "2026-03-13T13:00:00.000Z",
    payload: {
      siteId: "Radaris",
      candidateId: "cand_radaris_001",
      procedureId: "proc_radaris_v1",
      procedureVersion: "v1",
      submissionChannel: "email",
      fields: {
        full_name: "Jane Doe",
        privacy_email: "shield@example.com",
        candidate_url: "https://radaris.com/p/Jane-Doe/Seattle-WA",
      },
      steps: [{
        stepId: "radaris_email_prepare",
        action: "submit",
        instruction: "Prepare the Radaris removal email payload for delivery.",
      }],
      draft: {
        draftId: "draft_radaris_001",
        siteId: "Radaris",
        candidateId: "cand_radaris_001",
        submissionChannel: "email",
        subject: "Radaris removal request",
        body: "Please remove my information from Radaris.",
        factsUsed: [{ field: "full_name", value: "Jane Doe" }],
        procedureId: "proc_radaris_v1",
        generatedAt: "2026-03-13T13:00:00.000Z",
      },
    },
  };
}

describe("Radaris automation site", () => {
  it("is registered in the default automation site registry", () => {
    const registry = createDefaultAutomationSiteRegistry();

    expect(registry.has("Radaris")).toBe(true);
    expect(registry.get("Radaris")?.id).toBe("radaris-site-adapter");
    expect(getAutomationSupportEntry("Radaris")?.status).toBe("partial");
  });

  it("serializes the email-backed removal payload into a pending execution record", async () => {
    const result = await executeAutomation(createHandoff(), {
      now: () => new Date("2026-03-13T13:06:00.000Z"),
    });

    expect(result.executionResult).toMatchObject({
      site: "Radaris",
      status: "pending",
      manual_review_required: false,
      confirmation_text: `Prepared Radaris removal email to ${RADARIS_REMOVAL_EMAIL}. Delivery transport is not wired in this harness.`,
    });
    expect(result.evidence.executorId).toBe("radaris-site-adapter");
    expect(result.evidence.stepOutcomes[0]).toMatchObject({
      stepId: "radaris_email_prepare",
      status: "completed",
    });
    expect(result.evidence.artifacts[0]?.content).toContain(RADARIS_REMOVAL_EMAIL);
    expect(result.evidence.artifacts[0]?.content).toContain("Radaris removal request");
  });
});
