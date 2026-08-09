import { cn } from "@/lib/utils";

/**
 * The before/after of a skill's description, inline. One implementation,
 * because a reader who saw the change announced on the dashboard should meet
 * the identical object on the bundle page.
 *
 * That promise was previously stated in a comment over two copies of this
 * component, and the copies had already drifted — different measures, and one
 * of them missing the empty-input guard.
 *
 * No surrounding tray. A box here would be a box inside a panel, and the
 * codebase already made this call for rendered markdown: the diff is a
 * quotation of content, not a second surface.
 *
 * `−` and `+` are diff notation rather than icons standing in for one, set in
 * mono to say so, and they carry the meaning on their own — PRODUCT.md commits
 * to colour never being the sole indicator of state, and a two-line red/green
 * delta is the easiest place in the product to break that.
 */
export function DescriptionDelta({
  before,
  after,
  className,
}: {
  before?: string;
  after?: string;
  className?: string;
}) {
  if (!before && !after) return null;
  return (
    // Capped measure: descriptions are prose, and uncapped they run past 120ch
    // on a wide viewport and stop being readable.
    <div
      className={cn(
        "mt-1.5 max-w-[68ch] space-y-0.5 text-xs leading-relaxed",
        className,
      )}
    >
      {before ? (
        <p className="flex gap-2">
          <span aria-hidden className="font-mono text-danger-foreground">
            &minus;
          </span>
          <span className="sr-only">Was: </span>
          <span className="line-clamp-2 text-muted-foreground line-through decoration-muted-foreground/40">
            {before}
          </span>
        </p>
      ) : null}
      {after ? (
        <p className="flex gap-2">
          <span aria-hidden className="font-mono text-success-foreground">
            +
          </span>
          <span className="sr-only">Now: </span>
          <span className="line-clamp-2 text-foreground">{after}</span>
        </p>
      ) : null}
    </div>
  );
}
