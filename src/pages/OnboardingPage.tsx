import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth-context";
import { US_STATES } from "@/lib/mock-data";
import { useStartAgentRun } from "@/hooks/use-agent-dashboard";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShieldLogo } from "@/components/ShieldLogo";
import { cn } from "@/lib/utils";
import { Shield, ArrowRight, CalendarIcon, Info } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

export default function OnboardingPage() {
  const { completeOnboarding, attachRun } = useAuth();
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();
  const startRunMutation = useStartAgentRun();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [city, setCity] = useState("");
  const [identifierType, setIdentifierType] = useState<"state" | "dob">("state");
  const [state, setState] = useState("");
  const [dob, setDob] = useState("");
  const [dobPickerOpen, setDobPickerOpen] = useState(false);
  const [consent, setConsent] = useState(false);

  const isValid =
    firstName.trim() &&
    lastName.trim() &&
    city.trim() &&
    consent &&
    state;

  const handleSubmit = async () => {
    if (!isValid) return;

    completeOnboarding({
      firstName,
      lastName,
      city,
      identifierType,
      state,
      dob: dob || undefined,
    });

    try {
      const response = await startRunMutation.mutateAsync({
        seed_profile: {
          full_name: `${firstName.trim()} ${lastName.trim()}`,
          name_variants: [`${firstName.trim().charAt(0)}. ${lastName.trim()}`],
          location: {
            city: city.trim(),
            state: identifierType === "state" ? state : "Washington",
          },
          approx_age: null,
          privacy_email: `shield-${Math.random().toString(36).slice(2, 8)}@detraceme.io`,
          optional: {
            phone_last4: null,
            prior_cities: [],
          },
          consent: true,
        },
        request_text: `Search for ${firstName.trim()} ${lastName.trim()} and start my first privacy scan.`,
        requested_sites: ["fastpeoplesearch", "spokeo", "radaris"],
      });

      attachRun(response.run.runId, response.run.profile.proxyEmail);
      toast.success("Your first scan has been created.");
      navigate("/dashboard");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create your first scan.";
      toast.error(message);
    }
  };

  const selectedDob = dob ? new Date(`${dob}T00:00:00`) : undefined;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md space-y-6"
      >
        <div className="text-center">
          <ShieldLogo className="justify-center" />
          <h1 className="mt-4 font-display text-2xl font-bold text-foreground">
            Let's set up your shield
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Just a few details so we can find and remove your data
          </p>
        </div>

        <div className="space-y-4 rounded-lg border bg-card p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="John" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Doe" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="city">Current City</Label>
            <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Seattle" />
          </div>

          <Tabs value={identifierType} onValueChange={(v) => setIdentifierType(v as "state" | "dob")}>
            <TabsList className="w-full">
              <TabsTrigger value="state" className="flex-1">Current State</TabsTrigger>
              <TabsTrigger value="dob" className="flex-1">Date of Birth</TabsTrigger>
            </TabsList>
            <TabsContent value="state" className="mt-3">
              <Select value={state} onValueChange={setState}>
                <SelectTrigger id="state">
                  <SelectValue placeholder="Select your state" />
                </SelectTrigger>
                <SelectContent>
                  {US_STATES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </TabsContent>
            <TabsContent value="dob" className="mt-3">
              <Popover open={dobPickerOpen} onOpenChange={setDobPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="dob"
                    type="button"
                    variant="outline"
                    className={cn(
                      "w-full justify-between font-normal",
                      !selectedDob && "text-muted-foreground",
                    )}
                  >
                    {selectedDob ? format(selectedDob, "MMMM d, yyyy") : "Pick your birth date"}
                    <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={selectedDob}
                    onSelect={(date) => {
                      setDob(date ? format(date, "yyyy-MM-dd") : "");
                      if (date) setDobPickerOpen(false);
                    }}
                    defaultMonth={selectedDob}
                    captionLayout="dropdown"
                    fromYear={1900}
                    toYear={currentYear}
                    disabled={{ after: new Date() }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </TabsContent>
          </Tabs>

          <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-xs text-muted-foreground">
              We use this to search for your listings on data broker sites — nothing else. Your info is never shared.
            </p>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox id="consent" checked={consent} onCheckedChange={(c) => setConsent(c === true)} className="mt-0.5" />
            <Label htmlFor="consent" className="text-sm font-normal leading-snug text-muted-foreground">
              I consent to DetraceMe scanning data broker sites on my behalf to find and remove my personal information.
            </Label>
          </div>
        </div>

        <Button className="w-full gap-2 text-base" size="lg" disabled={!isValid || startRunMutation.isPending} onClick={() => void handleSubmit()}>
          <Shield className="h-4 w-4" />
          {startRunMutation.isPending ? "Starting Scan..." : "Start My First Scan"}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </motion.div>
    </div>
  );
}
