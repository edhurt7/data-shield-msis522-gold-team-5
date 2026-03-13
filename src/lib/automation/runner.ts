import { chromium } from "playwright";

import {
  actionHandoffSchema,
  executionResultSchema,
  type ReviewReason,
  type ActionHandoff,
  type ExecutionResult,
  type ProcedureStep,
} from "@/lib/agent/contracts";

import {
  capturePageHtml,
  capturePageScreenshot,
  capturePageText,
  createAutomationArtifact,
  createContractExecutionResult,
  createExecutionRecord,
  createStepLogArtifact,
  createStepOutcome,
} from "@/lib/automation/artifacts";
import {
  CaptchaAutomationError,
  isAutomationExecutionError,
  ManualReviewRequiredAutomationError,
  RateLimitedAutomationError,
  SelectorMissingAutomationError,
  SiteChangedAutomationError,
  TimeoutAutomationError,
} from "@/lib/automation/errors";
import { createDefaultAutomationSiteRegistry } from "@/lib/automation/site-registry";
import { hasAntiBotInterstitialSignal, hasBlockedAccessSignal } from "@/lib/automation/sites/shared";
import type {
  AutomationArtifact,
  AutomationBrowser,
  AutomationPage,
  AutomationStepLog,
  AutomationStepOutcome,
  ExecuteAutomationOptions,
} from "@/lib/automation/types";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_STEP_RETRIES = 1;

function createManualReviewRecord(handoff: ActionHandoff, startedAt: string, completedAt: string, message: string) {
  const reviewArtifact = createAutomationArtifact({
    handoff,
    kind: "execution_log",
    suffix: "manual-review",
    createdAt: completedAt,
    label: "Automation manual review log",
    contentType: "text/plain",
    content: message,
  });

  const executionResult = createContractExecutionResult({
    handoff,
    status: "manual_required",
    manualReviewRequired: true,
    errorText: message,
  });

  return createExecutionRecord({
    handoff,
    executorId: "automation-runner",
    startedAt,
    completedAt,
    executionResult: executionResultSchema.parse(executionResult),
    failureCode: "manual_review_required",
    reviewReasons: handoff.reviewReasons.length > 0 ? handoff.reviewReasons : ["manual_submission_required"],
    artifacts: [reviewArtifact],
    stepOutcomes: [],
  });
}

function createFailureResult(
  handoff: ActionHandoff,
  status: ExecutionResult["status"],
  startedAt: string,
  completedAt: string,
  message: string,
  artifacts: AutomationArtifact[] = [],
  stepOutcomes: AutomationStepOutcome[] = [],
  stepLogs: AutomationStepLog[] = [],
) {
  const failureArtifacts = [
    createAutomationArtifact({
      handoff,
      kind: "execution_log",
      suffix: "failure-log",
      createdAt: completedAt,
      label: "Automation failure log",
      contentType: "text/plain",
      content: message,
    }),
    ...artifacts,
    ...(stepLogs.length > 0
      ? [createStepLogArtifact({
        handoff,
        createdAt: completedAt,
        stepLogs,
        suffix: "failure-step-log",
        label: "Automation failure step log",
      })]
      : []),
  ];

  const screenshotArtifact = failureArtifacts.find((artifact) => artifact.kind === "screenshot");
  const pageTextArtifact = [...failureArtifacts]
    .reverse()
    .find((artifact) => artifact.kind === "page_text" && typeof artifact.content === "string");
  const htmlArtifact = [...failureArtifacts]
    .reverse()
    .find((artifact) => artifact.kind === "html_snapshot" && typeof artifact.content === "string");
  const capturedSignalText = [message, pageTextArtifact?.content, htmlArtifact?.content].filter(Boolean).join("\n");
  const failureCode = inferFailureCode(status, capturedSignalText);
  const reviewReasons = mapAutomationFailureToReviewReasons(failureCode, status);
  const effectiveStatus = failureCode === "rate_limited" ? "manual_required" : status;
  const userFacingMessage = failureCode === "rate_limited"
    && (hasBlockedAccessSignal(capturedSignalText) || hasAntiBotInterstitialSignal(capturedSignalText))
    ? "Destination site blocked the automated browser session (for example 403 Forbidden or an anti-bot interstitial)."
    : message;
  const executionResult = createContractExecutionResult({
    handoff,
    status: effectiveStatus,
    manualReviewRequired: effectiveStatus === "manual_required",
    screenshotRef: screenshotArtifact?.ref ?? null,
    confirmationText: pageTextArtifact?.content ?? null,
    errorText: userFacingMessage,
  });

  return createExecutionRecord({
    handoff,
    executorId: "automation-runner",
    startedAt,
    completedAt,
    executionResult: executionResultSchema.parse(executionResult),
    failureCode,
    reviewReasons,
    artifacts: failureArtifacts,
    stepOutcomes,
  });
}

