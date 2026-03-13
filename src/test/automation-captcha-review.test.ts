import { describe, expect, it } from "vitest";

import { classifyCaptchaReviewOutcome } from "@/lib/automation/captcha-review";

describe("classifyCaptchaReviewOutcome", () => {
  it("keeps the run paused when CAPTCHA text is still present", () => {
    const result = classifyCaptchaReviewOutcome("spokeo", "Please verify you are human to continue.");

    expect(result.status).toBe("manual_required");
    expect(result.failureCode).toBe("captcha");
    expect(result.reviewReasons).toEqual(["captcha"]);
  });

  it("marks the run pending once the confirmation text appears", () => {
    const result = classifyCaptchaReviewOutcome(
      "fastpeoplesearch",
      "Your removal request has been received and is pending review.",
    );

    expect(result.status).toBe("pending");
    expect(result.failureCode).toBeNull();
    expect(result.manualReviewRequired).toBe(false);
  });
});
