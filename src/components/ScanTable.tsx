import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScanStatusBadge } from "@/components/StatusBadge";
import type { BrokerSite } from "@/lib/mock-data";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScanTableProps {
  sites: BrokerSite[];
  onSelectSite: (site: BrokerSite) => void;
}

export function ScanTable({ sites, onSelectSite }: ScanTableProps) {
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Site</TableHead>
            <TableHead className="hidden sm:table-cell">URL</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sites.map((site) => (
            <TableRow
              key={site.id}
              className={cn(
                "transition-colors",
                site.foundData && "cursor-pointer hover:bg-accent/50"
              )}
              onClick={() => site.foundData && onSelectSite(site)}
              role={site.foundData ? "button" : undefined}
              tabIndex={site.foundData ? 0 : undefined}
              aria-label={site.foundData ? `View details for ${site.name}` : undefined}
              onKeyDown={(e) => {
                if (site.foundData && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onSelectSite(site);
                }
              }}
            >
              <TableCell className="font-medium">{site.name}</TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                <span className="flex items-center gap-1">
                  {site.url}
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </span>
                {site.demoMetadata?.outcomeLabel ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {site.demoMetadata.outcomeLabel}
                  </div>
                ) : null}
              </TableCell>
              <TableCell>
                <div className="space-y-1">
                  <ScanStatusBadge status={site.status} />
                  {site.demoMetadata?.outcomeLabel ? (
                    <div className="text-xs text-muted-foreground sm:hidden">
                      {site.demoMetadata.outcomeLabel}
                    </div>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
