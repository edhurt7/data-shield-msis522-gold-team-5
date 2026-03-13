export type AutomationErrorCode =
  | "captcha"
  | "rate_limited"
  | "selector_missing"
  | "site_changed"
  | "timeout"
  | "manual_review_required";

export class AutomationExecutionError extends Error {
  readonly code: AutomationErrorCode;
  readonly manualReviewRequired: boolean;

  constructor(code: AutomationErrorCode, message: string, options?: { cause?: unknown; manualReviewRequired?: boolean }) {
    super(message, options);
    this.name = "AutomationExecutionError";
    this.code = code;
    this.manualReviewRequired = options?.manualReviewRequired ?? code !== "rate_limited";
  }
}

export class CaptchaAutomationError extends AutomationExecutionError {
  constructor(message = "Automation encountered a CAPTCHA challenge.", options?: { cause?: unknown }) {
    super("captcha", message, { ...options, manualReviewRequired: true });
    this.name = "CaptchaAutomationError";
  }
}

export class RateLimitedAutomationError extends AutomationExecutionError {
  constructor(message = "Automation was rate limited by the destination site.", options?: { cause?: unknown }) {
    super("rate_limited", message, { ...options, manualReviewRequired: false });
    this.name = "RateLimitedAutomationError";
  }
}

export class SelectorMissingAutomationError extends AutomationExecutionError {
  constructor(message = "Automation could not find a required selector on the destination site.", options?: { cause?: unknown }) {
    super("selector_missing", message, { ...options, manualReviewRequired: true });
    this.name = "SelectorMissingAutomationError";
  }
}

export class SiteChangedAutomationError extends AutomationExecutionError {
  constructor(message = "Destination site flow appears to have changed and requires review.", options?: { cause?: unknown }) {
    super("site_changed", message, { ...options, manualReviewRequired: true });
    this.name = "SiteChangedAutomationError";
  }
}

export class TimeoutAutomationError extends AutomationExecutionError {
  constructor(message = "Automation timed out while waiting for the destination site.", options?: { cause?: unknown }) {
    super("timeout", message, { ...options, manualReviewRequired: false });
    this.name = "TimeoutAutomationError";
  }
}

export class ManualReviewRequiredAutomationError extends AutomationExecutionError {
  constructor(message = "Automation requires manual review before continuing.", options?: { cause?: unknown }) {
    super("manual_review_required", message, { ...options, manualReviewRequired: true });
    this.name = "ManualReviewRequiredAutomationError";
  }
}

export function isAutomationExecutionError(error: unknown): error is AutomationExecutionError {
  return error instanceof AutomationExecutionError;
}
