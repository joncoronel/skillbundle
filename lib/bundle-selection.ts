"use client";

import { useMemo } from "react";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage, selectAtom } from "jotai/utils";

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
  "skillstack:selection",
  [],
  undefined,
  { getOnInit: false },
);

const toggleSkillAtom = atom(null, (get, set, skill: SelectedSkill) => {
  const current = get(selectedSkillsAtom);
  const k = key(skill.source, skill.skillId);
  const exists = current.some((s) => key(s.source, s.skillId) === k);
  set(
    selectedSkillsAtom,
    exists
      ? current.filter((s) => key(s.source, s.skillId) !== k)
      : [...current, skill],
  );
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
  return useAtomValue(isSelectedAtom);
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
