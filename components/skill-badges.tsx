import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUp02Icon,
  CheckmarkBadge02Icon,
} from "@hugeicons/core-free-icons";
import { cn, formatInstalls } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Individual badges
// ---------------------------------------------------------------------------

/**
 * "Official" verified mark for skills curated by skills.sh as first-party.
 * Just the checkmark-badge icon — no pill, no label. Tooltip identifies the
 * curated owner.
 */
export function OfficialBadge({
  owner,
  className,
}: {
  owner: string;
  className?: string;
}) {
  return (
    <span
      title={`Official skill from ${owner}`}
      aria-label={`Official skill from ${owner}`}
      className={cn(
        "inline-flex shrink-0 items-center text-info-foreground",
        className,
      )}
    >
      <HugeiconsIcon
        icon={CheckmarkBadge02Icon}
        strokeWidth={2}
        className="size-4"
      />
    </span>
  );
}

/**
 * Momentum chip showing how much an install count moved hour-over-hour.
 * Only renders for positive deltas (we don't surface decay; it'd just be
 * negativity bait without the context of a long timeline).
 */
export function HotMomentumChip({
  change,
  className,
}: {
  change: number;
  className?: string;
}) {
  if (change <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
        "bg-success/10 text-success-foreground border border-success/20",
        className,
      )}
      title={`+${change.toLocaleString()} installs vs same hour yesterday`}
    >
      <HugeiconsIcon
        icon={ArrowUp02Icon}
        strokeWidth={2}
        className="size-2.5"
        aria-hidden="true"
      />
      +{formatInstalls(change)}
    </span>
  );
}
