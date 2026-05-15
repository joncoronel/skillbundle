"use client";

import { useCallback, useMemo, useState } from "react";

export interface EditSkill {
  source: string;
  skillId: string;
  name?: string;
}

function skillKey(s: { source: string; skillId: string }) {
  return `${s.source}::${s.skillId}`;
}

function contentEqual<T extends EditSkill>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (skillKey(a[i]) !== skillKey(b[i])) return false;
  }
  return true;
}

export type EditStatus = "kept" | "added" | "removed";

export interface EditDisplayItem<T> {
  skill: T;
  status: EditStatus;
}

export interface UseBundleEditResult<T extends EditSkill> {
  /** Current staged list (what will be saved). Preserves order. */
  skills: T[];
  /** Key set of every skill currently staged in the bundle. */
  stagedKeys: Set<string>;
  /**
   * Diff-aware list used for rendering the edit UI. Walks the initial bundle
   * in its original order, marking each entry as `kept` or `removed`, then
   * appends any newly added (staged-but-not-initial) skills as `added`.
   */
  displayItems: EditDisplayItem<T>[];
  /** True when the user has made staged changes that differ from the current `initial`. */
  dirty: boolean;
  /** Count of skills currently staged that weren't in the initial bundle. */
  addedCount: number;
  /** Count of skills from the initial bundle that have been removed. */
  removedCount: number;
  addSkill: (skill: T) => void;
  removeSkill: (source: string, skillId: string) => void;
  /**
   * Drop back to "mirror mode" so subsequent external changes to `initial`
   * (e.g. a Convex re-emission after save) flow straight through to
   * `skills` without an explicit sync. Used by both discard-cancel and
   * post-save cleanup.
   */
  reset: () => void;
}

/**
 * Manages staged skill edits for a bundle. The hook deliberately does NOT
 * copy `initial` into local state — instead it tracks only the user's
 * staged override:
 *
 *   stagedOverride === null  → mirror mode (skills = current `initial`)
 *   stagedOverride === T[]   → user has staged a specific list
 *
 * This means external updates to `initial` (e.g. via Convex reactive query
 * after another path mutates the bundle) flow through automatically as
 * long as the user hasn't started editing. No duplicate state to keep in
 * sync, no useEffect, no manual reset on save — `reset()` just drops the
 * override and the next-rendered `initial` becomes the new baseline.
 */
export function useBundleEdit<T extends EditSkill>(
  initial: T[],
): UseBundleEditResult<T> {
  const [stagedOverride, setStagedOverride] = useState<T[] | null>(null);

  const skills = stagedOverride ?? initial;

  const initialKeys = useMemo(
    () => new Set(initial.map(skillKey)),
    [initial],
  );

  const stagedKeys = useMemo(() => new Set(skills.map(skillKey)), [skills]);

  const addedCount = useMemo(
    () => skills.filter((s) => !initialKeys.has(skillKey(s))).length,
    [skills, initialKeys],
  );

  const removedCount = useMemo(
    () => initial.filter((s) => !stagedKeys.has(skillKey(s))).length,
    [initial, stagedKeys],
  );

  const dirty = useMemo(() => {
    if (stagedOverride === null) return false;
    return !contentEqual(stagedOverride, initial);
  }, [stagedOverride, initial]);

  // Note: `addSkill` and `removeSkill` keep `initial` in their useCallback
  // deps, so their function identities change every time the source
  // bundle re-emits (which Convex does with a fresh array reference even
  // when content is unchanged). This is fine for current consumers — both
  // are passed to children wrapped in inline arrow functions, so the
  // identity never reaches a memoization boundary. If you ever pass
  // either *directly* to a `React.memo`'d component as a prop, swap to
  // a ref + sync pattern (or accept the unnecessary re-renders).
  const addSkill = useCallback(
    (skill: T) => {
      setStagedOverride((prev) => {
        const base = prev ?? initial;
        const key = skillKey(skill);
        if (base.some((p) => skillKey(p) === key)) return base;
        return [...base, skill];
      });
    },
    [initial],
  );

  const removeSkill = useCallback(
    (source: string, skillId: string) => {
      setStagedOverride((prev) => {
        const base = prev ?? initial;
        const key = skillKey({ source, skillId });
        return base.filter((p) => skillKey(p) !== key);
      });
    },
    [initial],
  );

  const reset = useCallback(() => {
    setStagedOverride(null);
  }, []);

  // Diff-aware display list: walk the current initial bundle in its
  // original order (mark each entry kept or removed), then append any
  // newly added skills. Preserves the spatial layout the user expects.
  const displayItems = useMemo<EditDisplayItem<T>[]>(() => {
    const items: EditDisplayItem<T>[] = [];
    const stagedByKey = new Map(skills.map((s) => [skillKey(s), s]));

    for (const initialSkill of initial) {
      const staged = stagedByKey.get(skillKey(initialSkill));
      if (staged) {
        items.push({ skill: staged, status: "kept" });
      } else {
        items.push({ skill: initialSkill, status: "removed" });
      }
    }

    for (const stagedSkill of skills) {
      if (!initialKeys.has(skillKey(stagedSkill))) {
        items.push({ skill: stagedSkill, status: "added" });
      }
    }

    return items;
  }, [initial, skills, initialKeys]);

  return {
    skills,
    stagedKeys,
    displayItems,
    dirty,
    addedCount,
    removedCount,
    addSkill,
    removeSkill,
    reset,
  };
}
