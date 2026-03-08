import { Shield } from "lucide-react";
import { cn } from "@/lib/utils";

export function ShieldLogo({ className, size = "default" }: { className?: string; size?: "sm" | "default" | "lg" }) {
  const sizes = { sm: "h-6 w-6", default: "h-8 w-8", lg: "h-12 w-12" };
  const textSizes = { sm: "text-base", default: "text-xl", lg: "text-3xl" };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative">
        <Shield className={cn(sizes[size], "text-primary fill-primary/10")} />
      </div>
      <span className={cn("font-display font-bold tracking-tight text-foreground", textSizes[size])}>
        Privacy Shield
      </span>
    </div>
  );
}
