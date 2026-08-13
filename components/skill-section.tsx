import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A top-level section of the skill page.
 *
 * Deliberately NOT `LabeledSection`. That component is tuned for a label beside
 * or above ordinary body copy — a compare column, a sheet, a filter group — and
 * at 14px/600 it works there. It fails on this page for a structural reason:
 * one of the sections contains a whole SKILL.md, whose own `##` renders at 24px
 * bold. A 14px label cannot introduce a 24px heading; the reader reads it as a
 * caption on the document rather than as the page speaking, which is exactly
 * the "it all blends together" complaint.
 *
 * So a page section here declares itself with three things at once, none of
 * which the document's own headings have:
 *
 *   1. A rule across the full column, with much more space above than below.
 *   2. A heading a step larger than the label role (16px/600).
 *   3. An optional right-aligned `meta` slot on the same baseline — a count, a
 *      date, an action — which reads as a panel header rather than as prose.
 *
 * The heavier lifting is done by the Documentation section's container (see
 * skill-document.tsx): once the file sits inside its own framed sheet, the page
 * heading above it no longer has to out-shout it.
 */
export function SkillSection({
  id,
  title,
  meta,
  description,
  className,
  children,
}: {
  /** Anchor target for the section nav. Always set on this page. */
  id: string;
  title: string;
  /** Right-aligned trailing content on the heading baseline. */
  meta?: ReactNode;
  /** One line under the heading, before the content. */
  description?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      // `tabIndex={-1}` so the nav's programmatic focus lands here and a screen
      // reader continues from the section it jumped to rather than from the
      // link it left. `scroll-mt-24` clears the floating header pill, whose
      // bottom edge sits at 72px.
      tabIndex={-1}
      className={cn("scroll-mt-24 outline-none", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border pt-4">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {meta && (
          <div className="text-xs text-muted-foreground">{meta}</div>
        )}
      </div>

      {description && (
        <p className="mt-2 max-w-[68ch] text-sm text-pretty text-muted-foreground">
          {description}
        </p>
      )}

      <div className="mt-6">{children}</div>
    </section>
  );
}
