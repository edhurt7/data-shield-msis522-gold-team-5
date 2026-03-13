import {
  createAgentWorkflow,
  createStructuredLlmAdapterFromEnv,
  type StructuredLlmAdapter,
} from "@/lib/agent";
import { fastPeopleSearchFixture } from "@/lib/agent/fixtures/fastpeoplesearch";
import { createDocumentProcedureRetriever } from "@/lib/agent/retrieval";
import type { WorkflowRunOutput } from "@/lib/agent/workflow";
import type { AutomationBrowser, AutomationPage, ExecuteAutomationOptions } from "@/lib/automation/types";

export type FastPeopleSearchMilestoneBrowserMode =
  | "fixture_confirmation"
  | "live_browser";

export interface RunFastPeopleSearchMilestoneOptions {
  env?: Record<string, unknown>;
  llmAdapter?: StructuredLlmAdapter;
  browserMode?: FastPeopleSearchMilestoneBrowserMode;
  confirmationText?: string;
  automation?: Omit<ExecuteAutomationOptions, "browser">;
}

export interface FastPeopleSearchMilestoneSummary {
  browserMode: FastPeopleSearchMilestoneBrowserMode;
  usedFixtureBrowser: boolean;
  site: string;
  runId: string;
  procedureType: string | null;
  draftChannel: string | null;
  handoffMode: string | null;
  automationStatus: string | null;
  manualReviewRequired: boolean | null;
  terminalPath: string | null;
  interpretResult: WorkflowRunOutput["interpret_result"];
  promptTrace: WorkflowRunOutput["prompt_trace"];
}

class ConfirmationPage implements AutomationPage {
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
    return Buffer.from("fastpeoplesearch-milestone");
  }

  async close() {
    this.operations.push("close:page");
  }
}

class ConfirmationBrowser implements AutomationBrowser {
  constructor(private readonly page: ConfirmationPage) {}

  async newPage() {
    return this.page;
  }

  async close() {
    return;
  }
}

function createFixtureConfirmationBrowser(confirmationText: string) {
  return new ConfirmationBrowser(new ConfirmationPage(confirmationText));
}

export function summarizeFastPeopleSearchMilestone(
  output: WorkflowRunOutput,
  browserMode: FastPeopleSearchMilestoneBrowserMode,
): FastPeopleSearchMilestoneSummary {
  return {
    browserMode,
    usedFixtureBrowser: browserMode === "fixture_confirmation",
    site: output.site_input.site,
    runId: output.context.run_id,
    procedureType: output.retrieve_procedure?.procedure_type ?? null,
    draftChannel: output.draft_optout?.submission_channel ?? null,
    handoffMode: output.automation_record?.handoff.mode ?? null,
    automationStatus: output.automation_record?.executionResult.status ?? null,
    manualReviewRequired: output.automation_record?.executionResult.manual_review_required ?? null,
    terminalPath: output.terminal_path,
    interpretResult: output.interpret_result,
    promptTrace: output.prompt_trace,
  };
}

export async function runFastPeopleSearchMilestone(
  options: RunFastPeopleSearchMilestoneOptions = {},
): Promise<{ output: WorkflowRunOutput; summary: FastPeopleSearchMilestoneSummary }> {
  const browserMode = options.browserMode ?? "fixture_confirmation";
  const adapter = options.llmAdapter ?? createStructuredLlmAdapterFromEnv({
    env: options.env ?? process.env,
  });
  const workflow = createAgentWorkflow({
    llm: {
      adapter,
    },
    procedureRetriever: createDocumentProcedureRetriever(),
  });
  const runId = `run_fps_milestone_${browserMode}_${Date.now()}`;
  const confirmationText = options.confirmationText
    ?? "Your removal request has been received and is pending review.";
  const automation = browserMode === "fixture_confirmation"
    ? {
      ...options.automation,
      browser: createFixtureConfirmationBrowser(confirmationText),
    }
    : options.automation;

  const output = await workflow.runWithAutomation({
    context: {
      run_id: runId,
      review_reasons: [],
      events: [],
    },
    seed_profile: fastPeopleSearchFixture.seedProfile,
    request_text: fastPeopleSearchFixture.requestText,
    site_input: {
      site: fastPeopleSearchFixture.site,
      page_artifact: fastPeopleSearchFixture.pageArtifact,
      retrieved_chunks: fastPeopleSearchFixture.procedureChunks,
    },
  }, {
    automation,
  });

  return {
    output,
    summary: summarizeFastPeopleSearchMilestone(output, browserMode),
  };
}
