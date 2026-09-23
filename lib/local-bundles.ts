"use client";

import { useMemo } from "react";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useHydrated } from "@/hooks/use-hydrated";
import {
  localSaveRefusal,
  mergeSkills,
  type LocalBundle,
} from "@/lib/local-bundles-core";

export type { LocalBundle, LocalBundleSkill } from "@/lib/local-bundles-core";

/**
 * Bundles saved in this browser while signed out. See local-bundles-core.ts.
 *
 * The storage key is also read directly by LocalBundleImporter, inside a Web
 * Lock, so two tabs signing in at once can't both import the same bundles.
 */
export const LOCAL_BUNDLES_KEY = "skillbundle:bundles";

// getOnInit: true, unlike the selection atom. Reads are gated on useHydrated()
// instead (see useLocalBundles), so the hydration render still matches the
// server. What getOnInit buys is that a client-side navigation into the
// dashboard reads the stored list on its first render, rather than rendering
// an empty list for a frame and flashing the empty state.
//
// The default storage also subscribes to the `storage` event, so a bundle
// saved in one tab shows up in another.
const localBundlesAtom = atomWithStorage<LocalBundle[]>(
  LOCAL_BUNDLES_KEY,
  [],
  undefined,
  { getOnInit: true },
);

/**
 * The bundles saved in this browser, or undefined during SSR and the hydration
 * render, where the server can't know them. Treat undefined as loading.
 */
export function useLocalBundles(): LocalBundle[] | undefined {
  const bundles = useAtomValue(localBundlesAtom);
  return useHydrated() ? bundles : undefined;
}

/**
 * Set by LocalBundleImporter once this session's import attempt has finished
 * (moved, partly moved, or failed). In memory only: every page load signs in
 * afresh as far as the importer is concerned.
 */
export const importSettledAtom = atom(false);

/**
 * Bundles this tab removed (Delete, or the sign-in import). A bundle page
 * keeps showing one of these while it navigates away; one that disappears
 * without being in here was deleted from another tab, and the page says so.
 */
const removedHereAtom = atom<ReadonlySet<string>>(new Set<string>());

export function useRemovedHere(id: string | null): boolean {
  const removed = useAtomValue(removedHereAtom);
  return id !== null && removed.has(id);
}

type SaveResult = { ok: true; id: string } | { ok: false; error: string };

type SkillInput = { source: string; skillId: string; name: string };

const createAtom = atom(
  null,
  (
    get,
    set,
    args: { name: string; description?: string; skills: SkillInput[] },
  ): SaveResult => {
    const bundles = get(localBundlesAtom);
    const error = localSaveRefusal(bundles, args.skills);
    if (error) return { ok: false, error };
    const now = Date.now();
    const bundle: LocalBundle = {
      id: crypto.randomUUID(),
      name: args.name,
      description: args.description,
      skills: mergeSkills([], args.skills, now),
      createdAt: now,
      updatedAt: now,
    };
    set(localBundlesAtom, [...bundles, bundle]);
    return { ok: true, id: bundle.id };
  },
);

const updateAtom = atom(
  null,
  (
    get,
    set,
    args: {
      id: string;
      patch: (bundle: LocalBundle, now: number) => Partial<LocalBundle>;
    },
  ) => {
    const now = Date.now();
    set(
      localBundlesAtom,
      get(localBundlesAtom).map((b) =>
        b.id === args.id ? { ...b, ...args.patch(b, now) } : b,
      ),
    );
  },
);

const setSkillsAtom = atom(
  null,
  (get, set, args: { id: string; skills: SkillInput[] }): SaveResult => {
    const bundles = get(localBundlesAtom);
    const error = localSaveRefusal(bundles, args.skills, args.id);
    if (error) return { ok: false, error };
    set(updateAtom, {
      id: args.id,
      patch: (b, now) => ({
        skills: mergeSkills(b.skills, args.skills, now),
        updatedAt: now,
      }),
    });
    return { ok: true, id: args.id };
  },
);

const removeManyAtom = atom(null, (get, set, ids: string[]) => {
  const drop = new Set(ids);
  set(removedHereAtom, new Set([...get(removedHereAtom), ...ids]));
  set(
    localBundlesAtom,
    get(localBundlesAtom).filter((b) => !drop.has(b.id)),
  );
});

const markAllViewedAtom = atom(null, (get, set) => {
  const now = Date.now();
  set(
    localBundlesAtom,
    get(localBundlesAtom).map((b) => ({ ...b, lastViewedAt: now })),
  );
});

/** Write-only handles; components that only dispatch don't re-render. */
export function useLocalBundleActions() {
  const create = useSetAtom(createAtom);
  const update = useSetAtom(updateAtom);
  const setSkills = useSetAtom(setSkillsAtom);
  const removeMany = useSetAtom(removeManyAtom);
  const markAllViewed = useSetAtom(markAllViewedAtom);
  return useMemo(
    () => ({
      create,
      setSkills,
      removeMany,
      markAllViewed,
      remove: (id: string) => removeMany([id]),
      rename: (id: string, name: string) =>
        update({ id, patch: (_, now) => ({ name, updatedAt: now }) }),
      setDescription: (id: string, description: string | undefined) =>
        update({ id, patch: (_, now) => ({ description, updatedAt: now }) }),
      markViewed: (id: string) =>
        update({ id, patch: (_, now) => ({ lastViewedAt: now }) }),
    }),
    [create, update, setSkills, removeMany, markAllViewed],
  );
}
