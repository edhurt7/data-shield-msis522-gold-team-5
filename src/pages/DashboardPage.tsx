import { useState } from "react";
import { SummaryBar } from "@/components/SummaryBar";
import { ScanProgress } from "@/components/ScanProgress";
import { ScanTable } from "@/components/ScanTable";
import { ChatBar } from "@/components/ChatBar";
import { ListingDetailPanel } from "@/components/ListingDetailPanel";
import { mockBrokerSites, type BrokerSite } from "@/lib/mock-data";

export default function DashboardPage() {
  const [selectedSite, setSelectedSite] = useState<BrokerSite | null>(null);

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Scan Dashboard</h1>
        <p className="text-sm text-muted-foreground">Monitor and manage your data removal requests</p>
      </div>

      <ScanProgress />
      <SummaryBar />
      <ScanTable sites={mockBrokerSites} onSelectSite={setSelectedSite} />
      <ChatBar />

      <ListingDetailPanel
        site={selectedSite}
        open={!!selectedSite}
        onClose={() => setSelectedSite(null)}
      />
    </div>
  );
}
