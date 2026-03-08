import type { BrokerSite } from "@/lib/mock-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { ShieldCheck, ExternalLink, Copy } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";

interface Props {
  site: BrokerSite | null;
  open: boolean;
  onClose: () => void;
}

function DetailContent({ site }: { site: BrokerSite }) {
  const copyMessage = () => {
    if (site.foundData?.optOutMessage) {
      navigator.clipboard.writeText(site.foundData.optOutMessage);
      toast.success("Opt-out message copied to clipboard");
    }
  };

  return (
    <div className="space-y-6 p-1">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ExternalLink className="h-3.5 w-3.5" />
          {site.url}
        </div>
      </div>

      <div>
        <h4 className="mb-3 text-sm font-semibold text-foreground">Discovered Data Fields</h4>
        <div className="flex flex-wrap gap-2">
          {site.foundData?.fields.map((field) => (
            <Badge key={field} variant="secondary" className="text-xs">
              {field}
            </Badge>
          ))}
        </div>
      </div>

      {site.foundData?.optOutMessage && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground">Drafted Opt-Out Message</h4>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={copyMessage}>
              <Copy className="h-3 w-3" />
              Copy
            </Button>
          </div>
          <div className="rounded-md border bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap font-mono">
            {site.foundData.optOutMessage}
          </div>
        </div>
      )}

      <Button className="w-full gap-2" onClick={() => toast.success(`Removal request submitted for ${site.name}`)}>
        <ShieldCheck className="h-4 w-4" />
        Submit Removal
      </Button>
    </div>
  );
}

export function ListingDetailPanel({ site, open, onClose }: Props) {
  const isMobile = useIsMobile();

  if (!site) return null;

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle>{site.name}</DrawerTitle>
            <DrawerDescription>Review discovered data and submit a removal request</DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-6">
            <DetailContent site={site} />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{site.name}</SheetTitle>
          <SheetDescription>Review discovered data and submit a removal request</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <DetailContent site={site} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
