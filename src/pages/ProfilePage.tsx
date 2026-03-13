import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Copy, Info, RefreshCw, Shield, Mail } from "lucide-react";
import { toast } from "sonner";

export default function ProfilePage() {
  const { user } = useAuth();

  const proxyEmail = user?.proxyEmail || "shield-a7x29k@detraceme.io";

  const copyEmail = () => {
    navigator.clipboard.writeText(proxyEmail);
    toast.success("Proxy email copied to clipboard");
  };

  return (
    <div className="flex h-full flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Profile & Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account and privacy settings</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Privacy Email</CardTitle>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-sm">
                This proxy email is used in all opt-out requests sent on your behalf. Your real email is never exposed to data broker sites.
              </TooltipContent>
            </Tooltip>
          </div>
          <CardDescription>
            All removal requests are sent from this address — your real email is never shared.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md border bg-muted/50 px-3 py-2 text-sm font-mono text-foreground">
              {proxyEmail}
            </code>
            <Button variant="outline" size="icon" onClick={copyEmail}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Personal Information</CardTitle>
          </div>
          <CardDescription>The info used to search for your data broker listings</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground">First Name</p>
              <p className="mt-1 text-sm text-foreground">{user?.firstName || "John"}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Last Name</p>
              <p className="mt-1 text-sm text-foreground">{user?.lastName || "Doe"}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {user?.identifierType === "dob" ? "Date of Birth" : "State"}
              </p>
              <p className="mt-1 text-sm text-foreground">
                {user?.identifierType === "dob" ? user.dob : user?.state || "California"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => toast.success("Manual re-scan started! Check the dashboard for progress.")}
          >
            <RefreshCw className="h-4 w-4" />
            Trigger Manual Re-scan
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
