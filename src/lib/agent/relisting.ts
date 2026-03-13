import { z } from "zod";

import { monitoredTargetSetSchema, type MonitoredTarget, type MonitoredTargetSet } from "@/lib/agent/contracts";
import { workflowRunOutputSchema, type WorkflowRunOutput, type WorkflowSiteRunOutput } from "@/lib/agent/workflow";

export const relistingMatchReasonSchema = z.enum([
  "exact_candidate_url",
  "exact_candidate_id",
  "profile_fingerprint",
]);

export const relistingDetectionSchema = z.object({
  targetId: z.string().min(1),
  siteId: z.string().min(1),
  siteName: z.string().min(1),
  reason: relistingMatchReasonSchema,
  confidence: z.number().min(0).max(1),
  previousCandidateUrl: z.string().url().nullable(),
  currentCandidateUrl: z.string().url(),
  previousReappearanceCount: z.number().int().min(0),
  newReappearanceCount: z.number().int().min(0),
  thresholdMet: z.boolean(),
  shouldTriggerRemovalCycle: z.boolean(),
  observedAt: z.string().datetime(),
  notes: z.string().min(1),
});

export const relistingComparisonReportSchema = z.object({
  targetSetId: z.string().min(1),
  sourceRunId: z.string().min(1),
  comparisonRunId: z.string().min(1),
  matchedSites: z.array(z.string().min(1)).default([]),
  unmatchedSites: z.array(z.string().min(1)).default([]),
  detections: z.array(relistingDetectionSchema).default([]),
});

export const relistingRemovalCycleActionSchema = z.enum([
  "start_new_cycle",
  "schedule_recheck",
  "hold_for_review",
]);

export const relistingRemovalCyclePlanItemSchema = z.object({
  targetId: z.string().min(1),
  siteId: z.string().min(1),
  siteName: z.string().min(1),
  action: relistingRemovalCycleActionSchema,
  reason: relistingMatchReasonSchema,
  confidence: z.number().min(0).max(1),
  previousReappearanceCount: z.number().int().min(0),
  newReappearanceCount: z.number().int().min(0),
  triggerAt: z.string().datetime().nullable(),
  comparisonRunId: z.string().min(1),
  detectionObservedAt: z.string().datetime(),
  backendRequired: z.boolean().default(true),
  notes: z.string().min(1),
});

export const relistingRemovalCyclePlanSchema = z.object({
  targetSetId: z.string().min(1),
  sourceRunId: z.string().min(1),
  comparisonRunId: z.string().min(1),
  readyCount: z.number().int().min(0),
  scheduledCount: z.number().int().min(0),
  reviewCount: z.number().int().min(0),
  items: z.array(relistingRemovalCyclePlanItemSchema).default([]),
});

