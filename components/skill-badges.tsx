import type { ReactNode } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowDown02Icon,
  ArrowUp02Icon,
  CheckmarkBadge02Icon,
  GithubIcon,
} from "@hugeicons/core-free-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/cubby-ui/tooltip";
import { cn, formatInstalls } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Signal icon — shared vocabulary for row-level skill signals
// ---------------------------------------------------------------------------

export type SignalTone = "warning" | "info" | "muted";

const SIGNAL_TONE: Record<SignalTone, string> = {
  warning: "text-warning-foreground",
  info: "text-info-foreground",
  muted: "text-muted-foreground",
};

/**
 * Bare icon for a row-level skill signal (official, status, copies,
 * GitHub-only). The icon carries the meaning — never color alone — and `label`
 * is the accessible name, announced as part of the row. A chrome tooltip adds
 * the fuller explanation on hover, matching the search bar's scope toggles.
 * One component for all of them, so no icon in a row falls back to the
 * browser's native `title` tooltip beside a styled one.
 *
 * No tinted box around the glyph. It sits beside the install-count icon, a
 * bare 16px glyph, and a box was the one shape in the row that differed. It
 * also had to shrink the glyph to 12px to fit a row-height pill, which
 * rendered 22 x 18 and read as a squashed oval rather than a square.
 *
 * Deliberately NOT focusable: in a 60-row list, making every icon a tab stop
 * would wreck keyboard navigation, and the row itself is the interactive element
 * that links to the detail page carrying the full text. This mirrors the prior
 * native-`title` behavior (hover-only), just styled and consistent.
 */
export function SignalIcon({
  icon,
  label,
  tone = "muted",
  tooltip,
  className,
}: {
  icon: IconSvgElement;
  label: string;
  tone?: SignalTone;
  tooltip: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            // `role="img"`, not a bare span: a span's implicit role is
            // `generic`, which PROHIBITS aria-label, so the name was silently
            // dropped and the icon announced as nothing.
            role="img"
            aria-label={label}
            className={cn(
              "inline-flex shrink-0 items-center",
              SIGNAL_TONE[tone],
              className,
            )}
          />
        }
      >
        <HugeiconsIcon
          icon={icon}
          strokeWidth={2}
          className="size-4"
          aria-hidden="true"
        />
      </TooltipTrigger>
      <TooltipContent variant="chrome" className="max-w-56 leading-snug">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Individual badges
// ---------------------------------------------------------------------------

/**
 * "Official" verified mark for skills curated by skills.sh as first-party.
 * Just the checkmark-badge icon, no pill, no label. Tooltip identifies the
 * curated owner.
 */
export function OfficialBadge({
  owner,
  className,
}: {
  owner: string;
  className?: string;
}) {
  const label = `Official skill from ${owner}`;
  return (
    <SignalIcon
      icon={CheckmarkBadge02Icon}
      label={label}
      tone="info"
      tooltip={label}
      className={className}
    />
  );
}

/**
 * Marks a skill that exists only on GitHub, not through the skills.sh API.
 * Uses the muted signal icon (icon carries the meaning, never color alone); the
 * tooltip explains the reduced-data consequence. Auto-disappears the moment the
 * skill is adopted onto skills.sh (isGitHubOnly clears in the sync).
 */
export function GitHubOnlyBadge({ className }: { className?: string }) {
  return (
    <SignalIcon
      icon={GithubIcon}
      label="GitHub-only skill"
      tone="muted"
      tooltip="Only on GitHub, not skills.sh. Install counts and security audits stay unavailable until it's listed on skills.sh."
      className={className}
    />
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
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-(length:--text-micro) font-medium tabular-nums",
        rising
          ? "border-success/20 bg-success/10 text-success-foreground"
          : "border-destructive/20 bg-destructive/10 text-destructive",
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
