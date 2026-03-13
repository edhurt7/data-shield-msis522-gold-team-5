import { useState } from "react";

import { ChatBar } from "@/components/ChatBar";
import { ListingDetailPanel } from "@/components/ListingDetailPanel";
import { ScanProgress } from "@/components/ScanProgress";
import { ScanTable } from "@/components/ScanTable";
import { SummaryBar } from "@/components/SummaryBar";
import { useAgentChat, useAgentDashboard } from "@/hooks/use-agent-dashboard";
import { mockBrokerSites, mockChatMessages, type BrokerSite } from "@/lib/mock-data";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export default function DashboardPage() {
  const [selectedSite, setSelectedSite] = useState<BrokerSite | null>(null);
  const { user } = useAuth();
  const navigate = useNavigate();
  const dashboardQuery = useAgentDashboard();
  const chatMutation = useAgentChat();

  const brokerSites = dashboardQuery.data?.brokerSites ?? mockBrokerSites;
  const chatMessages = dashboardQuery.data?.chatMessages ?? mockChatMessages;

  if (!user?.runId) {
    return (
      <div className="flex h-full flex-col gap-4 p-4 md:p-6">
        <Alert>
          <AlertTitle>No active scan yet</AlertTitle>
          <AlertDescription>
            Create your first run from onboarding before using the dashboard.
          </AlertDescription>
        </Alert>
        <div>
          <Button onClick={() => navigate("/onboarding")}>Go to Onboarding</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Scan Dashboard</h1>
        <p className="text-sm text-muted-foreground">Monitor and manage your data removal requests</p>
      </div>

      {dashboardQuery.isError && (
        <Alert variant="destructive">
          <AlertTitle>Backend connection issue</AlertTitle>
          <AlertDescription>
            {dashboardQuery.error instanceof Error ? dashboardQuery.error.message : "Unable to load the active scan."}
          </AlertDescription>
        </Alert>
      )}

      <ScanProgress sites={brokerSites} />
      <SummaryBar sites={brokerSites} />
      <ScanTable sites={brokerSites} onSelectSite={setSelectedSite} />
      <ChatBar
        messages={chatMessages}
        isSending={chatMutation.isPending}
        onSend={async (message) => {
          await chatMutation.mutateAsync(message);
        }}
      />

      <ListingDetailPanel site={selectedSite} open={!!selectedSite} onClose={() => setSelectedSite(null)} />
    </div>
  );
}
