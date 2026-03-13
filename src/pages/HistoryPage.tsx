import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HistoryStatusBadge } from "@/components/StatusBadge";
import { useAgentDashboard } from "@/hooks/use-agent-dashboard";
import { mockHistory } from "@/lib/mock-data";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function HistoryPage() {
  const dashboardQuery = useAgentDashboard();
  const history = dashboardQuery.data?.history ?? mockHistory;

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Activity Log</h1>
        <p className="text-sm text-muted-foreground">History of all scans and removal actions</p>
      </div>

      {dashboardQuery.isError && (
        <Alert variant="destructive">
          <AlertTitle>History unavailable</AlertTitle>
          <AlertDescription>
            {dashboardQuery.error instanceof Error ? dashboardQuery.error.message : "Unable to load activity history."}
          </AlertDescription>
        </Alert>
      )}

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Site</TableHead>
              <TableHead className="hidden sm:table-cell">Action</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="text-muted-foreground">{entry.date}</TableCell>
                <TableCell className="font-medium">{entry.sites[0]?.name ?? entry.scan}</TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">{entry.action}</TableCell>
                <TableCell>
                  <HistoryStatusBadge status={entry.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