function inferFailureCode(status: ExecutionResult["status"], signalText: string) {
  const normalized = signalText.toLowerCase();
  if (hasAntiBotInterstitialSignal(signalText)) {
    return "rate_limited" as const;
  }
  if (normalized.includes("captcha")) {
    return "captcha" as const;
  }
  if (hasBlockedAccessSignal(signalText)) {
    return "rate_limited" as const;
  }
  if (
    normalized.includes("rate limit")
    || normalized.includes("unusual traffic")
    || normalized.includes("blocked")
    || normalized.includes("access denied")
  ) {
    return "rate_limited" as const;
  }
  if (normalized.includes("selector")) {
    return "selector_missing" as const;
  }
  if (normalized.includes("layout") || normalized.includes("stale element") || normalized.includes("detached")) {
    return "site_changed" as const;
  }
  if (normalized.includes("timeout")) {
    return "timeout" as const;
  }
  return status === "manual_required" ? "manual_review_required" as const : null;
}

function mapAutomationFailureToReviewReasons(
  failureCode: ReturnType<typeof inferFailureCode>,
  status: ExecutionResult["status"],
): ReviewReason[] {
  switch (failureCode) {
    case "captcha":
      return ["captcha"];
    case "rate_limited":
      return ["rate_limited"];
    case "selector_missing":
    case "site_changed":
    case "manual_review_required":
    case "timeout":
      return ["manual_submission_required"];
    default:
      return status === "manual_required" ? ["manual_submission_required"] : [];
  }
}

function classifyAutomationError(error: unknown) {
  if (isAutomationExecutionError(error)) {
    return error;
  }

  if (!(error instanceof Error)) {
    return new ManualReviewRequiredAutomationError("Automation failed with a non-Error exception.", { cause: error });
  }

  const message = error.message.toLowerCase();
  if (message.includes("captcha") || message.includes("verify you are human")) {
    return new CaptchaAutomationError(error.message, { cause: error });
  }

  if (
    message.includes("unusual traffic")
    || message.includes("access denied")
    || message.includes("rate limit")
    || message.includes("too many requests")
    || message.includes("blocked")
  ) {
    return new RateLimitedAutomationError(error.message, { cause: error });
  }

  if (message.includes("timeout")) {
    return new TimeoutAutomationError(error.message, { cause: error });
  }

  if (message.includes("selector") || message.includes("locator") || message.includes("not found")) {
    return new SelectorMissingAutomationError(error.message, { cause: error });
  }

  if (message.includes("detached") || message.includes("stale element") || message.includes("layout")) {
    return new SiteChangedAutomationError(error.message, { cause: error });
  }

  return error;
}

function coerceFieldValue(step: ProcedureStep, handoff: ActionHandoff) {
  if (!step.inputKey) {
    return undefined;
  }

  const value = handoff.payload.fields[step.inputKey];
  if (typeof value === "undefined") {
    throw new ManualReviewRequiredAutomationError(
      `Automation step ${step.stepId} requires field "${step.inputKey}" but it was not present in the handoff.`,
    );
  }

  return value;
}

