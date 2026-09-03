import type { ReactNode } from "react";

/**
 * The empty state a tab shows when the record it exists for has nothing in it
 * yet. Same material as the dashboard's empty state (`bg-muted/40`, one
 * rounded block), and the same three beats: what is true, why, and what
 * happens next.
 *
 * The block spans the whole pane, edge to edge under the tab strip, and only
 * the copy inside it is capped at a measure. A block capped at a reading width
 * on an otherwise empty page left the right half of the pane blank, and a
 * page whose only object stops two-thirds of the way across reads as a
 * layout that lost its second column.
 *
 * A single muted sentence was tried first and read as an error, not a state —
 * a page with a heading, a description, and one grey line underneath looks
 * like something failed to load. The block gives the absence a shape.
 */
export function SkillTabEmpty({
  title,
  children,
  action,
}: {
  title: string;
  /** One or two sentences: why it is empty and what fills it. */
  children: ReactNode;
  /** Optional: the one thing the reader can do about it. */
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-muted/40 px-6 py-10 sm:px-8 sm:py-12">
      <h3 className="text-base font-semibold tracking-tight text-foreground">
        {title}
      </h3>
      <div className="mt-2 max-w-md space-y-2 text-sm text-muted-foreground">
        {children}
      </div>
      {action && <div className="mt-6 w-fit">{action}</div>}
    </div>
  );
}
