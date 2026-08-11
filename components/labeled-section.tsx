import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function LabeledSection({
  label,
  className,
  id,
  as: Heading = "h2",
  children,
}: {
  label: string;
  className?: string;
  /** Anchor target, so another surface can link straight to this section. */
  id?: string;
  /**
   * Heading level. Defaults to `h2` (a page with an `h1` title). Pass `h3`
   * where the section sits inside a titled panel — a sheet, a dialog, or a
   * compare column — so the outline does not skip back up a level.
   */
  as?: "h2" | "h3" | "h4";
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
      {/* A real heading in the body face, not a mono uppercase eyebrow over a
          rule. The rule and the tracking were doing the work the heading's own
          weight and colour should do, and the section was a <section> with no
          accessible name, so the outline had nothing in it either. */}
      {/* `mb-4`, not a tighter gap: several of these introduce content that
          leads with its own heading (Documentation wraps a whole SKILL.md).
          At 12px the label bound itself to that title and read as a kicker
          over it, which is the shape this change existed to remove. */}
      <Heading className="mb-4 text-sm font-semibold text-foreground">
        {label}
      </Heading>
      {children}
    </section>
  );
}
