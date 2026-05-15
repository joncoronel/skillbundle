"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Album02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";
import { Sheet, SheetContent } from "@/components/ui/cubby-ui/sheet";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/cubby-ui/tooltip";
import { cn } from "@/lib/utils";
import { MAX_BUNDLE_SKILLS } from "@/lib/bundle-limits";

export interface BundleEditBarProps {
  /** Drives the Sheet's open state so it animates in/out as edit mode
   *  toggles. Parent keeps this component mounted so Base UI sees a real
   *  false → true → false transition (matches the home BundleBar's
   *  always-mounted pattern). */
  open: boolean;
  /** Current total of staged skills (current bundle ± pending diff). */
  skillCount: number;
  /** Number of skills staged for addition that aren't in the source bundle. */
  addedCount: number;
  /** Number of skills staged for removal from the source bundle. */
  removedCount: number;
  /** True when the user has unsaved changes (adds/removes/reorders). */
  dirty: boolean;
  onSave: () => void;
  onCancel: () => void;
  /** Opens the skill picker sheet. Lives on the bar so it's reachable
   *  regardless of scroll position in long bundles. */
  onAddSkills: () => void;
}

export function BundleEditBar({
  open,
  skillCount,
  addedCount,
  removedCount,
  dirty,
  onSave,
  onCancel,
  onAddSkills,
}: BundleEditBarProps) {
  const atCap = skillCount >= MAX_BUNDLE_SKILLS;

  const addButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onAddSkills}
      disabled={atCap}
      leftSection={
        <HugeiconsIcon
          icon={Add01Icon}
          strokeWidth={2}
          className="size-3.5"
        />
      }
    >
      Add skills
    </Button>
  );

  return (
    <Sheet open={open} modal={false}>
      <SheetContent
        side="bottom"
        variant="floating"
        showCloseButton={false}
        className={cn(
          "flex flex-col overflow-hidden",
          "max-sm:inset-x-0 max-sm:bottom-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-none max-sm:ring-0 max-sm:border-t max-sm:shadow-[0_-4px_20px_-4px_rgb(0_0_0/0.15)] max-sm:data-starting-style:translate-y-full max-sm:data-ending-style:translate-y-full",
          "sm:inset-x-auto sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-auto sm:max-w-[min(640px,calc(100vw-2rem))] sm:shadow-lg sm:ring-border sm:ring-1",
        )}
      >
        <div className="flex items-center gap-2 px-3 py-2 sm:gap-4 sm:px-4 sm:py-2.5">
          {/* Status block. On mobile we collapse to just the icon + a
              single-line "N skills" count so the action buttons have
              room. On sm+ we get the full two-line "Editing bundle / N
              in bundle · +A/−R pending" treatment. */}
          <div className="flex min-w-0 shrink-0 items-center gap-2.5 sm:flex-1">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/12 text-primary">
              <HugeiconsIcon
                icon={Album02Icon}
                strokeWidth={2}
                className="size-4"
              />
            </span>
            <div className="hidden min-w-0 flex-col leading-tight sm:flex">
              <span className="truncate text-sm font-medium tabular-nums">
                Editing bundle
              </span>
              <span className="truncate text-xs text-muted-foreground tabular-nums">
                {skillCount} in bundle
                {(addedCount > 0 || removedCount > 0) && (
                  <>
                    <span aria-hidden> · </span>
                    {addedCount > 0 && (
                      <span className="text-success-foreground">
                        +{addedCount}
                      </span>
                    )}
                    {addedCount > 0 && removedCount > 0 && (
                      <span aria-hidden> / </span>
                    )}
                    {removedCount > 0 && (
                      <span className="text-destructive">−{removedCount}</span>
                    )}
                    <span> pending</span>
                  </>
                )}
              </span>
            </div>
          </div>

          <div className="flex flex-1 sm:hidden" />

          <div className="flex shrink-0 items-center gap-2">
            {atCap ? (
              <Tooltip>
                <TooltipTrigger render={<span tabIndex={0} />}>
                  {addButton}
                </TooltipTrigger>
                <TooltipContent>
                  Bundle is at the {MAX_BUNDLE_SKILLS}-skill maximum.
                </TooltipContent>
              </Tooltip>
            ) : (
              addButton
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onSave}
              disabled={!dirty}
            >
              <span className="sm:hidden">Save</span>
              <span className="hidden sm:inline">Save changes</span>
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
