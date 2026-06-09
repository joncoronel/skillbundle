import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown02Icon,
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
 * Momentum chip showing how much an install count moved hour-over-hour on the
 * Hot rail. Green/up for a positive delta, red/down for a negative one — the
 * v1 hot view ranks by current-hour install volume, so the hottest skills are
 * frequently cooling vs the same hour yesterday. Renders nothing for a flat
 * (zero) delta.
 */
export function HotMomentumChip({
  change,
  className,
}: {
  change: number;
  className?: string;
}) {
  if (change === 0) return null;
  const rising = change > 0;
  const sign = rising ? "+" : "−";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
        rising
          ? "bg-success/10 text-success-foreground border-success/20"
          : "bg-destructive/10 text-destructive border-destructive/20",
        className,
      )}
      title={`${sign}${Math.abs(change).toLocaleString()} installs vs same hour yesterday`}
    >
      <HugeiconsIcon
        icon={rising ? ArrowUp02Icon : ArrowDown02Icon}
        strokeWidth={2}
        className="size-2.5"
        aria-hidden="true"
      />
      {sign}
      {formatInstalls(Math.abs(change))}
    </span>
  );
}
