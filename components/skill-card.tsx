"use client";

import { memo, useCallback, useId } from "react";
import Link from "next/link";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
  CardAction,
} from "@/components/ui/cubby-ui/card";
import { Checkbox } from "@/components/ui/cubby-ui/checkbox";
import { Label } from "@/components/ui/cubby-ui/label";
import { SheetTrigger } from "@/components/ui/cubby-ui/sheet";
import {
  useBundleActions,
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
      <span className="text-xs font-mono tabular-nums text-muted-foreground">
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
// target via `htmlFor={checkboxId}`.
const SkillSelectionCheckbox = memo(function SkillSelectionCheckbox({
  skill,
  checkboxId,
}: {
  skill: SkillData;
  checkboxId: string;
}) {
  const isSelected = useIsSkillSelected(skill.source, skill.skillId);
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
            <OfficialBadge
              owner={skill.curatedOwner}
              className="self-center"
            />
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
  const showFooter = showAudit || cardTimestamp !== undefined;

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
            {skill.curatedOwner && (
              <OfficialBadge owner={skill.curatedOwner} />
            )}
          </CardTitle>
        </div>
        <CardAction>
          <SkillMeta skill={skill} showLabel showHotChip={showHotChip} />
        </CardAction>
        <CardDescription className="text-xs line-clamp-2">
          {skill.description ?? skill.source}
        </CardDescription>
      </CardHeader>
      {showFooter && (
        <CardFooter className="mt-auto pt-0 justify-between gap-3">
          {showAudit ? (
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
          ) : (
            <span aria-hidden="true" />
          )}
          {cardTimestamp !== undefined && (
            <span className="text-[11px] text-muted-foreground/60">
              {cardTimeLabel} {timeAgo(cardTimestamp)}
            </span>
          )}
        </CardFooter>
      )}
    </>
  );
});

export const SkillCardView = memo(function SkillCardView({
  skill,
  sheetHandle,
  className,
  showHotChip,
}: SkillViewProps) {
  return (
    <Card className={cn("gap-3 py-4", className)}>
      <SkillCardContent
        skill={skill}
        sheetHandle={sheetHandle}
        showHotChip={showHotChip}
      />
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
