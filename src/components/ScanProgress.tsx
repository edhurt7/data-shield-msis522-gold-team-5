import { Progress } from "@/components/ui/progress";
import { mockBrokerSites, getScanSummary } from "@/lib/mock-data";
import { motion } from "framer-motion";
import { Shield } from "lucide-react";

export function ScanProgress() {
  const summary = getScanSummary(mockBrokerSites);
  const completed = summary.total - summary.scanning;
  const pct = Math.round((completed / summary.total) * 100);

  if (summary.scanning === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 rounded-lg border border-info/20 bg-info/5 p-4"
    >
      <Shield className="h-5 w-5 text-info animate-pulse-slow" />
      <div className="flex-1 space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">Scan in progress…</span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>
        <Progress value={pct} className="h-2" />
      </div>
    </motion.div>
  );
}
