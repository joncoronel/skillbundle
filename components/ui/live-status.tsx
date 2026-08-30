import { cn } from "@/lib/utils";

/**
 * A persistent screen-reader status line.
 *
 * **Mount it unconditionally and vary its children.** A live region that
 * mounts already holding its text has not *changed*, so it never announces —
 * which is the whole reason this is a separate always-present node rather than
 * a label on the spinner or a wrapper around the thing that is loading. If you
 * find yourself writing `{loading && <LiveStatus>…}`, the region is inside the
 * condition it is supposed to be reporting on; hoist it.
 *
 * Two placement rules, both learned the hard way in this codebase:
 *
 * - **Never inside an element whose accessible name comes from its contents**
 *   (a button, a link). `sr-only` clips rather than hides, so the text joins
 *   name-from-content and the control renames itself mid-request — "Save"
 *   becomes "Save Loading". `components/ui/cubby-ui/button.tsx` documents the
 *   same trap at its own loading slot.
 * - **Keep the contents to a short sentence.** `role="status"` implies
 *   `aria-atomic`, so a region wrapped around a result list gets read out in
 *   full — all 30 to 60 rows — the moment the data lands.
 *
 * `aria-live="polite"` is implied by `role="status"` and is spelled out anyway:
 * it costs nothing and assistive-tech behaviour varies more than the spec does.
 */
export function LiveStatus({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span role="status" aria-live="polite" className={cn("sr-only", className)}>
      {children}
    </span>
  );
}
