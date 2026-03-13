import { Search, Eye, ShieldCheck, Loader2, Clock3, AlertTriangle, Ban } from "lucide-react";

import { getScanSummary, type BrokerSite } from "@/lib/mock-data";

interface SummaryBarProps {
  sites: BrokerSite[];
}

export function SummaryBar({ sites }: SummaryBarProps) {
  const summary = getScanSummary(sites);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4 text-sm" role="status" aria-label="Scan summary">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Search className="h-4 w-4" aria-hidden="true" />
        <span className="font-medium text-foreground">{summary.total}</span> sites scanned
      </div>
      <span className="text-border" aria-hidden="true">·</span>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Eye className="h-4 w-4 text-warning" aria-hidden="true" />
        <span className="font-medium text-foreground">{summary.found}</span> listings found
      </div>
      <span className="text-border" aria-hidden="true">·</span>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" />
        <span className="font-medium text-foreground">{summary.optedOut}</span> removals submitted
      </div>
      {summary.needsReview > 0 && (
        <>
          <span className="text-border" aria-hidden="true">·</span>
          <div className="flex items-center gap-1.5 text-warning">
            <Clock3 className="h-4 w-4" aria-hidden="true" />
            <span className="font-medium">{summary.needsReview}</span> need review
          </div>
        </>
      )}
      {summary.blocked > 0 && (
        <>
          <span className="text-border" aria-hidden="true">·</span>
          <div className="flex items-center gap-1.5 text-destructive">
            <Ban className="h-4 w-4" aria-hidden="true" />
            <span className="font-medium">{summary.blocked}</span> blocked, manual action needed
          </div>
        </>
      )}
      {summary.failed > 0 && (
        <>
          <span className="text-border" aria-hidden="true">·</span>
          <div className="flex items-center gap-1.5 text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <span className="font-medium">{summary.failed}</span> failed
          </div>
        </>
      )}
      {summary.scanning > 0 && (
        <>
          <span className="text-border" aria-hidden="true">·</span>
          <div className="flex items-center gap-1.5 text-info">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span className="font-medium">{summary.scanning}</span> scanning
          </div>
        </>
      )}
    </div>
  );
}
