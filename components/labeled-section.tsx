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
    <section
      id={id}
      // Only when this section is actually an anchor target.
      //
      // `scroll-mt-20` clears the sticky app header (h-14 at top-0), which
      // otherwise covers the section label the link just jumped to.
      // `tabIndex={-1}` makes the target focusable so the browser moves focus
      // with the jump — without it a keyboard user's tab position stays where
      // it was and a screen reader keeps reading from the link they left.
      {...(id ? { tabIndex: -1 } : {})}
      className={cn(id && "scroll-mt-20 outline-none", className)}
    >
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