function requireSelector(step: ProcedureStep) {
  if (!step.selector) {
    throw new SelectorMissingAutomationError(`Automation step ${step.stepId} is missing a selector.`);
  }

  return step.selector;
}

function resolveWaitDurationMs(step: ProcedureStep, handoff: ActionHandoff) {
  const value = coerceFieldValue(step, handoff);
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 1000;
}

function toStepMessage(step: ProcedureStep) {
  return `${step.action}:${step.stepId}`;
}

async function executeStepAction(page: AutomationPage, handoff: ActionHandoff, step: ProcedureStep, timeoutMs: number) {
  switch (step.action) {
    case "navigate": {
      const targetUrl = step.targetUrl ?? coerceFieldValue(step, handoff);
      if (typeof targetUrl !== "string" || targetUrl.length === 0) {
        throw new ManualReviewRequiredAutomationError(`Navigate step ${step.stepId} is missing a target URL.`);
      }

      await page.goto(targetUrl, { timeout: timeoutMs });
      return;
    }
    case "fill": {
      const selector = requireSelector(step);
      const value = coerceFieldValue(step, handoff);
      if (typeof value !== "string") {
        throw new ManualReviewRequiredAutomationError(
          `Fill step ${step.stepId} requires a string field value for "${step.inputKey}".`,
        );
      }

      await page.fill(selector, value, { timeout: timeoutMs });
      return;
    }
    case "select": {
      const selector = requireSelector(step);
      const value = coerceFieldValue(step, handoff);
      if (typeof value !== "string" && !Array.isArray(value)) {
        throw new ManualReviewRequiredAutomationError(
          `Select step ${step.stepId} requires a string or string[] field value for "${step.inputKey}".`,
        );
      }

      await page.selectOption(selector, value, { timeout: timeoutMs });
      return;
    }
    case "click":
    case "submit": {
      const selector = requireSelector(step);
      await page.click(selector, { timeout: timeoutMs });
      return;
    }
    case "wait": {
      await page.waitForTimeout(resolveWaitDurationMs(step, handoff));
      return;
    }
    default:
      throw new ManualReviewRequiredAutomationError(
        `Automation step action "${step.action}" is not supported by the generic runner.`,
      );
  }
}

async function createPlaywrightBrowser(): Promise<AutomationBrowser> {
  const browser = await chromium.launch({ headless: true });

  return {
    async newPage() {
      const page = await browser.newPage();
      return {
        goto(url, options) {
          return page.goto(url, options).then(() => undefined);
        },
        fill(selector, value, options) {
          return page.fill(selector, value, options);
        },
        selectOption(selector, value, options) {
          return page.selectOption(selector, value, options).then(() => undefined);
        },
        click(selector, options) {
          return page.click(selector, options);
        },
        waitForTimeout(timeout) {
          return page.waitForTimeout(timeout);
        },
        content() {
          return page.content();
        },
        async innerText(selector) {
          return page.locator(selector).first().innerText();
        },
        async screenshot(options) {
          return Buffer.from(await page.screenshot(options));
        },
        close() {
          return page.close();
        },
      };
    },
    close() {
      return browser.close();
    },
  };
}

