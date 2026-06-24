"use client";

import { memo, useCallback, useId } from "react";
import Link from "next/link";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Copy01Icon,
  Download04Icon,
} from "@hugeicons/core-free-icons";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/cubby-ui/card";
import { Button } from "@/components/ui/cubby-ui/button";
import { Checkbox } from "@/components/ui/cubby-ui/checkbox";
import { Label } from "@/components/ui/cubby-ui/label";
import { SheetTrigger } from "@/components/ui/cubby-ui/sheet";
import {
  useBundleActions,
  useIsSelectionAtCap,
  useIsSkillSelected,
} from "@/lib/bundle-selection";
import { cn, formatInstalls, timeAgo } from "@/lib/utils";
import type { SkillDetailHandle } from "@/components/skill-detail-sheet";
import {
  deriveSkillStatus,
  SkillStatusBadge,
} from "@/components/skill-status-badge";
import {
  HotMomentumChip,
  OfficialBadge,
  SignalChip,
} from "@/components/skill-badges";
import { skillHref } from "@/lib/skill-urls";
import { QuickAddPopover } from "@/components/quick-add-popover";

export interface SkillEditControls {
  onRemove: () => void;
  /**
   * Override the default `×` icon. Used by the edit-mode diff view to swap in
   * a restore (↶) icon for cards that are marked as pending-remove, so the
   * same button slot communicates "put it back" instead of "remove again."
   */
  removeIcon?: IconSvgElement;
  /** Override aria-label / title for the remove button. */
  removeLabel?: string;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

export interface SkillData {
  name: string;
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
  sheetHandle,
  className,
}: {
  skill: SkillData;
  sheetHandle?: SkillDetailHandle;
  className?: string;
}) {
  if (sheetHandle) {
    return (
      <SheetTrigger
        handle={sheetHandle}
        payload={skill}
        className={cn("hover:underline text-left", className)}
      >
        {skill.name}
      </SheetTrigger>
    );
  }
  return (
    <Link
      href={skillHref(skill.source, skill.skillId)}
      className={cn("hover:underline text-left", className)}
    >
      {skill.name}
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
        className="inline-flex items-center gap-1 text-xs font-mono tabular-nums text-muted-foreground"
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
  sheetHandle?: SkillDetailHandle;
  className?: string;
  /** Which leaderboard rail this row belongs to (default: lifetime view).
   *  "hot" adds the momentum chip and shows hourly installs; "trending" shows
   *  ~24h installs. Only the home page's Hot/Trending tabs set it. */
  metric?: LeaderboardMetric;
  /** When set, the card renders edit controls (remove + optional reorder)
   *  in place of the install-count meta. Owner-only on the bundle detail
   *  page's edit mode. */
  editControls?: SkillEditControls;
  /** Render a "+" affordance next to install count that opens the
   *  "add to existing bundle" picker. Opt-in per usage site so it doesn't
   *  conflict with selection-based screens (homepage tabs). Ignored when
   *  `editControls` is set. */
  enableQuickAdd?: boolean;
  /** When rendering inside a bundle detail page, pass the current bundle's
   *  id so the QuickAddPopover can mark that bundle's row as "CURRENT" and
   *  disable its checkbox — removal from the current bundle should go
   *  through Edit skills, not the popover. */
  currentBundleId?: string;
  /** Hide the per-row source label. See SkillRowContent's `hideSource`. */
  hideSource?: boolean;
}

const SkillEditControlButtons = memo(function SkillEditControlButtons({
  controls,
}: {
  controls: SkillEditControls;
}) {
  const {
    onRemove,
    removeIcon,
    removeLabel,
    onMoveUp,
    onMoveDown,
    canMoveUp,
    canMoveDown,
  } = controls;
  const showReorder = onMoveUp !== undefined || onMoveDown !== undefined;
  const removeButtonLabel = removeLabel ?? "Remove skill from bundle";
  return (
    <div className="flex items-center gap-0.5">
      {showReorder && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon_xs"
            disabled={!canMoveUp}
            onClick={onMoveUp}
            aria-label="Move skill up"
            title="Move up"
          >
            <HugeiconsIcon
              icon={ArrowUp01Icon}
              strokeWidth={2}
              className="size-3.5"
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon_xs"
            disabled={!canMoveDown}
            onClick={onMoveDown}
            aria-label="Move skill down"
            title="Move down"
          >
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              strokeWidth={2}
              className="size-3.5"
            />
          </Button>
        </>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon_xs"
        onClick={onRemove}
        aria-label={removeButtonLabel}
        title={removeButtonLabel}
        className="text-muted-foreground hover:text-foreground"
      >
        <HugeiconsIcon
          icon={removeIcon ?? Cancel01Icon}
          strokeWidth={2}
          className="size-3.5"
        />
      </Button>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Row variants
// ---------------------------------------------------------------------------

// Renders the checkbox internally (via `selectable`/`checkboxId`) instead of
// accepting a JSX node prop, so React.memo's shallow compare can short-circuit
// on stable primitive props — passing a fresh JSX element each render would
// always look "changed."
const SkillRowContent = memo(function SkillRowContent({
  skill,
  sheetHandle,
  selectable,
  checkboxId,
  metric,
  hideSource,
}: {
  skill: SkillData;
  sheetHandle?: SkillDetailHandle;
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
        <span className="text-sm font-semibold inline-flex items-center gap-1">
          <SkillName skill={skill} sheetHandle={sheetHandle} />
          {skill.curatedOwner && (
            <OfficialBadge owner={skill.curatedOwner} className="self-center" />
          )}
        </span>
        {!hideSource && (
          <span className="text-sm text-muted-foreground">{skill.source}</span>
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
  sheetHandle,
  metric,
}: SkillViewProps) {
  return (
    <SkillRowContent skill={skill} sheetHandle={sheetHandle} metric={metric} />
  );
});

export const SelectableSkillRow = memo(function SelectableSkillRow({
  skill,
  sheetHandle,
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
        sheetHandle={sheetHandle}
        metric={metric}
        selectable
        checkboxId={checkboxId}
        hideSource={hideSource}
      />
    </SelectableWrapper>
  );
});

// ---------------------------------------------------------------------------
// Card variants
// ---------------------------------------------------------------------------

const SkillCardContent = memo(function SkillCardContent({
  skill,
  sheetHandle,
  selectable,
  checkboxId,
  metric,
}: {
  skill: SkillData;
  sheetHandle?: SkillDetailHandle;
  selectable?: boolean;
  checkboxId?: string;
  metric?: LeaderboardMetric;
}) {
  const cardTimestamp = skill.contentUpdatedAt ?? skill.createdAt;
  const cardTimeLabel =
    skill.contentUpdatedAt !== undefined ? "Updated" : "Added";

  // Audit signal: warn/fail get a short colored text line in the footer
  // (paired with the timestamp). Pass/unknown render nothing — bundles full
  // of clean skills stay quiet; the flagged few earn the attention.
  const auditFail = skill.worstAuditStatus === "fail";
  const auditWarn = skill.worstAuditStatus === "warn";
  const showAudit = auditFail || auditWarn;

  return (
    <>
      <CardHeader className="gap-1">
        <div className="flex items-center gap-2">
          {selectable && checkboxId ? (
            <SkillSelectionCheckbox skill={skill} checkboxId={checkboxId} />
          ) : null}
          <CardTitle className="text-sm leading-snug flex items-center gap-1">
            <SkillName
              skill={skill}
              sheetHandle={sheetHandle}
              className="[text-box:trim-both_cap_alphabetic]"
            />
            {skill.curatedOwner && <OfficialBadge owner={skill.curatedOwner} />}
          </CardTitle>
        </div>
        <CardDescription className="text-xs line-clamp-2">
          {skill.description ?? skill.source}
        </CardDescription>
      </CardHeader>
      {/* Footer carries the skill metadata strip — install count + status
          badge on the left, optional audit label, timestamp on the right.
          Always rendered now (rather than conditional on timestamp/audit)
          because install count is always present and the top-right corner
          of the card is reserved for the quick-add affordance. */}
      <CardFooter className="mt-auto pt-0 justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <SkillMeta skill={skill} metric={metric} />
          {showAudit && (
            <span
              className={cn(
                "text-[11px] font-medium",
                auditFail
                  ? "text-danger-foreground"
                  : "text-warning-foreground",
              )}
              title={`Security audit ${auditFail ? "failed" : "flagged for review"}${
                skill.worstAuditRiskLevel
                  ? ` (${skill.worstAuditRiskLevel} risk)`
                  : ""
              }`}
            >
              {auditFail ? "Risk" : "Review"}
              {skill.worstAuditRiskLevel
                ? ` · ${skill.worstAuditRiskLevel}`
                : ""}
            </span>
          )}
        </div>
        {cardTimestamp !== undefined && (
          <span className="text-[11px] text-muted-foreground/60">
            {cardTimeLabel} {timeAgo(cardTimestamp)}
          </span>
        )}
      </CardFooter>
    </>
  );
});

export const SkillCardView = memo(function SkillCardView({
  skill,
  sheetHandle,
  className,
  metric,
  editControls,
  enableQuickAdd,
  currentBundleId,
}: SkillViewProps) {
  // Edit controls and quick-add both live as absolutely-positioned overlays
  // in the top-right corner. They're mutually exclusive — edit mode wins
  // when both are active, since the card's primary affordance there is
  // "remove / restore from this bundle," not "add to a different bundle."
  // Keeping them out of the header flow means the title row has no
  // competing actions to share space with.
  const showQuickAdd = enableQuickAdd && !editControls;
  return (
    <Card className={cn("relative gap-3 py-4", className)}>
      <SkillCardContent skill={skill} sheetHandle={sheetHandle} metric={metric} />
      {editControls ? (
        <div className="absolute right-2 top-2 z-10">
          <SkillEditControlButtons controls={editControls} />
        </div>
      ) : showQuickAdd ? (
        <div className="absolute right-2 top-2 z-10">
          <QuickAddPopover
            skill={{
              source: skill.source,
              skillId: skill.skillId,
              name: skill.name,
            }}
            currentBundleId={currentBundleId}
          />
        </div>
      ) : null}
    </Card>
  );
});

export const SelectableSkillCard = memo(function SelectableSkillCard({
  skill,
  sheetHandle,
  className,
  metric,
}: SkillViewProps) {
  const id = useId();
  const checkboxId = `skill-${id}`;
  return (
    <SelectableWrapper
      checkboxId={checkboxId}
      className={cn("gap-3 py-4 h-full", className)}
    >
      <SkillCardContent
        skill={skill}
        sheetHandle={sheetHandle}
        metric={metric}
        selectable
        checkboxId={checkboxId}
      />
    </SelectableWrapper>
  );
});
