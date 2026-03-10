import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";
import { US_STATES } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShieldLogo } from "@/components/ShieldLogo";
import { Shield, ArrowRight, Info } from "lucide-react";
import { motion } from "framer-motion";

export default function OnboardingPage() {
  const { completeOnboarding } = useAuth();
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [identifierType, setIdentifierType] = useState<"state" | "dob">("state");
  const [state, setState] = useState("");
  const [dob, setDob] = useState("");
  const [consent, setConsent] = useState(false);

  const isValid =
    firstName.trim() &&
    lastName.trim() &&
    consent &&
    (identifierType === "state" ? state : dob);

  const handleSubmit = () => {
    if (!isValid) return;
    completeOnboarding({
      firstName,
      lastName,
      identifierType,
      state: identifierType === "state" ? state : undefined,
      dob: identifierType === "dob" ? dob : undefined,
    });
    navigate("/dashboard");
  };

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

          <Tabs value={identifierType} onValueChange={(v) => setIdentifierType(v as "state" | "dob")}>
            <TabsList className="w-full">
              <TabsTrigger value="state" className="flex-1">Current State</TabsTrigger>
              <TabsTrigger value="dob" className="flex-1">Date of Birth</TabsTrigger>
            </TabsList>
            <TabsContent value="state" className="mt-3">
              <Select value={state} onValueChange={setState}>
                <SelectTrigger>
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
              <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
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

        <Button className="w-full gap-2 text-base" size="lg" disabled={!isValid} onClick={handleSubmit}>
          <Shield className="h-4 w-4" />
          Start My First Scan
          <ArrowRight className="h-4 w-4" />
        </Button>
      </motion.div>
    </div>
  );
}
