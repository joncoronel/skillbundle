import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function LabeledSection({
  label,
  className,
  id,
  children,
}: {
  label: string;
  className?: string;
  /** Anchor target, so another surface can link straight to this section. */
  id?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={cn(className)}>
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
