"use client";

import { useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Album02Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";
import { SelectableSkillRow, type SkillData } from "@/components/skill-card";
import { toast } from "@/components/ui/cubby-ui/toast/toast";
import { useHydrated } from "@/hooks/use-hydrated";
import {
  useBundleActions,
  useSelectedSkills,
  type SelectedSkill,
} from "@/lib/bundle-selection";

function plural(n: number) {
  return n === 1 ? "" : "s";
}

/**
 * Client island for a source page's skill list. Renders the selectable rows
 * (wired to the global bundle selection, same as the home page) plus a single
 * "Add all / Remove all" control so a whole source can be bundled in one move.
 * The server component owns data fetching and the surrounding chrome; this only
 * needs the already-serializable skill summaries.
 */
export function SourceSkillList({ skills }: { skills: SkillData[] }) {
  const selected = useSelectedSkills();
  const { addMany, removeMany, replaceSelection } = useBundleActions();

  // The server (and the first client render) can't know localStorage, so the
  // selection-derived header always renders its empty state until hydration —
  // same gating the row checkboxes use, which keeps the SSR HTML matching.
  const hydrated = useHydrated();

  // How many of this source's skills are already in the selection. Drives the
  // live "X of N in your bundle" feedback and the Add-all/Remove-all label flip.
  const selectedFromSource = useMemo(() => {
    if (!hydrated) return 0;
    const sourceKeys = new Set(skills.map((s) => `${s.source}/${s.skillId}`));
    return selected.reduce(
      (n, s) => (sourceKeys.has(`${s.source}/${s.skillId}`) ? n + 1 : n),
      0,
    );
  }, [hydrated, skills, selected]);

  const total = skills.length;
  const allSelected = hydrated && total > 0 && selectedFromSource === total;

  function asSelected(): SelectedSkill[] {
    return skills.map((s) => ({
      source: s.source,
      skillId: s.skillId,
      name: s.name,
    }));
  }

  function handleAddAll() {
    const snapshot = selected;
    const { added, skippedForCap } = addMany(asSelected());
    if (added === 0 && skippedForCap === 0) return; // everything already in
    const title =
      skippedForCap > 0
        ? `Added ${added} skill${plural(added)} · ${skippedForCap} skipped (bundle full)`
        : `Added ${added} skill${plural(added)}`;
    const id = toast({
      title,
      action: {
        label: "Undo",
        onClick: () => {
          replaceSelection(snapshot);
          if (id) toast.dismiss(id);
        },
      },
    });
  }

  function handleRemoveAll() {
    const snapshot = selected;
    const removed = selectedFromSource;
    removeMany(skills.map((s) => ({ source: s.source, skillId: s.skillId })));
    const id = toast({
      title: `Removed ${removed} skill${plural(removed)}`,
      action: {
        label: "Undo",
        onClick: () => {
          replaceSelection(snapshot);
          if (id) toast.dismiss(id);
        },
      },
    });
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="text-sm text-muted-foreground tabular-nums">
          {selectedFromSource > 0
            ? `${selectedFromSource} of ${total} in your bundle`
            : `${total} skill${plural(total)} from this source`}
        </span>
        {allSelected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRemoveAll}
            leftSection={
              <HugeiconsIcon
                icon={Cancel01Icon}
                strokeWidth={2}
                className="size-3.5"
              />
            }
          >
            Remove all
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={handleAddAll}
            leftSection={
              <HugeiconsIcon
                icon={Album02Icon}
                strokeWidth={2}
                className="size-3.5"
              />
            }
          >
            Add all ({total})
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between px-4 mb-2 font-mono text-eyebrow font-medium uppercase tracking-eyebrow text-muted-foreground">
        <span>Skill</span>
        <span>Installs</span>
      </div>

      <div className="grid">
        {skills.map((skill, i) => {
          const isFirst = i === 0;
          const isLast = i === skills.length - 1;
          const isSolo = skills.length === 1;
          return (
            <SelectableSkillRow
              key={`${skill.source}/${skill.skillId}`}
              skill={skill}
              hideSource
              className={
                isSolo
                  ? undefined
                  : isFirst
                    ? "rounded-b-none"
                    : isLast
                      ? "rounded-t-none border-t-0"
                      : "rounded-none border-t-0"
              }
            />
          );
        })}
      </div>
    </>
  );
}
