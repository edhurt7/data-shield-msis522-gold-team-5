import { Badge } from "@/components/ui/badge";
import type { ScanStatus, HistoryStatus } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { Loader2, Check, X, AlertTriangle, Search, Eye } from "lucide-react";

const scanConfig: Record<ScanStatus, { label: string; className: string; icon: React.ReactNode }> = {
  scanning: {
    label: "Scanning",
    className: "bg-info/15 text-info border-info/20",
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
  },
  found: {
    label: "Found",
    className: "bg-warning/15 text-warning border-warning/20",
    icon: <Eye className="h-3 w-3" />,
  },
  not_found: {
    label: "Not Found",
    className: "bg-success/15 text-success border-success/20",
    icon: <Check className="h-3 w-3" />,
  },
  opted_out: {
    label: "Opted Out",
    className: "bg-success/15 text-success border-success/20",
    icon: <Check className="h-3 w-3" />,
  },
  failed: {
    label: "Failed",
    className: "bg-destructive/15 text-destructive border-destructive/20",
    icon: <AlertTriangle className="h-3 w-3" />,
  },
};

const historyConfig: Record<HistoryStatus, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-warning/15 text-warning border-warning/20" },
  confirmed: { label: "Confirmed", className: "bg-success/15 text-success border-success/20" },
  re_listed: { label: "Re-listed", className: "bg-destructive/15 text-destructive border-destructive/20" },
};

export function ScanStatusBadge({ status }: { status: ScanStatus }) {
  const cfg = scanConfig[status];
  return (
    <Badge variant="outline" className={cn("gap-1 font-medium", cfg.className)}>
      {cfg.icon}
      {cfg.label}
    </Badge>
  );
}

export function HistoryStatusBadge({ status }: { status: HistoryStatus }) {
  const cfg = historyConfig[status];
  return (
    <Badge variant="outline" className={cn("font-medium", cfg.className)}>
      {cfg.label}
    </Badge>
  );
}