async function runGenericAutomation(handoff: ActionHandoff, options: ExecuteAutomationOptions = {}) {
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxStepRetries = options.maxStepRetries ?? DEFAULT_MAX_STEP_RETRIES;
  const screenshotOnFailure = options.screenshotOnFailure ?? true;
  const startedAt = now().toISOString();
  const browser = options.browser ?? await (options.browserFactory ?? createPlaywrightBrowser)();
  const ownsBrowser = !options.browser;
  const page = await browser.newPage();
  const stepLogs: AutomationStepLog[] = [];
  const stepOutcomes: AutomationStepOutcome[] = [];
  const artifacts: AutomationArtifact[] = [];

  try {
    for (const step of handoff.payload.steps) {
      const stepStart = now();
      let lastError: unknown = null;
      let completed = false;
      let lastCompletedAt = now();

      for (let attempt = 1; attempt <= maxStepRetries + 1; attempt += 1) {
        try {
          await executeStepAction(page, handoff, step, timeoutMs);
          lastCompletedAt = now();
          const completedAt = lastCompletedAt.toISOString();
          const startedAtIso = stepStart.toISOString();
          stepLogs.push({
            stepId: step.stepId,
            action: step.action,
            attempt,
            status: "completed",
            startedAt: startedAtIso,
            completedAt,
            durationMs: lastCompletedAt.getTime() - stepStart.getTime(),
            selector: step.selector,
            targetUrl: step.targetUrl,
            inputKey: step.inputKey,
            message: `${toStepMessage(step)} completed`,
            artifactIds: [],
          });
          stepOutcomes.push(createStepOutcome({
            step,
            startedAt: startedAtIso,
            completedAt,
            status: "completed",
            notes: `Completed on attempt ${attempt}.`,
          }));
          completed = true;
          break;
        } catch (error) {
          const classifiedError = classifyAutomationError(error);
          lastError = classifiedError;
          lastCompletedAt = now();
          const completedAt = lastCompletedAt.toISOString();
          const startedAtIso = stepStart.toISOString();
          const artifactIds: string[] = [];

          if (attempt > maxStepRetries && screenshotOnFailure) {
            const [screenshotArtifact, htmlArtifact, textArtifact] = await Promise.all([
              capturePageScreenshot({
                handoff,
                page,
                createdAt: completedAt,
                suffix: `${step.stepId}-failure-screenshot`,
                label: `Failure screenshot for ${step.stepId}`,
                metadata: { step_id: step.stepId, attempt },
              }),
              capturePageHtml({
                handoff,
                page,
                createdAt: completedAt,
                suffix: `${step.stepId}-failure-html`,
                label: `Failure HTML snapshot for ${step.stepId}`,
                metadata: { step_id: step.stepId, attempt },
              }),
              capturePageText({
                handoff,
                page,
                createdAt: completedAt,
                suffix: `${step.stepId}-failure-text`,
                label: `Failure page text for ${step.stepId}`,
                metadata: { step_id: step.stepId, attempt },
              }),
            ]);
            artifacts.push(screenshotArtifact, htmlArtifact, textArtifact);
            artifactIds.push(screenshotArtifact.artifactId, htmlArtifact.artifactId, textArtifact.artifactId);
          }

          stepLogs.push({
            stepId: step.stepId,
            action: step.action,
            attempt,
            status: attempt > maxStepRetries ? "failed" : "pending",
            startedAt: startedAtIso,
            completedAt,
            durationMs: lastCompletedAt.getTime() - stepStart.getTime(),
            selector: step.selector,
            targetUrl: step.targetUrl,
            inputKey: step.inputKey,
            message: classifiedError instanceof Error ? classifiedError.message : "Unknown automation error",
            artifactIds,
          });

          if (attempt > maxStepRetries) {
            stepOutcomes.push(createStepOutcome({
              step,
              startedAt: startedAtIso,
              completedAt,
              status: classifiedError instanceof ManualReviewRequiredAutomationError
                || classifiedError instanceof SelectorMissingAutomationError
                || classifiedError instanceof CaptchaAutomationError
                || classifiedError instanceof SiteChangedAutomationError
                ? "manual_review_required"
                : "failed",
              artifactIds,
              notes: classifiedError instanceof Error ? classifiedError.message : "Unknown automation error",
            }));
          }
        }
      }

      if (!completed) {
        throw lastError instanceof Error ? lastError : new Error("Automation step failed.");
      }
    }

    const completedAt = now().toISOString();
    const stepLogArtifact = createStepLogArtifact({
      handoff,
      createdAt: completedAt,
      stepLogs,
    });
    artifacts.push(stepLogArtifact);

    const finalTextArtifact = await capturePageText({
      handoff,
      page,
      createdAt: completedAt,
      suffix: "final-page-text",
      label: "Final page text capture",
    });
    artifacts.push(finalTextArtifact);
    const finalScreenshotArtifact = await capturePageScreenshot({
      handoff,
      page,
      createdAt: completedAt,
      suffix: "success-screenshot",
      label: "Success screenshot",
    });
    artifacts.push(finalScreenshotArtifact);

    const executionResult = createContractExecutionResult({
      handoff,
      status: "submitted",
      screenshotRef: finalScreenshotArtifact.ref,
      confirmationText: finalTextArtifact.content ?? "Generic Playwright runner completed all configured steps.",
    });

    return createExecutionRecord({
      handoff,
      executorId: "generic-playwright-runner",
      startedAt,
      completedAt,
      executionResult: executionResultSchema.parse(executionResult),
      failureCode: null,
      reviewReasons: [],
      artifacts,
      stepOutcomes,
    });
  } catch (error) {
    const classifiedError = classifyAutomationError(error);
    const completedAt = now().toISOString();
    return createFailureResult(
      handoff,
      isAutomationExecutionError(classifiedError) && classifiedError.manualReviewRequired ? "manual_required" : "failed",
      startedAt,
      completedAt,
      classifiedError instanceof Error ? classifiedError.message : "Unknown automation error",
      artifacts,
      stepOutcomes,
      stepLogs,
    );
  } finally {
    await page.close();
    if (ownsBrowser) {
      await browser.close();
    }
  }
}

