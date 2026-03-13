import type { BrokerSite } from "@/lib/mock-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { ShieldCheck, ExternalLink, Copy } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";

interface Props {
  site: BrokerSite | null;
  open: boolean;
  onClose: () => void;
  onResumeCaptcha?: (sessionId: string) => Promise<void>;
  isResumingCaptcha?: boolean;
}

function DetailContent(
  { site, onResumeCaptcha, isResumingCaptcha = false }:
  { site: BrokerSite; onResumeCaptcha?: (sessionId: string) => Promise<void>; isResumingCaptcha?: boolean },
) {
  const copyMessage = () => {
    if (site.foundData?.optOutMessage) {
      navigator.clipboard.writeText(site.foundData.optOutMessage);
      toast.success("Opt-out message copied to clipboard");
    }
  };

  const copyManualFallbackPacket = () => {
    if (!site.foundData?.manualFallback?.packet) {
      toast.error("No manual submission packet is available for this broker");
      return;
    }

    navigator.clipboard.writeText(site.foundData.manualFallback.packet);
    toast.success("Manual submission packet copied to clipboard");
  };

  const resumeCaptcha = async () => {
    const sessionId = site.demoMetadata?.captchaSession?.sessionId;
    if (!sessionId || !onResumeCaptcha) {
      toast.error("No active CAPTCHA session is available for this broker");
      return;
    }

    await onResumeCaptcha(sessionId);
  };

  return (
    <div className="space-y-6 p-1">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ExternalLink className="h-3.5 w-3.5" />
          {site.url}
        </div>
      </div>

      <div>
        <h4 className="mb-3 text-sm font-semibold text-foreground">Discovered Data Fields</h4>
        {site.foundData?.fields.length ? (
          <div className="flex flex-wrap gap-2">
            {site.foundData.fields.map((field) => (
              <Badge key={field} variant="secondary" className="text-xs">
                {field}
              </Badge>
            ))}
          </div>
        ) : (
          <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            No structured field capture was recorded for this site.
          </div>
        )}
      </div>

      {site.demoMetadata?.outcomeLabel || site.demoMetadata?.outcomeDetail ? (
        <div className="rounded-md border bg-muted/40 p-3">
          {site.demoMetadata?.outcomeLabel ? (
            <p className="text-sm font-semibold text-foreground">{site.demoMetadata.outcomeLabel}</p>
          ) : null}
          {site.demoMetadata?.outcomeDetail ? (
            <p className="mt-1 text-sm text-muted-foreground">{site.demoMetadata.outcomeDetail}</p>
          ) : null}
        </div>
      ) : null}

      {site.demoMetadata?.captchaSession ? (
        <div className="space-y-4 rounded-md border border-warning/20 bg-warning/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-foreground">CAPTCHA Checkpoint</h4>
              <p className="mt-1 text-sm text-muted-foreground">
                {site.demoMetadata.captchaSession.instruction}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {site.demoMetadata.captchaSession.browserHint}
              </p>
            </div>
            <Button
              size="sm"
              className="h-8"
              onClick={() => void resumeCaptcha()}
              disabled={isResumingCaptcha}
            >
              {isResumingCaptcha ? "Checking..." : "Resume After Solve"}
            </Button>
          </div>
        </div>
      ) : null}

      {site.status === "blocked" && site.foundData?.manualFallback ? (
        <div className="space-y-4 rounded-md border border-destructive/20 bg-destructive/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-foreground">Manual Submission Packet</h4>
              <p className="mt-1 text-sm text-muted-foreground">
                Automation could not complete this request. Use these details to finish the opt-out directly on the broker site.
              </p>
            </div>
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={copyManualFallbackPacket}>
              <Copy className="h-3 w-3" />
              Copy
            </Button>
          </div>
          {site.foundData.manualFallback.entryUrl ? (
            <div className="rounded-md border bg-background/70 p-3 text-sm text-muted-foreground">
              Opt-out page: <span className="font-mono text-foreground">{site.foundData.manualFallback.entryUrl}</span>
            </div>
          ) : null}
          {site.foundData.manualFallback.inputs.length > 0 ? (
            <div>
              <h5 className="mb-2 text-sm font-semibold text-foreground">Required Inputs</h5>
              <div className="space-y-2">
                {site.foundData.manualFallback.inputs.map((input) => (
                  <div key={input.key} className="rounded-md border bg-background/70 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-foreground">{input.label}</p>
                      <span className="font-mono text-xs text-muted-foreground">{input.key}</span>
                    </div>
                    <div className="mt-2 rounded border bg-muted/50 p-2 font-mono text-xs text-foreground break-all">
                      {input.value}
                    </div>
                    {input.description ? (
                      <p className="mt-2 text-xs text-muted-foreground">{input.description}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {site.foundData.manualFallback.recommendedNextStep ? (
            <div>
              <h5 className="mb-2 text-sm font-semibold text-foreground">Recommended Next Step</h5>
              <div className="rounded-md border bg-background/70 p-3 text-sm text-muted-foreground">
                {site.foundData.manualFallback.recommendedNextStep}
              </div>
            </div>
          ) : null}
          <div>
            <h5 className="mb-2 text-sm font-semibold text-foreground">Packet Preview</h5>
            <pre className="max-h-72 overflow-auto rounded-md border bg-background/70 p-3 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap font-mono">
              {site.foundData.manualFallback.packet}
            </pre>
          </div>
        </div>
      ) : null}

      {site.foundData?.failureReason && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-foreground">Failure Reason</h4>
          <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-muted-foreground">
            {site.foundData.failureReason}
          </div>
        </div>
      )}

      {site.foundData?.evidence?.finalPageText && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-foreground">Captured Final Page Text</h4>
          <div className="max-h-56 overflow-y-auto rounded-md border bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap font-mono">
            {site.foundData.evidence.finalPageText}
          </div>
        </div>
      )}

      {site.foundData?.evidence?.screenshotBase64 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-foreground">Captured Screenshot</h4>
          <img
            src={`data:image/png;base64,${site.foundData.evidence.screenshotBase64}`}
            alt={`${site.name} automation capture`}
            className="w-full rounded-md border object-contain"
          />
        </div>
      )}

      {site.foundData?.evidence?.screenshotRef || site.foundData?.evidence?.htmlSnapshot || site.foundData?.evidence?.stepLog ? (
        <div className="space-y-3 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          {site.foundData.evidence.screenshotRef ? (
            <p>
              Screenshot ref: <span className="font-mono text-foreground">{site.foundData.evidence.screenshotRef}</span>
            </p>
          ) : null}
          {site.foundData.evidence.stepLog ? (
            <details>
              <summary className="cursor-pointer font-medium text-foreground">Execution step log</summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                {site.foundData.evidence.stepLog}
              </pre>
            </details>
          ) : null}
          {site.foundData.evidence.htmlSnapshot ? (
            <details>
              <summary className="cursor-pointer font-medium text-foreground">Captured HTML snapshot</summary>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                {site.foundData.evidence.htmlSnapshot}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}

      {site.foundData?.optOutMessage && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground">
              {site.status === "found" ? "Drafted Opt-Out Message" : "Latest Execution Detail"}
            </h4>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={copyMessage}>
              <Copy className="h-3 w-3" />
              Copy
            </Button>
          </div>
          <div className="rounded-md border bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap font-mono">
            {site.foundData.optOutMessage}
          </div>
        </div>
      )}

      {site.status === "found" ? (
        <Button className="w-full gap-2" onClick={() => toast.success(`Removal request submitted for ${site.name}`)}>
          <ShieldCheck className="h-4 w-4" />
          Submit Removal
        </Button>
      ) : site.status === "needs_review" ? (
        <div className="rounded-md border border-warning/20 bg-warning/5 p-3 text-sm text-muted-foreground">
          {site.demoMetadata?.captchaSession
            ? `Automation is paused on a CAPTCHA for ${site.name}. Solve it in the live browser window, then resume here.`
            : `Automation paused for ${site.name}. Review the latest execution detail above and continue this broker manually.`}
        </div>
      ) : site.status === "blocked" ? (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-muted-foreground">
          {site.name} blocked the automated browser session. Use the submission details above to continue the opt-out directly on the broker site.
        </div>
      ) : (
        <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          This panel is showing the latest recorded demo result for {site.name}.
        </div>
      )}
    </div>
  );
}

export function ListingDetailPanel({ site, open, onClose, onResumeCaptcha, isResumingCaptcha }: Props) {
  const isMobile = useIsMobile();

  if (!site) return null;

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle>{site.name}</DrawerTitle>
            <DrawerDescription>Review demo evidence, blocked outcomes, and fallback instructions</DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-6">
            <DetailContent site={site} onResumeCaptcha={onResumeCaptcha} isResumingCaptcha={isResumingCaptcha} />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{site.name}</SheetTitle>
          <SheetDescription>Review demo evidence, blocked outcomes, and fallback instructions</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <DetailContent site={site} onResumeCaptcha={onResumeCaptcha} isResumingCaptcha={isResumingCaptcha} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
