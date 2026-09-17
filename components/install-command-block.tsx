import { CopyButton } from "@/components/ui/cubby-ui/copy-button/copy-button";
import { cn } from "@/lib/utils";

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
 * repo directory page. The three had drifted into three copies of the same
 * markup; the corresponding skeletons reserve `INSTALL_COMMAND_BLOCK_HEIGHT`,
 * which only stays true if there is one block to measure.
 */
export function InstallCommandBlock({
  command,
  className,
}: {
  command: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group relative w-fit max-w-full rounded-xl bg-muted",
        className,
      )}
    >
      <pre className="overflow-x-auto px-4 py-3 pr-16 font-mono text-sm">
        {command}
      </pre>
      <div className="absolute top-1/2 right-1.5 -translate-y-1/2">
        <CopyButton content={command} className="backdrop-blur-sm" />
      </div>
    </div>
  );
}

/**
 * The block's resolved height: `text-sm` line-height (20px) plus `py-3`
 * (12px each). Skeletons that cannot know the command string reserve this
 * rather than guessing, so nothing below them moves when the block lands.
 */
export const INSTALL_COMMAND_BLOCK_HEIGHT = "h-11";