export async function executeAutomation(handoff: ActionHandoff, options: ExecuteAutomationOptions = {}) {
  const parsedHandoff = actionHandoffSchema.parse(handoff);
  const now = options.now ?? (() => new Date());
  const registry = options.registry ?? createDefaultAutomationSiteRegistry();
  const startedAt = now().toISOString();

  if (parsedHandoff.mode !== "auto") {
    const completedAt = now().toISOString();
    return createManualReviewRecord(
      parsedHandoff,
      startedAt,
      completedAt,
      `Automation skipped because handoff mode is ${parsedHandoff.mode}.`,
    );
  }

  if (parsedHandoff.requiresUserApproval) {
    const completedAt = now().toISOString();
    return createManualReviewRecord(
      parsedHandoff,
      startedAt,
      completedAt,
      "Automation skipped because explicit user approval is still required.",
    );
  }

  if (parsedHandoff.reviewReasons.length > 0) {
    const completedAt = now().toISOString();
    return createManualReviewRecord(
      parsedHandoff,
      startedAt,
      completedAt,
      `Automation skipped because review reasons remain open: ${parsedHandoff.reviewReasons.join(", ")}.`,
    );
  }

  const siteExecutor = registry.get(parsedHandoff.payload.siteId);
  if (siteExecutor) {
    try {
      return await siteExecutor.execute(
        {
          handoff: parsedHandoff,
          startedAt,
        },
        {
          now,
          executeGeneric: (nextHandoff: ActionHandoff) => runGenericAutomation(nextHandoff, options),
        },
      );
    } catch (error) {
      const completedAt = now().toISOString();

      if (isAutomationExecutionError(error)) {
        return createFailureResult(
          parsedHandoff,
          error.manualReviewRequired ? "manual_required" : "failed",
          startedAt,
          completedAt,
          `${error.code}: ${error.message}`,
        );
      }

      const classifiedError = classifyAutomationError(error);
      if (classifiedError instanceof Error) {
        return createFailureResult(
          parsedHandoff,
          isAutomationExecutionError(classifiedError) && classifiedError.manualReviewRequired ? "manual_required" : "failed",
          startedAt,
          completedAt,
          classifiedError.message,
        );
      }

      throw new ManualReviewRequiredAutomationError("Automation failed with a non-Error exception.", { cause: error });
    }
  }

  return runGenericAutomation(parsedHandoff, options);
}