export type RelistingMatchReason = z.infer<typeof relistingMatchReasonSchema>;
export type RelistingDetection = z.infer<typeof relistingDetectionSchema>;
export type RelistingComparisonReport = z.infer<typeof relistingComparisonReportSchema>;
export type RelistingRemovalCycleAction = z.infer<typeof relistingRemovalCycleActionSchema>;
export type RelistingRemovalCyclePlanItem = z.infer<typeof relistingRemovalCyclePlanItemSchema>;
export type RelistingRemovalCyclePlan = z.infer<typeof relistingRemovalCyclePlanSchema>;

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function normalizeSiteId(site: string) {
  return site.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function addDays(timestamp: string, days: number) {
  const date = new Date(timestamp);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function buildFingerprint(siteRun: WorkflowSiteRunOutput) {
  const candidate = siteRun.discovery_parse.candidates[0];
  const seedProfile = siteRun.validate_consent.seed_profile;

  if (!candidate) {
    return "";
  }

  return [
    normalize(candidate.extracted.name),
    normalize(candidate.extracted.age),
    normalize(seedProfile.location.city),
    normalize(seedProfile.location.state),
  ].join("|");
}

function buildTargetSetFingerprint(targetSet: MonitoredTargetSet, siteRun: WorkflowSiteRunOutput) {
  return [
    normalize(targetSet.profileName),
    normalize(siteRun.validate_consent.seed_profile.approx_age),
    normalize(siteRun.validate_consent.seed_profile.location.city),
    normalize(siteRun.validate_consent.seed_profile.location.state),
  ].join("|");
}

function detectAgainstTarget(
  target: MonitoredTarget,
  siteRun: WorkflowSiteRunOutput,
  targetSet: MonitoredTargetSet,
  comparisonRunId: string,
): RelistingDetection | null {
  const candidate = siteRun.discovery_parse.candidates[0];
  if (!candidate || !siteRun.discovery_parse.found) {
    return null;
  }

  const targetSiteId = normalizeSiteId(target.siteId);
  const runSiteId = normalizeSiteId(siteRun.site_input.site);
  if (targetSiteId !== runSiteId) {
    return null;
  }

  const candidateUrl = candidate.url;
  const currentCandidateId = siteRun.match_decision?.candidateId ?? candidateUrl;
  const reasonConfidencePairs: Array<{ reason: RelistingMatchReason; confidence: number }> = [];

  if (target.candidateUrl && normalize(target.candidateUrl) === normalize(candidateUrl)) {
    reasonConfidencePairs.push({ reason: "exact_candidate_url", confidence: 1 });
  }

  if (target.candidateId && normalize(target.candidateId) === normalize(currentCandidateId)) {
    reasonConfidencePairs.push({ reason: "exact_candidate_id", confidence: 0.98 });
  }

  if (buildTargetSetFingerprint(targetSet, siteRun) === buildFingerprint(siteRun)) {
    reasonConfidencePairs.push({ reason: "profile_fingerprint", confidence: 0.85 });
  }

  const bestMatch = reasonConfidencePairs.sort((left, right) => right.confidence - left.confidence)[0];
  if (!bestMatch) {
    return null;
  }

  const newReappearanceCount = target.reappearanceCount + 1;
  const thresholdMet = newReappearanceCount >= targetSet.monitoringPolicy.reReviewListingReappearanceThreshold;

  return relistingDetectionSchema.parse({
    targetId: target.targetId,
    siteId: target.siteId,
    siteName: target.siteName,
    reason: bestMatch.reason,
    confidence: bestMatch.confidence,
    previousCandidateUrl: target.candidateUrl,
    currentCandidateUrl: candidateUrl,
    previousReappearanceCount: target.reappearanceCount,
    newReappearanceCount,
    thresholdMet,
    shouldTriggerRemovalCycle: thresholdMet,
    observedAt: siteRun.discovery_parse.scan_timestamp,
    notes: thresholdMet
      ? `Relisting detected for ${target.siteName} during comparison run ${comparisonRunId}; the reappearance threshold is now met.`
      : `Relisting detected for ${target.siteName} during comparison run ${comparisonRunId}, but the reappearance threshold is not yet met.`,
  });
}

export function compareMonitoredTargetSetToWorkflowRun(
  targetSetInput: MonitoredTargetSet,
  workflowRunInput: WorkflowRunOutput,
): RelistingComparisonReport {
  const targetSet = monitoredTargetSetSchema.parse(targetSetInput);
  const workflowRun = workflowRunOutputSchema.parse(workflowRunInput);
  const detections = workflowRun.site_runs
    .flatMap((siteRun) => {
      const siteTargets = targetSet.targets.filter((target) => normalizeSiteId(target.siteId) === normalizeSiteId(siteRun.site_input.site));
      const matches = siteTargets
        .map((target) => detectAgainstTarget(target, siteRun, targetSet, workflowRun.context.run_id))
        .filter((detection): detection is RelistingDetection => detection !== null);

      if (matches.length === 0) {
        return [];
      }

      return [matches.sort((left, right) => right.confidence - left.confidence)[0]];
    });
  const matchedSites = [...new Set(detections.map((detection) => detection.siteName))];
  const unmatchedSites = workflowRun.site_runs
    .map((siteRun) => siteRun.site_input.site)
    .filter((site) => !matchedSites.includes(site));

  return relistingComparisonReportSchema.parse({
    targetSetId: targetSet.targetSetId,
    sourceRunId: targetSet.sourceRunId,
    comparisonRunId: workflowRun.context.run_id,
    matchedSites,
    unmatchedSites,
    detections,
  });
}

export function planRelistingTriggeredRemovalCycles(
  targetSetInput: MonitoredTargetSet,
  comparisonReportInput: RelistingComparisonReport,
): RelistingRemovalCyclePlan {
  const targetSet = monitoredTargetSetSchema.parse(targetSetInput);
  const comparisonReport = relistingComparisonReportSchema.parse(comparisonReportInput);
  const targetById = new Map(targetSet.targets.map((target) => [target.targetId, target]));
  const items = comparisonReport.detections.map((detection) => {
    const target = targetById.get(detection.targetId);
    const nextTriggerAt = target?.nextScanAt ?? addDays(detection.observedAt, targetSet.monitoringPolicy.reReviewCooldownDays);
    const action: RelistingRemovalCycleAction = detection.thresholdMet
      ? detection.confidence >= 0.9
        ? "start_new_cycle"
        : "hold_for_review"
      : "schedule_recheck";
    const triggerAt = action === "schedule_recheck"
      ? nextTriggerAt
      : action === "start_new_cycle"
        ? detection.observedAt
        : null;
    const notes = action === "start_new_cycle"
      ? `Prototype only: relisting threshold is met for ${detection.siteName}; start a new removal cycle when persistence and scheduling are available.`
      : action === "schedule_recheck"
        ? `Relisting is tracked for ${detection.siteName}, but the threshold is not met yet; keep the target in the monitored set and recheck later.`
        : `Relisting threshold is met for ${detection.siteName}, but confidence is below the auto-restart bar; route to manual review before starting a new cycle.`;

    return relistingRemovalCyclePlanItemSchema.parse({
      targetId: detection.targetId,
      siteId: detection.siteId,
      siteName: detection.siteName,
      action,
      reason: detection.reason,
      confidence: detection.confidence,
      previousReappearanceCount: detection.previousReappearanceCount,
      newReappearanceCount: detection.newReappearanceCount,
      triggerAt,
      comparisonRunId: comparisonReport.comparisonRunId,
      detectionObservedAt: detection.observedAt,
      backendRequired: true,
      notes,
    });
  });

  return relistingRemovalCyclePlanSchema.parse({
    targetSetId: targetSet.targetSetId,
    sourceRunId: targetSet.sourceRunId,
    comparisonRunId: comparisonReport.comparisonRunId,
    readyCount: items.filter((item) => item.action === "start_new_cycle").length,
    scheduledCount: items.filter((item) => item.action === "schedule_recheck").length,
    reviewCount: items.filter((item) => item.action === "hold_for_review").length,
    items,
  });
}
