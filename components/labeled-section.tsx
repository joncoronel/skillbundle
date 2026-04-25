import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function LabeledSection({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn(className)}>
      <div className="mb-4 flex items-center gap-3">
        <span className="shrink-0 font-mono text-eyebrow font-medium uppercase tracking-eyebrow text-muted-foreground">
          {label}
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>
      {children}
    </section>
  );
}
