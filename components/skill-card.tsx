"use client";

import { memo, useCallback, useId } from "react";
import Link from "next/link";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
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
import { HotMomentumChip, OfficialBadge } from "@/components/skill-badges";
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
      prefetch={false}
    >
      {skill.name}
    </Link>
  );
}

function SkillMeta({
  skill,
  showLabel,
  showHotChip,
}: {
  skill: SkillData;
  showLabel?: boolean;
  showHotChip?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <SkillStatusBadge
        status={deriveSkillStatus({
          isDelisted: skill.isDelisted,
          hasContentFetchError: skill.hasContentFetchError,
          updatedSinceAdded: skill.updatedSinceAdded,
        })}
      />
      {showHotChip && skill.hotChange !== undefined && skill.hotChange > 0 && (
        <HotMomentumChip change={skill.hotChange} />
      )}
      <span className="inline-flex items-center gap-1 text-xs font-mono tabular-nums text-muted-foreground">
        <HugeiconsIcon
          icon={Download04Icon}
          strokeWidth={2}
          className="size-4"
        />
        {formatInstalls(skill.installs)}
        {showLabel && " installs"}
      </span>
    </div>
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
  /** Show the hour-over-hour hot momentum chip next to install count.
   *  Off by default — only the home page's Hot tab opts in. */
  showHotChip?: boolean;
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
  showHotChip,
}: {
  skill: SkillData;
  sheetHandle?: SkillDetailHandle;
  selectable?: boolean;
  checkboxId?: string;
  showHotChip?: boolean;
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
        <span className="text-sm text-muted-foreground">{skill.source}</span>
      </div>
      <div className="ml-auto shrink-0">
        <SkillMeta skill={skill} showHotChip={showHotChip} />
      </div>
    </div>
  );
});

export const SkillRowView = memo(function SkillRowView({
  skill,
  sheetHandle,
  showHotChip,
}: SkillViewProps) {
  return (
    <SkillRowContent
      skill={skill}
      sheetHandle={sheetHandle}
      showHotChip={showHotChip}
    />
  );
});

export const SelectableSkillRow = memo(function SelectableSkillRow({
  skill,
  sheetHandle,
  className,
  showHotChip,
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
        showHotChip={showHotChip}
        selectable
        checkboxId={checkboxId}
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
  showHotChip,
}: {
  skill: SkillData;
  sheetHandle?: SkillDetailHandle;
  selectable?: boolean;
  checkboxId?: string;
  showHotChip?: boolean;
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
          <SkillMeta skill={skill} showHotChip={showHotChip} />
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
  showHotChip,
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
      <SkillCardContent
        skill={skill}
        sheetHandle={sheetHandle}
        showHotChip={showHotChip}
      />
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
  showHotChip,
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
        showHotChip={showHotChip}
        selectable
        checkboxId={checkboxId}
      />
    </SelectableWrapper>
  );
});
