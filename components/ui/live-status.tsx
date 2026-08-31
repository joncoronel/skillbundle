import { cn } from "@/lib/utils";

/**
 * A persistent screen-reader status line.
 *
 * **Reach for `aria-busy` first; most loading states do not need this.** A
 * spinner swapping into a field, or a page appending to a list, is covered by
 * one attribute on the control or the container. This is for an OUTCOME nothing
 * on screen announces. Better still, pair `aria-busy` with a VISIBLE status
 * line as `repo-url-input.tsx` does, so sighted users get the same information.
 *
 * **Mount it unconditionally and vary its children.** A region that mounts
 * already holding its text has not *changed*, so it never announces. Writing
 * `{loading && <LiveStatus>…}` puts the region inside the condition it is
 * meant to report on.
 *
 * Two placement rules:
 *
 * - **Never inside an element named by its contents** (a button, a link).
 *   `sr-only` clips rather than hides, so the text joins name-from-content and
 *   the control renames itself mid-request: "Save" becomes "Save Loading".
 * - **Keep it to a short sentence.** `role="status"` implies `aria-atomic`, so
 *   a region wrapped around a result list reads every row when data lands.
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
