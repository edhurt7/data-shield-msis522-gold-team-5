import { ShieldLogo } from "@/components/ShieldLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { Shield, Lock, CheckCircle2, Eye, Bot, Zap } from "lucide-react";
import { motion } from "framer-motion";

const features = [
  { icon: Eye, title: "Auto-Detect", desc: "We scan 100+ data broker sites for your personal info" },
  { icon: Bot, title: "AI-Powered Removal", desc: "Our agent drafts and sends opt-out requests for you" },
  { icon: Zap, title: "Ongoing Protection", desc: "Continuous monitoring keeps your data off the web" },
];

export default function LoginPage() {
  const { login } = useAuth();

  return (
    <div className="relative flex min-h-screen flex-col bg-gradient-to-b from-background via-primary/5 to-background">
      {/* Theme toggle */}
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>

      {/* Hero gradient background - Enhanced */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden="true"
      >
        <div className="absolute -top-32 left-1/4 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-gradient-to-br from-primary/25 to-primary/5 blur-3xl" />
        <div className="absolute -bottom-24 right-1/4 h-[500px] w-[700px] rounded-full bg-gradient-to-tl from-accent/20 to-primary/10 blur-3xl" />
        <div className="absolute top-1/3 -right-32 h-[400px] w-[500px] rounded-full bg-gradient-to-l from-primary/15 to-transparent blur-3xl" />
      </div>

      <main className="relative z-[1] flex flex-1 flex-col items-center justify-center px-4 py-12">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full max-w-md space-y-8 text-center"
        >
          {/* Logo & headline */}
          <div className="flex flex-col items-center gap-5">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.15, duration: 0.5 }}
              className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 shadow-lg shadow-primary/10"
            >
              <Shield className="h-10 w-10 text-primary" aria-hidden="true" />
            </motion.div>

            <div>
              <h1 className="font-display text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
                Privacy Shield
              </h1>
              <p className="mx-auto mt-3 max-w-xs text-base text-muted-foreground">
                Your personal data removal agent. Take back control of your online privacy.
              </p>
            </div>
          </div>

          {/* Feature pills */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="space-y-3"
            role="list"
            aria-label="Key features"
          >
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.1, duration: 0.4 }}
                className="flex items-center gap-3 rounded-lg border bg-card/80 px-4 py-3 text-left backdrop-blur-sm"
                role="listitem"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <f.icon className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{f.title}</p>
                  <p className="text-xs text-muted-foreground">{f.desc}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.4 }}
            className="space-y-3"
          >
            <Button
              size="lg"
              className="w-full gap-2.5 text-base shadow-lg shadow-primary/20"
              onClick={login}
              aria-label="Sign in with Google"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </Button>

            <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" aria-hidden="true" />
              <span>Your data is encrypted and never shared</span>
            </div>
          </motion.div>
        </motion.div>

        {/* Trust badges */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9, duration: 0.5 }}
          className="mt-12 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground"
          role="list"
          aria-label="Trust indicators"
        >
          {["256-bit encryption", "No data resale", "CCPA compliant", "SOC 2 ready"].map((badge) => (
            <span key={badge} className="flex items-center gap-1" role="listitem">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
              {badge}
            </span>
          ))}
        </motion.div>
      </main>
    </div>
  );
}
