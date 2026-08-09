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

export function useBundleEditSession({
  bundleId,
  queryArgs,
  initialSkills,
  changes,
  onExit,
}: {
  /**
   * Undefined while the bundle is still resolving, or when it does not exist.
   * The hook has to run above the page's not-found early return (hook order
   * cannot change between renders), so this is genuinely optional rather than
   * a cast — `save` no-ops without it, which is unreachable in practice because
   * the edit controls do not render until the bundle does.
   */
  bundleId: Id<"bundles"> | undefined;
  /**
   * Query args (`urlId`) for `getByUrlId`, matching the cache key the bundle
   * page is reading, so the optimistic patch lands on the right entry.
   */
  queryArgs: { urlId: string };
  /**
   * The bundle's current skills. Must be in ROSTER order, not consequence
   * order: the dirty check and the saved order both derive from this array, and
   * a list that re-sorts itself when the change query lands makes an untouched
   * bundle read as dirty. Display order is `buildRegister`'s job.
   */
  initialSkills: EditableSkill[];
  changes: RegisterChange[] | undefined;
  onExit: () => void;
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

  // `.withOptimisticUpdate` is recreated every render, so the callback closes
  // over the current render's `edit.skills` — no ref or effect needed to keep
  // the enriched data fresh. By the time the user clicks Save, the latest
  // render's wrapped mutation is what fires, with the up-to-date staged list
  // bound by closure.
  const enriched = edit.skills;
  const updateSkills = useMutation(
    api.bundles.updateBundleSkills,
  ).withOptimisticUpdate((localStore, { bundleId: id }) => {
    // getByUrlId is the query the bundle detail page is reading — patch it
    // directly using the prop-supplied queryArgs. We don't fish urlId out of
    // listByUser because that query may not be subscribed. For skills already
    // in the bundle, merge the staged data over the existing detail record to
    // preserve server-only fields like `addedAt`; brand-new skills come
    // straight from the staged list and Convex overwrites with the canonical
    // enriched shape on emit.
    const detail = localStore.getQuery(api.bundles.getByUrlId, queryArgs);
    if (detail) {
      // Index prior skills by `${source}::${skillId}` once so the merge is O(n)
      // over `enriched` instead of O(n*m).
      const priorByKey = new Map(
        detail.skills.map((p) => [`${p.source}::${p.skillId}`, p]),
      );
      localStore.setQuery(api.bundles.getByUrlId, queryArgs, {
        ...detail,
        skills: enriched.map((s) => {
          const prior = priorByKey.get(`${s.source}::${s.skillId}`);
          return prior ? { ...prior, ...s } : s;
        }) as typeof detail.skills,
      });
    }

    // listByUser carries minimal { source, skillId, addedAt } refs. Patch it
    // when it happens to be cached (dashboard, popover) so those surfaces stay
    // consistent, but don't depend on it.
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
            skills: enriched.map((s) => {
              const prior = priorByKey.get(`${s.source}::${s.skillId}`);
              return {
                source: s.source,
                skillId: s.skillId,
                addedAt: prior?.addedAt,
              };
            }),
          };
        }),
      );
    }
  });

  const save = useCallback(() => {
    if (!bundleId) return;
    // Non-blocking save. The optimistic update paints the new bundle into the
    // cache immediately, so the read view renders the saved state the moment we
    // exit edit mode — no server-round-trip "snap". If the server later rejects,
    // Convex auto-rolls back and we surface the failure via toast. The staged
    // in-memory edits are gone by then, so the toast is the only recovery path;
    // for a deliberate Save action that tradeoff is acceptable.
    const pending = updateSkills({
      bundleId,
      skills: edit.skills.map((s) => ({
        source: s.source,
        skillId: s.skillId,
      })),
    });
    edit.reset();
    onExit();
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
  }, [bundleId, edit, onExit, updateSkills]);

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
