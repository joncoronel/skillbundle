"use client";

import { useId } from "react";
import Link from "next/link";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
  CardAction,
} from "@/components/ui/cubby-ui/card";
import { Badge } from "@/components/ui/cubby-ui/badge";
import { Checkbox } from "@/components/ui/cubby-ui/checkbox";
import { Label } from "@/components/ui/cubby-ui/label";
import { SheetTrigger } from "@/components/ui/cubby-ui/sheet";
import {
  useBundleActions,
  useIsSkillSelected,
} from "@/lib/bundle-selection";
import { cn, formatInstalls, timeAgo } from "@/lib/utils";
import type { SkillDetailHandle } from "@/components/skill-detail-sheet";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type SkillStatus = "delisted" | "fetch-error" | "updated" | null;

function deriveSkillStatus(props: {
  isDelisted?: boolean;
  hasContentFetchError?: boolean;
  updatedSinceAdded?: boolean;
}): SkillStatus {
  if (props.isDelisted) return "delisted";
  if (props.hasContentFetchError) return "fetch-error";
  if (props.updatedSinceAdded) return "updated";
  return null;
}

const STATUS_BADGE_CONFIG: Record<
  Exclude<SkillStatus, null>,
  { label: string; variant: "warning" | "info" }
> = {
  delisted: { label: "No longer listed", variant: "warning" },
  "fetch-error": { label: "Install may fail", variant: "warning" },
  updated: { label: "Updated", variant: "info" },
};

function SkillStatusBadge({ status }: { status: SkillStatus }) {
  if (!status) return null;
  const { label, variant } = STATUS_BADGE_CONFIG[status];
  return (
    <Badge variant={variant} className="text-[10px] px-1.5 py-0.5">
      {label}
    </Badge>
  );
}

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
      href={`/${skill.source}/${skill.skillId}`}
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
}: {
  skill: SkillData;
  showLabel?: boolean;
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
function SkillSelectionCheckbox({
  skill,
  checkboxId,
}: {
  skill: SkillData;
  checkboxId: string;
}) {
  const isSelected = useIsSkillSelected(skill.source, skill.skillId);
  const { toggleSkill } = useBundleActions();
  return (
    <Checkbox
      id={checkboxId}
      checked={isSelected}
      onCheckedChange={() =>
        toggleSkill({
          source: skill.source,
          skillId: skill.skillId,
          name: skill.name,
        })
      }
      className="shrink-0"
    />
  );
}

// ---------------------------------------------------------------------------
// Shared props
// ---------------------------------------------------------------------------

interface SkillViewProps {
  skill: SkillData;
  sheetHandle?: SkillDetailHandle;
  className?: string;
}

// ---------------------------------------------------------------------------
// Row variants
// ---------------------------------------------------------------------------

function SkillRowContent({
  skill,
  sheetHandle,
  leading,
}: {
  skill: SkillData;
  sheetHandle?: SkillDetailHandle;
  leading?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4">
      {leading}
      <div className="flex flex-wrap items-baseline gap-x-2 min-w-0">
        <span className="text-sm font-semibold">
          <SkillName skill={skill} sheetHandle={sheetHandle} />
        </span>
        <span className="text-sm text-muted-foreground">{skill.source}</span>
      </div>
      <div className="ml-auto shrink-0">
        <SkillMeta skill={skill} />
      </div>
    </div>
  );
}

export function SkillRowView({ skill, sheetHandle }: SkillViewProps) {
  return <SkillRowContent skill={skill} sheetHandle={sheetHandle} />;
}

export function SelectableSkillRow({
  skill,
  sheetHandle,
  className,
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
        leading={<SkillSelectionCheckbox skill={skill} checkboxId={checkboxId} />}
      />
    </SelectableWrapper>
  );
}

// ---------------------------------------------------------------------------
// Card variants
// ---------------------------------------------------------------------------

function SkillCardContent({
  skill,
  sheetHandle,
  leading,
}: {
  skill: SkillData;
  sheetHandle?: SkillDetailHandle;
  leading?: React.ReactNode;
}) {
  const cardTimestamp = skill.contentUpdatedAt ?? skill.createdAt;
  const cardTimeLabel =
    skill.contentUpdatedAt !== undefined ? "Updated" : "Added";

  return (
    <>
      <CardHeader className="gap-1">
        <div className="flex items-center gap-2">
          {leading}
          <CardTitle className="text-sm leading-snug flex items-center">
            <SkillName
              skill={skill}
              sheetHandle={sheetHandle}
              className="[text-box:trim-both_cap_alphabetic]"
            />
          </CardTitle>
        </div>
        <CardAction>
          <SkillMeta skill={skill} showLabel />
        </CardAction>
        <CardDescription className="text-xs line-clamp-2">
          {skill.description ?? skill.source}
        </CardDescription>
      </CardHeader>
      {cardTimestamp !== undefined && (
        <CardFooter className="mt-auto pt-0 justify-end">
          <span className="text-[11px] text-muted-foreground/60">
            {cardTimeLabel} {timeAgo(cardTimestamp)}
          </span>
        </CardFooter>
      )}
    </>
  );
}

export function SkillCardView({
  skill,
  sheetHandle,
  className,
}: SkillViewProps) {
  return (
    <Card className={cn("gap-3 py-4", className)}>
      <SkillCardContent skill={skill} sheetHandle={sheetHandle} />
    </Card>
  );
}

export function SelectableSkillCard({
  skill,
  sheetHandle,
  className,
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
        leading={<SkillSelectionCheckbox skill={skill} checkboxId={checkboxId} />}
      />
    </SelectableWrapper>
  );
}
