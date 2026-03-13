import type { ActionHandoff, ExecutionResult, ProcedureStep, ReviewReason } from "@/lib/agent/contracts";

import type { AutomationErrorCode } from "@/lib/automation/errors";

export type AutomationArtifactKind =
  | "execution_log"
  | "page_text"
  | "html_snapshot"
  | "screenshot";

export interface AutomationArtifact {
  artifactId: string;
  kind: AutomationArtifactKind;
  label: string;
  createdAt: string;
  ref: string | null;
  contentType?: string;
  content?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}

export type AutomationStepStatus =
  | "pending"
  | "completed"
  | "failed"
  | "manual_review_required";

export interface AutomationStepOutcome {
  stepId: string;
  action: ProcedureStep["action"];
  instruction: string;
  status: AutomationStepStatus;
  startedAt: string;
  completedAt: string;
  selector?: string;
  targetUrl?: string;
  artifactIds: string[];
  notes?: string;
}

export interface AutomationEvidence {
  startedAt: string;
  completedAt: string;
  siteId: string;
  handoffId: string;
  executorId: string;
  failureCode: AutomationErrorCode | null;
  reviewReasons: ReviewReason[];
  artifacts: AutomationArtifact[];
  stepOutcomes: AutomationStepOutcome[];
}

export interface AutomationExecutionRecord {
  handoff: ActionHandoff;
  executionResult: ExecutionResult;
  evidence: AutomationEvidence;
}

export interface AutomationExecutionContext {
  now: () => Date;
  executeGeneric: (handoff: ActionHandoff) => Promise<AutomationExecutionRecord>;
}

export interface AutomationPage {
  goto(url: string, options?: { timeout?: number }): Promise<void>;
  fill(selector: string, value: string, options?: { timeout?: number }): Promise<void>;
  selectOption(selector: string, value: string | string[], options?: { timeout?: number }): Promise<void>;
  click(selector: string, options?: { timeout?: number }): Promise<void>;
  waitForTimeout(timeout: number): Promise<void>;
  content(): Promise<string>;
  innerText(selector: string): Promise<string | null>;
  screenshot(options?: { type?: "png" }): Promise<Buffer>;
  close(): Promise<void>;
}

export interface AutomationBrowser {
  newPage(): Promise<AutomationPage>;
  close(): Promise<void>;
}

export interface AutomationStepLog {
  stepId: string;
  action: ProcedureStep["action"];
  attempt: number;
  status: AutomationStepStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  selector?: string;
  targetUrl?: string;
  inputKey?: string;
  message: string;
  artifactIds: string[];
 }

export interface AutomationSiteExecutionInput {
  handoff: ActionHandoff;
  startedAt: string;
}

export interface AutomationSiteExecutor {
  id: string;
  siteIds: string[];
  execute(
    input: AutomationSiteExecutionInput,
    context: AutomationExecutionContext,
  ): Promise<AutomationExecutionRecord> | AutomationExecutionRecord;
}

export interface AutomationSiteRegistry {
  get(siteId: string): AutomationSiteExecutor | undefined;
  has(siteId: string): boolean;
  list(): AutomationSiteExecutor[];
}

export interface ExecuteAutomationOptions {
  now?: () => Date;
  registry?: AutomationSiteRegistry;
  browser?: AutomationBrowser;
  browserFactory?: () => Promise<AutomationBrowser>;
  timeoutMs?: number;
  maxStepRetries?: number;
  screenshotOnFailure?: boolean;
}
