import type { ReactNode } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowDown02Icon,
  ArrowUp02Icon,
  CheckmarkBadge02Icon,
} from "@hugeicons/core-free-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/cubby-ui/tooltip";
import { cn, formatInstalls } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Signal chip — shared icon-chip vocabulary for row-level skill signals
// ---------------------------------------------------------------------------

type SignalChipTone = "warning" | "info" | "muted";

const SIGNAL_CHIP_TONE: Record<SignalChipTone, string> = {
  warning: "bg-warning/10 text-warning-foreground border-warning/25",
  info: "bg-info/10 text-info-foreground border-info/25",
  muted: "bg-muted text-muted-foreground border-transparent",
};

/**
 * Compact icon chip for a row-level skill signal (status, copies). The icon
 * carries the meaning — never color alone — and `label` is the accessible name,
 * announced as part of the row. A styled tooltip adds the fuller explanation on
 * hover/pointer.
 *
 * Deliberately NOT focusable: in a 60-row list, making every chip a tab stop
 * would wreck keyboard navigation, and the row itself is the interactive element
 * that links to the detail page carrying the full text. This mirrors the prior
 * native-`title` behavior (hover-only), just styled and consistent.
 */
export function SignalChip({
  icon,
  label,
  tone = "muted",
  tooltip,
  className,
}: {
  icon: IconSvgElement;
  label: string;
  tone?: SignalChipTone;
  tooltip: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={label}
            className={cn(
              "inline-flex shrink-0 items-center rounded-md border px-1 py-0.5 text-[10px] font-medium",
              SIGNAL_CHIP_TONE[tone],
              className,
            )}
          />
        }
      >
        <HugeiconsIcon
          icon={icon}
          strokeWidth={2}
          className="size-3"
          aria-hidden="true"
        />
      </TooltipTrigger>
      <TooltipContent className="max-w-56 leading-snug">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

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
