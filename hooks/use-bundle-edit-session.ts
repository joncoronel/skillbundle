"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "@/components/ui/cubby-ui/toast/toast";
import { type SkillData } from "@/components/skill-card";
import {
  buildRegister,
  type RegisterChange,
  type RegisterSkill,
  type RegisterStatus,
} from "@/components/bundle/bundle-register";
import { useBundleEdit } from "@/hooks/use-bundle-edit";

export type EditableSkill = SkillData & RegisterSkill;

/**
 * Everything edit mode needs, owned ONE LEVEL UP from the controls that use it.
 *
 * ## Why this hook exists
 *
 * "Edit is a mode of the register, not a second component" was the stated
 * design, but at the React level it was not true: the read view rendered one
 * `<BundleRegister>` and the edit component rendered another, in a different
 * position in the tree. Toggling edit mode unmounted one and mounted the other,
 * so everything instance-local reset — the reader's fold state (open Steady,
 * edit, save, Steady is folded again) and the scroll offset inside the
 * register's own `max-h-[70vh]` container, which on a long bundle returns you
 * to the top after every round-trip.
 *
 * Fixing that means the page renders exactly one register and passes it either
 * the read rows or the staged rows. Which in turn means the staging state has
 * to live at the page, not inside the edit component — hence this hook.
 *
 * ## What stays behind
 *
 * The edit CHROME (skill picker, bottom bar, discard dialog) still lives in its
 * own component. It has to stay mounted while `editing` is false so the bar can
 * run its exit transition instead of being yanked out of the DOM.
 */
export interface BundleEditSession {
  /** Rows and sections to render while editing, already carrying staged status. */
  rows: ReturnType<typeof buildRegister<EditableSkill>>;
  /** Row handlers. Passing these to the register is what puts it in edit mode. */
  actions: {
    onRemove: (skill: EditableSkill) => void;
    onRestore: (skill: EditableSkill) => void;
  };
  stagedKeys: Set<string>;
  skillCount: number;
  addedCount: number;
  removedCount: number;
  dirty: boolean;
  addSkill: (skill: EditableSkill) => void;
  removeSkill: (source: string, skillId: string) => void;
  save: () => void;
  discard: () => void;
}

/**
 * Persist a staged skill list: an error message if refused up front (the
 * staged edits stay on screen), or null once the save is under way.
 */
export type SaveBundleSkills = (skills: EditableSkill[]) => string | null;

export function useBundleEditSession({
  initialSkills,
  changes,
  onExit,
  save: persist,
}: {
  /**
   * The bundle's current skills. Must be in ROSTER order, not consequence
   * order: the dirty check and the saved order both derive from this array, and
   * a list that re-sorts itself when the change query lands makes an untouched
   * bundle read as dirty. Display order is `buildRegister`'s job.
   */
  initialSkills: EditableSkill[];
  changes: RegisterChange[] | undefined;
  onExit: () => void;
  /** `useAccountBundleSave`, or the browser store for a local bundle. */
  save: SaveBundleSkills;
}): BundleEditSession {
  const edit = useBundleEdit<EditableSkill>(initialSkills);

  // The staged list changes as you edit, so the ordering is recomputed against
  // it. `buildRegister` is the same function the read view uses, so a skill
  // cannot sort differently in the two modes — and staged status goes IN rather
  // than being re-attached to the output and regrouped afterwards.
  const rows = useMemo(() => {
    // `displayItems` reports three states; only two are staging. "kept" must
    // become undefined, not be cast away — an earlier version asserted the
    // narrower type and left the string in place, so every unchanged row hit
    // the chip's truthiness check and rendered as "Adding".
    const statusByKey = new Map<string, RegisterStatus>();
    for (const d of edit.displayItems) {
      if (d.status === "added" || d.status === "removed") {
        statusByKey.set(`${d.skill.source}::${d.skill.skillId}`, d.status);
      }
    }
    return buildRegister(
      edit.displayItems.map((d) => d.skill),
      changes,
      statusByKey,
    );
  }, [edit.displayItems, changes]);

  const save = useCallback(() => {
    const error = persist(edit.skills);
    if (error) {
      toast.error({ title: "Couldn't save changes", description: error });
      return;
    }
    edit.reset();
    onExit();
  }, [edit, onExit, persist]);

  const discard = useCallback(() => {
    edit.reset();
    onExit();
  }, [edit, onExit]);

  const { addSkill, removeSkill } = edit;
  const actions = useMemo(
    () => ({
      onRemove: (skill: EditableSkill) =>
        removeSkill(skill.source, skill.skillId),
      onRestore: (skill: EditableSkill) => addSkill(skill),
    }),
    [addSkill, removeSkill],
  );

  return {
    rows,
    actions,
    stagedKeys: edit.stagedKeys,
    skillCount: edit.skills.length,
    addedCount: edit.addedCount,
    removedCount: edit.removedCount,
    dirty: edit.dirty,
    addSkill,
    removeSkill,
    save,
    discard,
  };
}

