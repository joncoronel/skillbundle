"use client";

import { useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Album02Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";
import {
  rowPositionClassName,
  SelectableSkillRow,
  type SkillData,
} from "@/components/skill-card";
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
 * Client island for a catalog listing's skill rows. Renders the selectable rows
 * (wired to the global bundle selection, same as the home page) plus a single
 * "Add all / Remove all" control so a whole listing can be bundled in one move.
 * The server component owns data fetching and the surrounding chrome; this only
 * needs the already-serializable skill summaries.
 *
 * Was `SourceSkillList`, and the rename is the point rather than tidying. The
 * old name carried an assumption the category pages break: that every row
 * shares one `source`. That assumption was baked in as a hardcoded
 * `hideSource` on the row, so a list of 60 skills from 60 different repos
 * rendered with no way to tell them apart — and a name saying "source" is what
 * makes that look correct to a reader. Hence `showSource` below, and hence the
 * name no longer promising something the component does not require.
 */
export function CatalogSkillList({
  skills,
  /**
   * What the selection counter calls this list, after the count: "42 skills
   * <scopeLabel>". Defaults to the source-page wording that was hardcoded here.
   */
  scopeLabel = "from this source",
  /**
   * Show each row's `owner/repo`. Off by default, because a source page already
   * says the source in its `h1` and repeating it on all 60 rows is noise. On
   * for any listing whose rows come from different repos, where it is the only
   * thing telling two same-named skills apart — the same disambiguation
   * `lib/seo.ts` makes in the page titles, for the same reason.
   */
  showSource = false,
}: {
  skills: SkillData[];
  scopeLabel?: string;
  showSource?: boolean;
}) {
  const selected = useSelectedSkills();
  const { addMany, removeMany, replaceSelection } = useBundleActions();

  // The server (and the first client render) can't know localStorage, so the
  // selection-derived header always renders its empty state until hydration —
  // same gating the row checkboxes use, which keeps the SSR HTML matching.
  const hydrated = useHydrated();

  // How many of this list's skills are already in the selection. Drives the
  // live "X of N in your bundle" feedback and the Add-all/Remove-all label flip.
  const selectedInList = useMemo(() => {
    if (!hydrated) return 0;
    const listKeys = new Set(skills.map((s) => `${s.source}/${s.skillId}`));
    return selected.reduce(
      (n, s) => (listKeys.has(`${s.source}/${s.skillId}`) ? n + 1 : n),
      0,
    );
  }, [hydrated, skills, selected]);

  const total = skills.length;
  const allSelected = hydrated && total > 0 && selectedInList === total;

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
    // Nothing was added: either everything is already in the bundle (no toast)
    // or the bundle is full (inform, but there's nothing to undo).
    if (added === 0) {
      if (skippedForCap > 0) {
        toast({
          title: `Bundle is full: couldn't add ${skippedForCap} skill${plural(skippedForCap)}`,
        });
      }
      return;
    }
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
    const removed = selectedInList;
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
          {selectedInList > 0
            ? `${selectedInList} of ${total} in your bundle`
            : `${total} skill${plural(total)} ${scopeLabel}`}
        </span>
        {allSelected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRemoveAll}
            leadingIcon={
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
            leadingIcon={
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

      <div className="mb-2 flex items-center justify-between px-4 text-xs font-medium text-muted-foreground">
        <span>Skill</span>
        <span>Installs</span>
      </div>

      <div className="grid">
        {skills.map((skill, i) => (
          <SelectableSkillRow
            key={`${skill.source}/${skill.skillId}`}
            skill={skill}
            hideSource={!showSource}
            className={rowPositionClassName(i, skills.length)}
          />
        ))}
      </div>
    </>
  );
}
