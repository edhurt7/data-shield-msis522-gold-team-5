import { useMemo, useState } from "react";

import { HistoryStatusBadge, ScanStatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAgentDashboard, useLiveDemoStatus } from "@/hooks/use-agent-dashboard";
import { mockHistory, type HistoryEntry } from "@/lib/mock-data";
import { ChevronRight, Search } from "lucide-react";

export default function HistoryPage() {
  const dashboardQuery = useAgentDashboard();
  const liveDemoQuery = useLiveDemoStatus();
  const history = liveDemoQuery.data?.dashboard.history ?? dashboardQuery.data?.history ?? mockHistory;
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);

  const selectedScan = useMemo(
    () => history.find((entry) => entry.id === selectedScanId) ?? null,
    [history, selectedScanId],
  );

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Activity Log</h1>
        <p className="text-sm text-muted-foreground">Session-based history of completed and in-progress scans</p>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Scan</TableHead>
              <TableHead className="hidden md:table-cell">Summary</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[72px] text-right">Open</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((entry) => (
              <TableRow
                key={entry.id}
                className="cursor-pointer"
                onClick={() => setSelectedScanId(entry.id)}
              >
                <TableCell className="text-muted-foreground">{entry.date}</TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">{entry.scan}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.totalSites} sites scanned, {entry.submittedSites} submitted, {entry.blockedSites} blocked
                    </p>
                  </div>
                </TableCell>
                <TableCell className="hidden max-w-[420px] text-muted-foreground md:table-cell">
                  {entry.action}
                </TableCell>
                <TableCell>
                  <HistoryStatusBadge status={entry.status} />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedScanId(entry.id);
                    }}
                  >
                    <ChevronRight className="h-4 w-4" />
                    <span className="sr-only">Open scan details</span>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Sheet open={!!selectedScan} onOpenChange={(open) => !open && setSelectedScanId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          {selectedScan ? <ScanDetails scan={selectedScan} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ScanDetails({ scan }: { scan: HistoryEntry }) {
  return (
    <div className="space-y-6">
      <SheetHeader>
        <SheetTitle>{scan.scan}</SheetTitle>
        <SheetDescription>
          {scan.date} · Run ID {scan.runId}
        </SheetDescription>
      </SheetHeader>

      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryCard label="Sites" value={scan.totalSites.toString()} />
        <SummaryCard label="Found" value={scan.foundSites.toString()} />
        <SummaryCard label="Submitted" value={scan.submittedSites.toString()} />
        <SummaryCard label="Blocked" value={scan.blockedSites.toString()} />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">Scan status</p>
            <p className="text-sm text-muted-foreground">{scan.action}</p>
          </div>
          <HistoryStatusBadge status={scan.status} />
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" />
            <h2 className="font-medium text-foreground">Sites in this scan</h2>
          </div>
        </div>
        <div className="divide-y">
          {scan.sites.map((site) => (
            <div key={site.id} className="space-y-3 px-4 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium text-foreground">{site.name}</p>
                  <p className="text-sm text-muted-foreground">{site.url}</p>
                </div>
                <ScanStatusBadge status={site.status} />
              </div>
              <p className="text-sm text-muted-foreground">{site.action}</p>
              {site.fields && site.fields.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Data points: {site.fields.join(", ")}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}
