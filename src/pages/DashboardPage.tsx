import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import { ChatBar } from "@/components/ChatBar";
import { ListingDetailPanel } from "@/components/ListingDetailPanel";
import { ScanProgress } from "@/components/ScanProgress";
import { ScanTable } from "@/components/ScanTable";
import { Button } from "@/components/ui/button";
import { useAgentChat, useAgentDashboard, useLiveDemoStatus, useResumeCaptchaSession, useRunLiveDemo } from "@/hooks/use-agent-dashboard";
import type { DemoHarnessCaptchaSessionSnapshot, DemoHarnessRun } from "@/lib/automation/demo-harness";
import { getScanSummary, mockBrokerSites, mockChatMessages, type BrokerSite } from "@/lib/mock-data";

export default function DashboardPage() {
  const [selectedSite, setSelectedSite] = useState<BrokerSite | null>(null);
  const dashboardQuery = useAgentDashboard();
  const chatMutation = useAgentChat();
  const liveDemoQuery = useLiveDemoStatus();
  const runLiveDemoMutation = useRunLiveDemo();
  const resumeCaptchaMutation = useResumeCaptchaSession();

  const isDemoMode = Boolean(liveDemoQuery.data?.dashboard);
  const brokerSites = useMemo(() => (
    liveDemoQuery.data
      ? attachLiveDemoEvidence(
        liveDemoQuery.data.dashboard.brokerSites,
        liveDemoQuery.data.runs,
        liveDemoQuery.data.captchaSessions ?? [],
      )
      : dashboardQuery.data?.brokerSites ?? mockBrokerSites
  ), [dashboardQuery.data?.brokerSites, liveDemoQuery.data]);
  const chatMessages = liveDemoQuery.data?.dashboard.chatMessages ?? dashboardQuery.data?.chatMessages ?? mockChatMessages;
  const liveDemoSummary = liveDemoQuery.data?.summary;
  const latestCompletedAt = liveDemoQuery.data?.completedAt;
  const completedSitesLabel = liveDemoSummary?.completedSites.join(", ") ?? "";
  const scanSummary = getScanSummary(brokerSites);
  const fixtureBackedSubmittedCount = brokerSites.filter((site) => site.status === "opted_out" && site.demoMetadata?.isFixtureBacked).length;
  const manualFallbackReadyCount = brokerSites.filter((site) => site.demoMetadata?.manualFallbackReady).length;
  const captchaSessionCount = liveDemoQuery.data?.captchaSessions?.length ?? 0;

  const statusTone = liveDemoSummary
    ? "border-success/30 bg-success/10"
    : "border-border bg-card";

  useEffect(() => {
    if (!selectedSite) return;

    const nextSelectedSite = brokerSites.find((site) => site.id === selectedSite.id);
    if (nextSelectedSite && nextSelectedSite !== selectedSite) {
      setSelectedSite(nextSelectedSite);
    }
  }, [brokerSites, selectedSite]);

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <ScanProgress sites={brokerSites} />
      <div className={`rounded-lg border p-4 ${statusTone}`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-display text-2xl font-bold text-foreground">
              {isDemoMode ? "Live Demo Runner" : "Scan Dashboard"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isDemoMode
                ? "Run the prototype through the localhost demo server, classify live broker outcomes, and prepare next steps for sites that block automation."
                : "Monitor scan coverage and launch the multi-site localhost demo harness from the same control surface."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => runLiveDemoMutation.mutate("fixture_confirmation")}
              disabled={runLiveDemoMutation.isPending}
            >
              {runLiveDemoMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Run Demo Scan
            </Button>
            <Button
              onClick={() => runLiveDemoMutation.mutate("live_browser")}
              disabled={runLiveDemoMutation.isPending}
            >
              {runLiveDemoMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Run Live Scan
            </Button>
          </div>
        </div>
        <div className="mt-3 space-y-2 text-sm">
          {runLiveDemoMutation.error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive whitespace-pre-wrap">
              {runLiveDemoMutation.error.message}
            </p>
          ) : null}
          {liveDemoQuery.isError ? (
            <p className="rounded-md border border-border bg-muted/40 p-3 text-muted-foreground">
              Demo server not reachable yet. Start `npm run demo:server` in another terminal.
            </p>
          ) : null}
          <div className="rounded-md border bg-background/70 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-success" />
                  <p className="font-medium text-foreground">
                    {liveDemoSummary
                      ? liveDemoSummary.browserMode === "fixture_confirmation"
                        ? "Deterministic end-to-end demo completed"
                        : "Live evidence capture completed"
                      : "Current dashboard snapshot loaded"}
                  </p>
                </div>
                <p className="text-muted-foreground">
                  {liveDemoSummary
                    ? `Run ID: ${liveDemoSummary.runId}${latestCompletedAt ? ` · Updated ${new Date(latestCompletedAt).toLocaleTimeString()}` : ""}`
                    : `Tracking ${scanSummary.total} broker sites in the current dashboard state.`}
                </p>
                {liveDemoSummary ? (
                  <p className="text-muted-foreground">
                    {captchaSessionCount > 0
                      ? `${captchaSessionCount} site${captchaSessionCount === 1 ? "" : "s"} waiting on CAPTCHA solve in the live browser.`
                      : scanSummary.blocked > 0
                      ? `${scanSummary.blocked} live brokers blocked automation and ${manualFallbackReadyCount} manual submission packets are ready.`
                      : "Live demo evidence is attached to each broker row."}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-md border bg-card p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Sites scanned</p>
                <p className="mt-1 font-medium text-foreground">{scanSummary.total}</p>
                <p className="text-sm text-muted-foreground">
                  {liveDemoSummary ? "Configured demo adapters" : "Tracked brokers in this dashboard view"}
                </p>
              </div>
              <div className="rounded-md border bg-card p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Listings found</p>
                <p className="mt-1 font-medium text-foreground">{scanSummary.found}</p>
                <p className="text-sm text-muted-foreground">Sites with exposed listing data</p>
              </div>
              <div className="rounded-md border bg-card p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {liveDemoSummary ? "End-to-End Submissions" : "Removals submitted"}
                </p>
                <p className="mt-1 font-medium text-foreground">
                  {liveDemoSummary ? fixtureBackedSubmittedCount : scanSummary.optedOut}
                </p>
                <p className="text-sm text-muted-foreground">
                  {liveDemoSummary
                    ? fixtureBackedSubmittedCount > 0
                      ? `${fixtureBackedSubmittedCount} fixture-backed success path`
                      : scanSummary.blocked > 0
                        ? `${scanSummary.blocked} blocked by site`
                        : completedSitesLabel || "No completed submission path recorded"
                    : scanSummary.blocked > 0
                      ? `${scanSummary.blocked} blocked by site`
                      : scanSummary.needsReview > 0
                        ? `${scanSummary.needsReview} need review`
                        : scanSummary.failed > 0
                          ? `${scanSummary.failed} failed`
                          : completedSitesLabel || "No blockers in the current view"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <ScanTable sites={brokerSites} onSelectSite={setSelectedSite} />
      <ChatBar
        messages={chatMessages}
        isSending={chatMutation.isPending}
        onSend={async (message) => {
          await chatMutation.mutateAsync(message);
        }}
      />

      <ListingDetailPanel
        site={selectedSite}
        open={!!selectedSite}
        onClose={() => setSelectedSite(null)}
        onResumeCaptcha={selectedSite?.demoMetadata?.captchaSession
          ? async (sessionId) => {
            await resumeCaptchaMutation.mutateAsync(sessionId);
            await liveDemoQuery.refetch();
          }
          : undefined}
        isResumingCaptcha={resumeCaptchaMutation.isPending}
      />
    </div>
  );
}

function attachLiveDemoEvidence(
  brokerSites: BrokerSite[],
  runs: DemoHarnessRun[],
  captchaSessions: DemoHarnessCaptchaSessionSnapshot[],
) {
  const runBySiteId = new Map(runs.map((run) => [run.siteId, run]));
  const captchaSessionBySiteId = new Map(captchaSessions.map((session) => [session.siteId, session]));

  return brokerSites.map((site) => {
    const run = runBySiteId.get(site.id as typeof runs[number]["siteId"]);
    if (!run) return site;
    const captchaSession = captchaSessionBySiteId.get(site.id as typeof captchaSessions[number]["siteId"]);

    const finalPageText = run.automationRecord.evidence.artifacts.find(
      (artifact) => artifact.kind === "page_text" && artifact.label === "Final page text capture",
    )?.content;
    const htmlSnapshot = run.automationRecord.evidence.artifacts.find(
      (artifact) => artifact.kind === "html_snapshot",
    )?.content;
    const screenshotArtifact = [...run.automationRecord.evidence.artifacts]
      .reverse()
      .find((artifact) => artifact.kind === "screenshot");
    const stepLog = run.automationRecord.evidence.artifacts.find(
      (artifact) => artifact.kind === "execution_log" && artifact.label.toLowerCase().includes("step log"),
    )?.content;
    const entryUrl = run.automationRecord.handoff.payload.steps.find((step) => step.action === "navigate")?.targetUrl;
    const isFixtureBacked = run.summary.usedFixtureBrowser;
    const manualFallbackReady = site.status === "blocked";
    const outcomeLabel = captchaSession
      ? "CAPTCHA waiting for you"
      : site.status === "blocked"
      ? "Manual submission needed"
      : site.status === "opted_out" && isFixtureBacked
        ? "Fixture-backed success"
        : undefined;
    const outcomeDetail = captchaSession
      ? `${captchaSession.instruction} ${captchaSession.browserHint}`
      : site.status === "blocked"
      ? "This site blocked automation. Review the captured evidence, then complete the opt-out request manually using the details below."
      : site.status === "opted_out" && isFixtureBacked
        ? "This completion path is deterministic for demo stability and does not rely on the live broker accepting automation."
        : undefined;
    const manualFallbackInputs = manualFallbackReady
      ? Object.entries(run.handoff.payload.fields)
        .filter(([key, value]) => key !== "candidate_url" && typeof value === "string" && value.trim().length > 0)
        .map(([key, value]) => ({
          key,
          label: key === "privacy_email"
            ? "Privacy email"
            : key === "listing_url"
              ? "Listing URL"
              : key === "full_name"
                ? "Full name"
                : key === "age"
                  ? "Age"
                  : key === "address"
                    ? "Address"
                    : key === "previous_city"
                      ? "Previous city"
                      : key === "phone"
                        ? "Phone"
                  : key === "city_state"
                    ? "City and state"
                    : key === "state"
                      ? "State"
                      : key.replace(/_/g, " "),
          value,
          description: key === "privacy_email"
            ? "Email address to use when completing the broker opt-out form."
            : undefined,
        }))
      : [];
    const recommendedNextStep = manualFallbackReady
      ? `Review the blocked evidence, open ${entryUrl ?? site.url} in a regular browser session, and complete the opt-out request with the listed details.`
      : undefined;
    const manualFallbackPacket = manualFallbackReady
      ? [
        `Broker: ${site.name}`,
        "Status: Blocked by site",
        "Fallback: Manual action required",
        entryUrl ? `Opt-out page: ${entryUrl}` : null,
        "",
        "Reason:",
        site.foundData?.failureReason ?? "Destination site blocked the automated browser session.",
        "",
        "Use these inputs:",
        ...manualFallbackInputs.map((input) => `- ${input.key}: ${input.value}`),
        "",
        "Recommended next step:",
        recommendedNextStep ?? "Open the broker opt-out page in a normal browser session and complete it manually.",
        "",
        "Evidence:",
        screenshotArtifact?.ref ? `- screenshot_ref: ${screenshotArtifact.ref}` : null,
        site.foundData?.optOutMessage ? `- latest_detail: ${site.foundData.optOutMessage}` : null,
      ].filter(Boolean).join("\n")
      : "";

    return {
      ...site,
      demoMetadata: {
        isFixtureBacked,
        manualFallbackReady,
        outcomeLabel,
        outcomeDetail,
        captchaSession: captchaSession
          ? {
            sessionId: captchaSession.sessionId,
            instruction: captchaSession.instruction,
            browserHint: captchaSession.browserHint,
            updatedAt: captchaSession.updatedAt,
          }
          : undefined,
      },
      foundData: {
        fields: site.foundData?.fields ?? Object.keys(run.handoff.payload.fields).filter((field) => field !== "candidate_url"),
        optOutMessage: captchaSession?.pageText
          ? `Live CAPTCHA checkpoint:\n${captchaSession.pageText}`
          : site.status === "opted_out" && isFixtureBacked && site.foundData?.optOutMessage
            ? `Fixture-backed demo outcome:\n${site.foundData.optOutMessage}`
            : site.foundData?.optOutMessage,
        failureReason: captchaSession
          ? "Automation is paused until you solve the CAPTCHA in the live browser window."
          : site.foundData?.failureReason,
        manualFallback: manualFallbackReady
          ? {
            packet: manualFallbackPacket,
            entryUrl,
            inputs: manualFallbackInputs,
            recommendedNextStep,
          }
          : undefined,
        evidence: {
          finalPageText: captchaSession?.pageText ?? finalPageText,
          htmlSnapshot,
          screenshotBase64: captchaSession?.screenshotBase64
            ?? (screenshotArtifact?.contentType === "image/png" ? screenshotArtifact.content : undefined),
          screenshotRef: screenshotArtifact?.ref ?? run.automationRecord.executionResult.screenshot_ref ?? undefined,
          stepLog,
        },
      },
    };
  });
}
