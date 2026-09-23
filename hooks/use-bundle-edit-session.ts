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
 * Persist a staged skill list. Returns an error message when the list is
 * refused before anything was written (the staged edits stay on screen to
 * fix), or null once the save is under way.
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
  /**
   * Where the staged list goes: `useAccountBundleSave` for an account bundle,
   * the browser store for one saved signed out (lib/local-bundles.ts).
   */
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
 * The account bundle's save: `updateBundleSkills` with an optimistic update.
 *
 * Non-blocking. The optimistic update paints the new bundle into the cache
 * immediately, so the read view renders the saved state the moment edit mode
 * exits, with no server-round-trip "snap". If the server later rejects, Convex
 * rolls back and the failure surfaces as a toast. The staged edits are gone by
 * then, so the toast is the only recovery path; for a deliberate Save that
 * tradeoff is acceptable.
 */
export function useAccountBundleSave({
  bundleId,
  queryArgs,
}: {
  /**
   * Undefined while the bundle is still resolving, or when it does not exist.
   * The page calls this above its not-found return (hook order cannot change
   * between renders); the save no-ops without it, which is unreachable because
   * the edit controls do not render until the bundle does.
   */
  bundleId: Id<"bundles"> | undefined;
  /**
   * Query args (`urlId`) for `getByUrlId`, matching the cache key the bundle
   * page is reading, so the optimistic patch lands on the right entry.
   */
  queryArgs: { urlId: string };
}): SaveBundleSkills {
  const updateSkills = useMutation(api.bundles.updateBundleSkills);

  return useCallback(
    (skills) => {
      if (!bundleId) return null;
      // Built per save, so the optimistic update closes over the staged list
      // it is saving: the mutation args carry only refs, and the patch needs
      // the enriched rows.
      const pending = updateSkills.withOptimisticUpdate(
        (localStore, { bundleId: id }) => {
          // getByUrlId is the query the bundle detail page is reading, patched
          // directly with the prop-supplied queryArgs. For skills already in
          // the bundle, the staged data merges over the existing record to keep
          // server-only fields like `addedAt`; brand-new skills come straight
          // from the staged list and Convex overwrites them on emit.
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

          // listByUser carries minimal { source, skillId, addedAt } refs.
          // Patched when it happens to be cached (dashboard) so that surface
          // stays consistent, but not depended on.
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
        // ConvexError carries the original server message on `.data`. Plain
        // Errors fall through to `.message`, which in dev is wrapped with the
        // `[CONVEX M(...)]` boilerplate.
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