/** Local UI state for the edit chrome, kept out of the session hook. */
export function useEditChromeState() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  return { pickerOpen, setPickerOpen, cancelOpen, setCancelOpen };
}

/**
 * The account bundle's save: `updateBundleSkills` with an optimistic update,
 * so edit mode exits straight into the saved state. A later rejection rolls
 * back and shows a toast.
 */
export function useAccountBundleSave({
  bundleId,
  queryArgs,
}: {
  /** Undefined until the bundle resolves; the save no-ops without it. */
  bundleId: Id<"bundles"> | undefined;
  /** The `getByUrlId` args the page reads, so the patch hits that entry. */
  queryArgs: { urlId: string };
}): SaveBundleSkills {
  const updateSkills = useMutation(api.bundles.updateBundleSkills);

  return useCallback(
    (skills) => {
      if (!bundleId) return null;
      // Built per save: the patch needs the enriched rows, the args only refs.
      const pending = updateSkills.withOptimisticUpdate(
        (localStore, { bundleId: id }) => {
          // Merge over existing rows to keep server-only fields like
          // `addedAt`; new skills come from the staged list until Convex emits.
          const detail = localStore.getQuery(api.bundles.getByUrlId, queryArgs);
          if (detail) {
            const priorByKey = new Map(
              detail.skills.map((p) => [`${p.source}::${p.skillId}`, p]),
            );
            localStore.setQuery(api.bundles.getByUrlId, queryArgs, {
              ...detail,
              skills: skills.map((s) => {
                const prior = priorByKey.get(`${s.source}::${s.skillId}`);
                return prior ? { ...prior, ...s } : s;
              }) as typeof detail.skills,
            });
          }

          // Patched only if cached (the dashboard reads it).
          const list = localStore.getQuery(api.bundles.listByUser, {});
          if (list) {
            localStore.setQuery(
              api.bundles.listByUser,
              {},
              list.map((b) => {
                if (b._id !== id) return b;
                const priorByKey = new Map(
                  b.skills.map((p) => [`${p.source}::${p.skillId}`, p]),
                );
                return {
                  ...b,
                  skills: skills.map((s) => ({
                    source: s.source,
                    skillId: s.skillId,
                    addedAt: priorByKey.get(`${s.source}::${s.skillId}`)
                      ?.addedAt,
                  })),
                };
              }),
            );
          }
        },
      )({
        bundleId,
        skills: skills.map((s) => ({ source: s.source, skillId: s.skillId })),
      });
      pending.catch((error: unknown) => {
        let message = "Couldn't reach the server. Try again.";
        if (error instanceof ConvexError && typeof error.data === "string") {
          message = error.data;
        } else if (error instanceof Error) {
          message = error.message;
        }
        toast.error({ title: "Couldn't save changes", description: message });
      });
      return null;
    },
    [bundleId, queryArgs, updateSkills],
  );
}
