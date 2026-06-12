"use client";

import { useMemo } from "react";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage, selectAtom } from "jotai/utils";
import { useHydrated } from "@/hooks/use-hydrated";
import { MAX_BUNDLE_SKILLS } from "@/lib/bundle-limits";

export interface SelectedSkill {
  source: string;
  skillId: string;
  name: string;
}

function key(source: string, skillId: string) {
  return `${source}/${skillId}`;
}

// getOnInit: false keeps SSR stable — the initial render returns [], then the
// stored value pops in once the atom is subscribed on the client. That matches
// the behavior of the old useEffect-based hydration.
const selectedSkillsAtom = atomWithStorage<SelectedSkill[]>(
  "skillbundle:selection",
  [],
  undefined,
  { getOnInit: false },
);

// Defense-in-depth: even if a caller bypasses the UI disable, the toggle
// refuses to push the selection past the bundle-skill cap. Removes always
// succeed (they free capacity, never violate the cap).
const toggleSkillAtom = atom(null, (get, set, skill: SelectedSkill) => {
  const current = get(selectedSkillsAtom);
  const k = key(skill.source, skill.skillId);
  const exists = current.some((s) => key(s.source, s.skillId) === k);
  if (exists) {
    set(
      selectedSkillsAtom,
      current.filter((s) => key(s.source, s.skillId) !== k),
    );
    return;
  }
  if (current.length >= MAX_BUNDLE_SKILLS) return;
  set(selectedSkillsAtom, [...current, skill]);
});

const removeSkillAtom = atom(
  null,
  (get, set, args: { source: string; skillId: string }) => {
    const targetKey = key(args.source, args.skillId);
    set(
      selectedSkillsAtom,
      get(selectedSkillsAtom).filter(
        (s) => key(s.source, s.skillId) !== targetKey,
      ),
    );
  },
);

const clearAllAtom = atom(null, (_get, set) => {
  set(selectedSkillsAtom, []);
});

// Subscribes only to a single skill's membership. selectAtom's default
// Object.is equality means this re-renders only when this specific skill's
// selection flips, not on every change to the selection array.
export function useIsSkillSelected(source: string, skillId: string) {
  const isSelectedAtom = useMemo(
    () =>
      selectAtom(selectedSkillsAtom, (skills) => {
        const k = key(source, skillId);
        return skills.some((s) => key(s.source, s.skillId) === k);
      }),
    [source, skillId],
  );
  const isSelected = useAtomValue(isSelectedAtom);
  // Report unselected during the hydration render no matter what the atom
  // holds: the server HTML can't know localStorage, and a subscriber outside
  // the page's Suspense island (the layout-mounted BundleBar) can load the
  // stored value before the skill rows hydrate — rendering it then would
  // mismatch the server HTML and force a full client re-render.
  return useHydrated() && isSelected;
}

// Write-only handles. useSetAtom never triggers a re-render on atom changes,
// so components that only dispatch (never read the list) stay cheap.
export function useBundleActions() {
  const toggleSkill = useSetAtom(toggleSkillAtom);
  const removeSkillRaw = useSetAtom(removeSkillAtom);
  const clearAll = useSetAtom(clearAllAtom);
  return useMemo(
    () => ({
      toggleSkill,
      removeSkill: (source: string, skillId: string) =>
        removeSkillRaw({ source, skillId }),
      clearAll,
    }),
    [toggleSkill, removeSkillRaw, clearAll],
  );
}

// Full-list subscription — for components that actually render every item
// (BundleBar, SaveBundleDialog).
export function useSelectedSkills() {
  return useAtomValue(selectedSkillsAtom);
}

// Granular cap subscription. Returns a stable boolean: re-renders fire only
// when the count crosses the cap, not on every selection change. Skill cards
// use this to disable their selection affordance when the user is at the
// per-bundle limit.
const isSelectionAtCapAtom = selectAtom(
  selectedSkillsAtom,
  (skills) => skills.length >= MAX_BUNDLE_SKILLS,
);

export function useIsSelectionAtCap() {
  const atCap = useAtomValue(isSelectionAtCapAtom);
  // Same hydration gating as useIsSkillSelected — the server always renders
  // the not-at-cap affordances.
  return useHydrated() && atCap;
}
