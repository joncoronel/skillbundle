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
import { useBundleSelection } from "@/lib/bundle-selection-context";
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

// ---------------------------------------------------------------------------
// Shared props
// ---------------------------------------------------------------------------

interface SkillViewProps {
  skill: SkillData;
  selectable?: boolean;
  sheetHandle?: SkillDetailHandle;
  className?: string;
}

// ---------------------------------------------------------------------------
// SkillRowView
// ---------------------------------------------------------------------------

function SkillRowContent({
  skill,
  selectable,
  checkboxId,
  selected,
  selection,
  sheetHandle,
}: {
  skill: SkillData;
  selectable: boolean;
  checkboxId: string;
  selected: boolean;
  selection: ReturnType<typeof useBundleSelection>;
  sheetHandle?: SkillDetailHandle;
}) {
  return (
    <div className="flex items-center gap-3 px-4">
      {selectable && (
        <Checkbox
          id={checkboxId}
          checked={selected}
          onCheckedChange={() => {
            if (selection)
              selection.toggleSkill({
                source: skill.source,
                skillId: skill.skillId,
                name: skill.name,
              });
          }}
          className="shrink-0"
        />
      )}
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

export function SkillRowView({
  skill,
  selectable = false,
  sheetHandle,
  className,
}: SkillViewProps) {
  const id = useId();
  const checkboxId = `skill-${id}`;
  const selection = useBundleSelection();
  const selected =
    selectable && selection
      ? selection.isSelected(skill.source, skill.skillId)
      : false;

  const contentProps = { skill, selectable, checkboxId, selected, selection, sheetHandle };

  if (selectable) {
    return (
      <SelectableWrapper
        checkboxId={checkboxId}
        className={cn(
          "py-3",
          "[&:has(+_label_[data-checked])]:border-b-primary/30 dark:[&:has(+_label_[data-checked])]:border-b-primary/30",
          className,
        )}
      >
        <SkillRowContent {...contentProps} />
      </SelectableWrapper>
    );
  }

  return <SkillRowContent {...contentProps} />;
}

// ---------------------------------------------------------------------------
// SkillCardView
// ---------------------------------------------------------------------------

function SkillCardContent({
  skill,
  selectable,
  checkboxId,
  selected,
  selection,
  sheetHandle,
}: {
  skill: SkillData;
  selectable: boolean;
  checkboxId: string;
  selected: boolean;
  selection: ReturnType<typeof useBundleSelection>;
  sheetHandle?: SkillDetailHandle;
}) {
  const cardTimestamp = skill.contentUpdatedAt ?? skill.createdAt;
  const cardTimeLabel =
    skill.contentUpdatedAt !== undefined ? "Updated" : "Added";

  return (
    <>
      <CardHeader className="gap-1">
        <div className="flex items-center gap-2">
          {selectable && (
            <Checkbox
              id={checkboxId}
              checked={selected}
              onCheckedChange={() => {
                if (selection)
                  selection.toggleSkill({
                    source: skill.source,
                    skillId: skill.skillId,
                    name: skill.name,
                  });
              }}
              className="shrink-0"
            />
          )}
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
  selectable = false,
  sheetHandle,
  className,
}: SkillViewProps) {
  const id = useId();
  const checkboxId = `skill-${id}`;
  const selection = useBundleSelection();
  const selected =
    selectable && selection
      ? selection.isSelected(skill.source, skill.skillId)
      : false;

  const contentProps = { skill, selectable, checkboxId, selected, selection, sheetHandle };

  if (selectable) {
    return (
      <SelectableWrapper
        checkboxId={checkboxId}
        className={cn("gap-3 py-4 h-full", className)}
      >
        <SkillCardContent {...contentProps} />
      </SelectableWrapper>
    );
  }

  return (
    <Card className={cn("gap-3 py-4", className)}>
      <SkillCardContent {...contentProps} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// SkillCard — thin dispatcher (preserves existing API)
// ---------------------------------------------------------------------------

export function SkillCard({
  variant = "card",
  ...props
}: SkillViewProps & { variant?: "card" | "row" }) {
  if (variant === "row") return <SkillRowView {...props} />;
  return <SkillCardView {...props} />;
}
