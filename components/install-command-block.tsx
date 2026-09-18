import { CopyButton } from "@/components/ui/cubby-ui/copy-button/copy-button";
import { cn } from "@/lib/utils";

const SURFACE = "w-fit max-w-full rounded-xl bg-muted";
const LINE = "overflow-x-auto px-4 py-3 pr-16 font-mono text-sm";

/**
 * A copyable `npx skills add …` line. No label: a command beside a copy button
 * is already the most legible thing wherever it appears.
 *
 * `w-fit`, not full width — the command is a fixed string a reader copies, so
 * the block shrink-wraps to it; stretched across a column the fill became a
 * band of empty grey with a few words at the left end. `max-w-full` keeps a
 * long command scrollable instead of widening its container.
 *
 * Shared by the skill detail page, the bundle page's per-source list and the
 * two source directory pages, which had drifted into copies of the same markup.
 * `InstallCommandBlockSkeleton` below is the placeholder half, sharing the same
 * surface and line classes so the two cannot drift apart again.
 */
export function InstallCommandBlock({
  command,
  className,
}: {
  command: string;
  className?: string;
}) {
  return (
    <div className={cn("group relative", SURFACE, className)}>
      {/* `tabIndex` because the line scrolls horizontally when a command
          overflows. Without it a keyboard-only reader cannot focus the region
          to scroll it, and the tail of the command is unreachable (WCAG
          2.1.1). */}
      <pre
        tabIndex={0}
        className={cn(
          LINE,
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        )}
      >
        {command}
      </pre>
      <div className="absolute top-1/2 right-1.5 -translate-y-1/2">
        <CopyButton content={command} className="backdrop-blur-sm" />
      </div>
    </div>
  );
}

/**
 * The block's placeholder, for skeletons and Suspense fallbacks.
 *
 * Pass `command` where the caller knows the string (the skill pages do, from
 * the URL): an invisible copy reserves the exact width the resolved block will
 * take. Where it does not, the fixed width below reserves the right HEIGHT,
 * which is what stops the content under it moving.
 */
export function InstallCommandBlockSkeleton({
  command,
  className,
}: {
  command?: string;
  className?: string;
}) {
  return (
    <div className={cn(SURFACE, command === undefined && "w-72", className)}>
      {/* A non-breaking space when there is no command: an empty `pre` has no
          line box, so the placeholder would be 24px of padding instead of the
          44px the real block takes. */}
      <pre className={cn(LINE, "invisible")}>{command ?? " "}</pre>
    </div>
  );
}
