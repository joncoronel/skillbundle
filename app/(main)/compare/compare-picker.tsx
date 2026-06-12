"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/cubby-ui/button";
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
  skillKey,
  type PickerSkill,
  type SkillPickerCopy,
} from "@/components/skill-picker";
import { useDebouncedCachedSearch } from "@/hooks/use-debounced-cached-search";
import { MAX_COMPARE_SKILLS, type SkillRef } from "@/lib/compare";

const compareCopy: SkillPickerCopy = {
  added: "In comparison",
  add: (name) => `Add ${name} to the comparison`,
  addDisabled: (name) =>
    `Add ${name} (comparison is at the ${MAX_COMPARE_SKILLS}-skill maximum)`,
  remove: (name) => `Remove ${name} from the comparison`,
};

/** The slim add-column strip at the grid's edge. */
export function ComparePickerRailTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Add a skill to the comparison"
      className="flex min-h-48 w-16 shrink-0 snap-center items-center justify-center self-stretch rounded-xl border border-dashed text-muted-foreground transition-colors hover:border-solid hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring/50 focus-visible:outline-offset-2 md:w-auto"
    >
      <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-5" />
    </button>
  );
}

/** Regular button for the no-skills empty state. */
export function ComparePickerEmptyTrigger({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <Button
      variant="primary"
      onClick={onClick}
      leftSection={
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-4" />
      }
    >
      Add skills
    </Button>
  );
}

/**
 * Controlled sheet for editing which skills the page compares. Mounted once
 * at the page level — above the empty-state/grid branch — so it survives the
 * transition when the first column appears. Adds and removes are shallow
 * URL-state updates handled by the parent (no navigation), so the sheet stays
 * open for picking several skills in a row while the columns update behind it.
 */
export function ComparePickerSheet({
  open,
  onOpenChange,
  refs,
  onAdd,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refs: SkillRef[];
  onAdd: (skill: PickerSkill) => void;
  onRemove: (source: string, skillId: string) => void;
}) {
  const [rawQuery, setRawQuery] = useState("");

  const { effectiveQuery, isInputLoading } = useDebouncedCachedSearch({
    rawQuery,
    fn: api.skills.searchSkills,
  });

  const existingKeys = new Set(refs.map((r) => skillKey(r.source, r.skillId)));
  const atCap = refs.length >= MAX_COMPARE_SKILLS;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Compare skills</SheetTitle>
          <SheetDescription>
            Search the catalog and pick up to {MAX_COMPARE_SKILLS} skills to
            compare side by side.
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-3">
          <SkillSearchField
            value={rawQuery}
            onChange={setRawQuery}
            loading={isInputLoading}
          />

          <p className="text-xs tabular-nums text-muted-foreground">
            {refs.length} / {MAX_COMPARE_SKILLS} in comparison
          </p>

          {effectiveQuery ? (
            <PickerSearchResults
              query={effectiveQuery}
              existingKeys={existingKeys}
              atCap={atCap}
              copy={compareCopy}
              onAdd={onAdd}
              onRemove={onRemove}
            />
          ) : (
            <PickerPopularResults
              existingKeys={existingKeys}
              atCap={atCap}
              copy={compareCopy}
              onAdd={onAdd}
              onRemove={onRemove}
            />
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
