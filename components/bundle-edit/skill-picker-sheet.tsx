"use client";

import { useState } from "react";

import { api } from "@/convex/_generated/api";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/cubby-ui/sheet";
import {
  PickerPopularResults,
  PickerSearchResults,
  SkillSearchField,
  type PickerSkill,
  type SkillPickerCopy,
} from "@/components/skill-picker";
import { useDebouncedCachedSearch } from "@/hooks/use-debounced-cached-search";
import { cn } from "@/lib/utils";
import { MAX_BUNDLE_SKILLS } from "@/lib/bundle-limits";

// Show the cap status line once the staged count is within this many slots
// of the cap. Picked so the user gets a heads-up before adds start failing,
// not so early it becomes background noise.
const CAP_WARNING_WINDOW = 10;

export type { PickerSkill };

const bundleCopy: SkillPickerCopy = {
  added: "In bundle",
  add: (name) => `Add ${name} to bundle`,
  addDisabled: (name) =>
    `Add ${name} (bundle is at the ${MAX_BUNDLE_SKILLS}-skill maximum)`,
  remove: (name) => `Remove ${name} from bundle`,
};

export interface BundleEditSkillPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Keys already in the staged skill list (current + pending adds, minus pending removes). */
  existingKeys: Set<string>;
  onAdd: (skill: PickerSkill) => void;
  /** Toggle off — un-stages a pending add, or stages a removal of a saved-bundle skill. */
  onRemove: (source: string, skillId: string) => void;
}

export function BundleEditSkillPicker({
  open,
  onOpenChange,
  existingKeys,
  onAdd,
  onRemove,
}: BundleEditSkillPickerProps) {
  const [rawQuery, setRawQuery] = useState("");
  const [lastOpen, setLastOpen] = useState(open);

  // Reset the query whenever the sheet transitions to closed so reopening
  // starts clean. Render-time state adjustment per React docs (avoids the
  // cascading-render warning from setting state inside an effect).
  if (open !== lastOpen) {
    setLastOpen(open);
    if (!open) setRawQuery("");
  }

  const { effectiveQuery, isInputLoading } = useDebouncedCachedSearch({
    rawQuery,
    fn: api.skills.searchSkills,
  });

  // Staged count drives the cap preempt. `existingKeys` already represents
  // "current bundle + staged adds − staged removes," so its size is the
  // count we'd send to the server if the user saved right now.
  const stagedCount = existingKeys.size;
  const atCap = stagedCount >= MAX_BUNDLE_SKILLS;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Add skills</SheetTitle>
          <SheetDescription>
            Search the catalog and stage skills to add. Changes commit when you
            save the bundle.
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-3">
          <SkillSearchField
            value={rawQuery}
            onChange={setRawQuery}
            loading={isInputLoading}
          />

          {/* Cap status. Quiet below the threshold (just a count when the
              user is approaching), explicit at the cap (with the reason
              spelled out so a disabled Add button doesn't read as a bug). */}
          {stagedCount >= MAX_BUNDLE_SKILLS - CAP_WARNING_WINDOW ? (
            <p
              className={cn(
                "text-xs tabular-nums",
                atCap ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {atCap
                ? `Bundle is at the ${MAX_BUNDLE_SKILLS}-skill maximum. Remove a skill to add more.`
                : `${stagedCount} / ${MAX_BUNDLE_SKILLS} staged`}
            </p>
          ) : null}

          {effectiveQuery ? (
            <PickerSearchResults
              query={effectiveQuery}
              existingKeys={existingKeys}
              atCap={atCap}
              copy={bundleCopy}
              onAdd={onAdd}
              onRemove={onRemove}
            />
          ) : (
            <PickerPopularResults
              existingKeys={existingKeys}
              atCap={atCap}
              copy={bundleCopy}
              onAdd={onAdd}
              onRemove={onRemove}
            />
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
