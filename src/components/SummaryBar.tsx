import { mockBrokerSites, getScanSummary } from "@/lib/mock-data";
import { Search, Eye, ShieldCheck, Loader2 } from "lucide-react";

export function SummaryBar() {
  const summary = getScanSummary(mockBrokerSites);

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
