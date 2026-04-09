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
import { useBundleSelection } from "@/lib/bundle-selection-context";
import { cn, formatInstalls, timeAgo } from "@/lib/utils";

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

interface SkillCardProps {
  skill: SkillData;
  selectable?: boolean;
  onViewDetail?: () => void;
  className?: string;
  variant?: "card" | "row";
}

export function SkillCard({
  skill,
  selectable = false,
  onViewDetail,
  className,
  variant = "card",
}: SkillCardProps) {
  const {
    name,
    source,
    skillId,
    description,
    installs,
    updatedSinceAdded,
    contentUpdatedAt,
    createdAt,
    isDelisted,
    hasContentFetchError,
  } = skill;
  const id = useId();
  const checkboxId = `skill-${id}`;

  // Always call hook (rules of hooks) — returns null outside provider
  const selection = useBundleSelection();
  const selected =
    selectable && selection ? selection.isSelected(source, skillId) : false;

  const cardTimestamp = contentUpdatedAt ?? createdAt;
  const cardTimeLabel = contentUpdatedAt !== undefined ? "Updated" : "Added";

  if (variant === "row") {
    const rowInner = (
      <div className="flex items-center gap-3 px-4">
        {selectable && (
          <Checkbox
            id={checkboxId}
            checked={selected}
            onCheckedChange={() => {
              if (selection)
                selection.toggleSkill({ source, skillId, name });
            }}
            className="shrink-0"
          />
        )}
        <div className="flex flex-wrap items-baseline gap-x-2 min-w-0">
          <span className="text-sm font-semibold">
            {onViewDetail ? (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onViewDetail();
                }}
                className="hover:underline text-left"
              >
                {name}
              </button>
            ) : (
              <Link
                href={`/${source}/${skillId}`}
                className="hover:underline text-left"
                onClick={(e) => e.stopPropagation()}
                prefetch={false}
              >
                {name}
              </Link>
            )}
          </span>
          <span className="text-sm text-muted-foreground">{source}</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <SkillStatusBadge
            status={deriveSkillStatus({ isDelisted, hasContentFetchError, updatedSinceAdded })}
          />
          <span className="text-xs font-mono tabular-nums text-muted-foreground">
            {formatInstalls(installs)}
          </span>
        </div>
      </div>
    );

    if (selectable) {
      return (
        <Label
          htmlFor={checkboxId}
          data-variant="default"
          className={cn(
            "text-card-foreground flex flex-col bg-card rounded-2xl border dark:border-border/50 py-3",
            "cursor-pointer transition-colors",
            "has-data-checked:border-primary/30 dark:has-data-checked:border-primary/30 has-data-checked:bg-primary/8",
            "[&:has(+_label_[data-checked])]:border-b-primary/30 dark:[&:has(+_label_[data-checked])]:border-b-primary/30",
            "hover:border-border/20",
            className,
          )}
        >
          {rowInner}
        </Label>
      );
    }

    return rowInner;
  }

  const cardInner = (
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
                    source,
                    skillId,
                    name,
                  });
              }}
              className="shrink-0"
            />
          )}
          <CardTitle className="text-sm leading-snug flex items-center">
            {onViewDetail ? (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onViewDetail();
                }}
                className="hover:underline text-left [text-box:trim-both_cap_alphabetic]"
              >
                {name}
              </button>
            ) : (
              <Link
                href={`/${source}/${skillId}`}
                className="hover:underline text-left"
                onClick={(e) => e.stopPropagation()}
              >
                {name}
              </Link>
            )}
          </CardTitle>
        </div>
        <CardAction>
          <div className="flex items-center gap-1.5">
            <SkillStatusBadge
              status={deriveSkillStatus({ isDelisted, hasContentFetchError, updatedSinceAdded })}
            />
            <span className="text-xs font-mono tabular-nums text-muted-foreground">
              {formatInstalls(installs)} installs
            </span>
          </div>
        </CardAction>
        <CardDescription className="text-xs line-clamp-2">
          {description ?? source}
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

  if (selectable) {
    return (
      <Label
        htmlFor={checkboxId}
        data-variant="default"
        className={cn(
          "text-card-foreground flex flex-col bg-card gap-3 rounded-2xl border dark:border-border/50 py-4 h-full",
          "cursor-pointer transition-colors",
          "has-data-checked:border-primary/30 dark:has-data-checked:border-primary/30 has-data-checked:bg-primary/8",
          "hover:border-border/20",
          className,
        )}
      >
        {cardInner}
      </Label>
    );
  }

  return <Card className={cn("gap-3 py-4", className)}>{cardInner}</Card>;
}
