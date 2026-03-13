import { describe, expect, it } from "vitest";

import { fastPeopleSearchFixture } from "@/lib/agent/fixtures/fastpeoplesearch";
import type { AutomationBrowser, AutomationPage } from "@/lib/automation/types";
import { createFixtureBackedWorkflow, fixtureWorkflowBaseContext } from "@/test/support/fixture-workflow";

class MockPage implements AutomationPage {
  readonly operations: string[] = [];

  constructor(private readonly pageText: string) {}

  async goto(url: string) {
    this.operations.push(`goto:${url}`);
  }

  async fill(selector: string, value: string) {
    this.operations.push(`fill:${selector}=${value}`);
  }

  async selectOption(selector: string, value: string | string[]) {
    this.operations.push(`select:${selector}=${Array.isArray(value) ? value.join("|") : value}`);
  }

  async click(selector: string) {
    this.operations.push(`click:${selector}`);
  }

  async waitForTimeout(timeout: number) {
    this.operations.push(`wait:${timeout}`);
  }

  async content() {
    return `<html><body>${this.pageText}</body></html>`;
  }

  async innerText(selector: string) {
    return selector === "body" ? this.pageText : null;
  }

  async screenshot() {
    return Buffer.from("workflow-automation-shot");
  }

  async close() {
    this.operations.push("close:page");
  }
}

class MockBrowser implements AutomationBrowser {
  constructor(private readonly page: AutomationPage) {}

  async newPage() {
    return this.page;
  }

  async close() {
    return;
  }
}

describe("agent workflow automation integration", () => {
  it("runs retrieval, draft, handoff, automation execution, and result interpretation end to end", async () => {
    const workflow = createFixtureBackedWorkflow();
    const confirmationText = "Your removal request has been received and is pending review.";

    const result = await workflow.runWithAutomation({
      context: {
        ...fixtureWorkflowBaseContext,
        run_id: "run_workflow_automation_001",
      },
      seed_profile: fastPeopleSearchFixture.seedProfile,
      request_text: fastPeopleSearchFixture.requestText,
      site_input: {
        site: fastPeopleSearchFixture.site,
        page_artifact: fastPeopleSearchFixture.pageArtifact,
        retrieved_chunks: [],
      },
    }, {
      automation: {
        browser: new MockBrowser(new MockPage(confirmationText)),
        now: () => new Date("2026-03-13T14:00:00.000Z"),
      },
    });

    expect(result.retrieve_procedure?.procedure_type).toBe("webform");
    expect(result.draft_optout?.submission_channel).toBe("webform");
    expect(result.plan_submission?.requires_manual_review).toBe(false);
    expect(result.automation_record).not.toBeNull();
    expect(result.automation_record?.handoff.mode).toBe("auto");
    expect(result.automation_record?.handoff.payload.siteId).toBe("FastPeopleSearch");
    expect(result.automation_record?.executionResult).toMatchObject({
      site: "FastPeopleSearch",
      status: "pending",
      manual_review_required: false,
      confirmation_text: confirmationText,
    });
    expect(result.automation_record?.evidence.failureCode).toBeNull();
    expect(result.automation_record?.evidence.reviewReasons).toEqual([]);
    expect(result.automation_record?.evidence.artifacts.some((artifact) => artifact.kind === "screenshot")).toBe(true);
    expect(result.interpret_result).toEqual({
      next_status: "pending",
      next_action: "await_confirmation",
      review_reasons: [],
    });
    expect(result.terminal_path).toBe("await_confirmation");
  });
});
