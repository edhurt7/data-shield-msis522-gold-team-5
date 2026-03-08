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
                site.status === "found" && "cursor-pointer hover:bg-accent/50"
              )}
              onClick={() => site.status === "found" && onSelectSite(site)}
            >
              <TableCell className="font-medium">{site.name}</TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                <span className="flex items-center gap-1">
                  {site.url}
                  <ExternalLink className="h-3 w-3" />
                </span>
              </TableCell>
              <TableCell>
                <ScanStatusBadge status={site.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
