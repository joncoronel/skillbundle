"use client";

import { memo, useCallback, useId } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Copy01Icon,
  Download04Icon,
} from "@hugeicons/core-free-icons";
import { Checkbox } from "@/components/ui/cubby-ui/checkbox";
import { Label } from "@/components/ui/cubby-ui/label";
import { SheetTrigger } from "@/components/ui/cubby-ui/sheet";
import {
  useBundleActions,
  useIsSelectionAtCap,
  useIsSkillSelected,
} from "@/lib/bundle-selection";
import { cn, formatInstalls } from "@/lib/utils";
import { useSkillDetailHandle } from "@/components/skill-detail-sheet";
import {
  deriveSkillStatus,
  SkillStatusBadge,
} from "@/components/skill-status-badge";
import {
  HotMomentumChip,
  OfficialBadge,
  GitHubOnlyBadge,
  SignalChip,
} from "@/components/skill-badges";
import { skillHref } from "@/lib/skill-urls";
import { renderHighlight } from "@/lib/search/highlight";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

// Defined in lib/listing-styles.ts, not here: this module is `"use client"`,
// and the listing pages that also need it are Server Components. Re-exported so
// this file stays the one import site for everything a skill row needs.
export { rowPositionClassName } from "@/lib/listing-styles";

export interface SkillData {
  name: string;
  /** Typesense's highlight of `name` (matched tokens wrapped in `<mark>`), set
   *  only on live search hits. When present it's rendered in place of the plain
   *  name so matches are marked — fuzzy-aware, straight from the engine. */
  nameHighlight?: string;
  source: string;
  skillId: string;
  description?: string;
  installs: number;
  /** @deprecated Kept for backward-compat with bundle data; not rendered. */
  technologies?: string[];
  updatedSinceAdded?: boolean;
  contentUpdatedAt?: number;
  createdAt?: number;
  isDelisted?: boolean;
  hasContentFetchError?: boolean;
  /** True when the skill exists only on GitHub, not on the skills.sh API.
   *  Drives the "GitHub-only" badge. Clears automatically on adoption. */
  isGitHubOnly?: boolean;
  // v1 API fields, denormalized onto skillSummaries.
  curatedOwner?: string;
  worstAuditStatus?: string;
  worstAuditRiskLevel?: string;
  trendingRank?: number;
  hotChange?: number;
  /** Installs in the current hour (delta + same-hour-yesterday). Set only for
   *  Hot-rail rows; rendered there in place of lifetime installs, since it's
   *  the value the Hot list is ranked by. */
  hot1hInstalls?: number;
  /** Installs over the trending window (~24h). Set only for Trending-rail
   *  rows; rendered there in place of lifetime installs. */
  trendingInstalls?: number;
  /** How many other skills share this one's content — aliases (same repo,
   *  renamed) + forks (different repos, same SKILL.md). Drives the "shared
   *  content" marker. Precomputed by computeCopyCounts. */
  copyCount?: number;
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function SkillName({
  skill,
  className,
}: {
  skill: SkillData;
  className?: string;
}) {
  // The page's sheet handle comes from context (provided once per page);
  // no provider = link to the skill page instead.
  const sheetHandle = useSkillDetailHandle();
  // On a live search hit, highlight the matched substring of the name;
  // otherwise render it plain.
  const nameContent = skill.nameHighlight
    ? renderHighlight(skill.nameHighlight)
    : skill.name;

  if (sheetHandle) {
    return (
      <SheetTrigger
        handle={sheetHandle}
        payload={skill}
        className={cn("hover:underline text-left", className)}
      >
        {nameContent}
      </SheetTrigger>
    );
  }
  return (
    <Link
      href={skillHref(skill.source, skill.skillId)}
      className={cn("hover:underline text-left", className)}
    >
      {nameContent}
    </Link>
  );
}

/**
 * Which leaderboard rail a row belongs to, when it isn't the default lifetime
 * view. Each rail shows the windowed install count its list is ranked by (in
 * place of lifetime installs) so the ordering is legible; "hot" also shows the
 * momentum chip. One discriminated value rather than a boolean per rail, so the
 * modes stay mutually exclusive.
 */
export type LeaderboardMetric = "hot" | "trending";

const METRIC_DISPLAY: Record<
  LeaderboardMetric,
  {
    value: (skill: SkillData) => number | undefined;
    title: string;
    suffix: string;
  }
> = {
  hot: {
    value: (skill) => skill.hot1hInstalls,
    title: "Installs in the last hour",
    suffix: " in last hr",
  },
  trending: {
    value: (skill) => skill.trendingInstalls,
    title: "Installs in the last 24 hours",
    suffix: " in last 24h",
  },
};

function SkillMeta({
  skill,
  showLabel,
  metric,
}: {
  skill: SkillData;
  showLabel?: boolean;
  metric?: LeaderboardMetric;
}) {
  // For a leaderboard rail, show the windowed install count it's ranked by in
  // place of lifetime installs, so the ordering is legible.
  const display = metric ? METRIC_DISPLAY[metric] : undefined;
  const windowed = display?.value(skill);
  const installCount = windowed ?? skill.installs;
  // Signal chips sit to the left; the install count is always the last (right-
  // most) element so it reads as a stable anchor down the list. The Hot momentum
  // chip stays adjacent to the count it annotates.
  return (
    <div className="flex items-center gap-1.5">
      <SkillStatusBadge
        status={deriveSkillStatus({
          isDelisted: skill.isDelisted,
          hasContentFetchError: skill.hasContentFetchError,
          updatedSinceAdded: skill.updatedSinceAdded,
        })}
      />
      {skill.copyCount ? <CopiesBadge count={skill.copyCount} /> : null}
      {metric === "hot" && skill.hotChange !== undefined && skill.hotChange !== 0 && (
        <HotMomentumChip change={skill.hotChange} />
      )}
      <span
        className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground"
        title={windowed !== undefined ? display?.title : undefined}
      >
        <HugeiconsIcon
          icon={Download04Icon}
          strokeWidth={2}
          className="size-4"
        />
        {formatInstalls(installCount)}
        {showLabel && (windowed !== undefined ? display?.suffix : " installs")}
      </span>
    </div>
  );
}

/**
 * Quiet marker shown when a skill's content also lives under other repos
 * (renamed aliases and/or genuine forks). Signals the row is one of several
 * copies; the skill page lists them and lets the user pick. Count is capped
 * upstream, so render "9+" past the cap rather than an exact large number.
 */
function CopiesBadge({ count }: { count: number }) {
  // Icon-only chip; the count lives in the accessible label + tooltip, not the
  // visible glyph (kept consistent with the status chips).
  const label = count === 1 ? "1 copy" : `${count > 9 ? "9+" : count} copies`;
  return (
    <SignalChip
      icon={Copy01Icon}
      label={label}
      tooltip="The same content is published under other names or forks. Open the skill to compare them."
    />
  );
}

function SelectableWrapper({
  checkboxId,
  className,
  children,
}: {
  checkboxId: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Label
      htmlFor={checkboxId}
      data-variant="default"
      className={cn(
        "text-card-foreground flex flex-col bg-card rounded-2xl border dark:border-border/50",
        "cursor-pointer transition-colors",
        "has-data-checked:border-primary/30 dark:has-data-checked:border-primary/30 has-data-checked:bg-primary/8",
        className,
      )}
    >
      {children}
    </Label>
  );
}

// The Checkbox wired up to the global bundle selection. Lives inside a
// `SelectableWrapper` (a <Label>) so the whole row/card acts as the click
// target via `htmlFor={checkboxId}`. When the selection has hit the
// bundle-skill cap, unchecked cards disable their checkbox so the user
// can't accumulate an over-cap selection — uncheck (remove) keeps working
// because it frees capacity.
const SkillSelectionCheckbox = memo(function SkillSelectionCheckbox({
  skill,
  checkboxId,
}: {
  skill: SkillData;
  checkboxId: string;
}) {
  const isSelected = useIsSkillSelected(skill.source, skill.skillId);
  const atCap = useIsSelectionAtCap();
  const disabled = atCap && !isSelected;
  const { toggleSkill } = useBundleActions();
  const handleToggle = useCallback(() => {
    toggleSkill({
      source: skill.source,
      skillId: skill.skillId,
      name: skill.name,
    });
  }, [toggleSkill, skill.source, skill.skillId, skill.name]);
  return (
    <Checkbox
      id={checkboxId}
      variant="elevated"
      checked={isSelected}
      onCheckedChange={handleToggle}
      disabled={disabled}
      className="shrink-0"
    />
  );
});

// ---------------------------------------------------------------------------
// Shared props
// ---------------------------------------------------------------------------

interface SkillViewProps {
  skill: SkillData;
  className?: string;
  /** Which leaderboard rail this row belongs to (default: lifetime view).
   *  "hot" adds the momentum chip and shows hourly installs; "trending" shows
   *  ~24h installs. Only the home page's Hot/Trending tabs set it. */
  metric?: LeaderboardMetric;
  /** Hide the per-row source label. See SkillRowContent's `hideSource`. */
  hideSource?: boolean;
}


// ---------------------------------------------------------------------------
// Row variants
// ---------------------------------------------------------------------------

// Renders the checkbox internally (via `selectable`/`checkboxId`) instead of
// accepting a JSX node prop, so React.memo's shallow compare can short-circuit
// on stable primitive props — passing a fresh JSX element each render would
// always look "changed."
const SkillRowContent = memo(function SkillRowContent({
  skill,
  selectable,
  checkboxId,
  metric,
  hideSource,
}: {
  skill: SkillData;
  selectable?: boolean;
  checkboxId?: string;
  metric?: LeaderboardMetric;
  /** Omit the source label next to the name. Set on single-source surfaces
   *  (a source page) where every row shares the source already named in the
   *  H1 and breadcrumb, so repeating it per row is pure noise. */
  hideSource?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4">
      {selectable && checkboxId ? (
        <SkillSelectionCheckbox skill={skill} checkboxId={checkboxId} />
      ) : null}
      <div className="flex flex-wrap items-baseline gap-x-2 min-w-0">
        <span className="inline-flex min-w-0 max-w-full items-center gap-1 text-sm font-semibold">
          <SkillName skill={skill} className="min-w-0 truncate" />
          {skill.curatedOwner && (
            <OfficialBadge
              owner={skill.curatedOwner}
              className="shrink-0 self-center"
            />
          )}
          {skill.isGitHubOnly && (
            <GitHubOnlyBadge className="shrink-0 self-center" />
          )}
        </span>
        {!hideSource && (
          <span className="min-w-0 max-w-full truncate text-sm text-muted-foreground">
            {skill.source}
          </span>
        )}
      </div>
      <div className="ml-auto shrink-0">
        <SkillMeta skill={skill} metric={metric} />
      </div>
    </div>
  );
});

export const SkillRowView = memo(function SkillRowView({
  skill,
  metric,
}: SkillViewProps) {
  return <SkillRowContent skill={skill} metric={metric} />;
});

export const SelectableSkillRow = memo(function SelectableSkillRow({
  skill,
  className,
  metric,
  hideSource,
}: SkillViewProps) {
  const id = useId();
  const checkboxId = `skill-${id}`;
  return (
    <SelectableWrapper
      checkboxId={checkboxId}
      className={cn(
        "py-3",
        "[&:has(+_label_[data-checked])]:border-b-primary/30 dark:[&:has(+_label_[data-checked])]:border-b-primary/30",
        className,
      )}
    >
      <SkillRowContent
        skill={skill}
        metric={metric}
        selectable
        checkboxId={checkboxId}
        hideSource={hideSource}
      />
    </SelectableWrapper>
  );
});
