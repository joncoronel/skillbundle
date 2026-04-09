"use client";

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";

export interface SelectedSkill {
  source: string;
  skillId: string;
  name: string;
}

type Action =
  | { type: "TOGGLE"; payload: SelectedSkill }
  | { type: "REMOVE"; payload: { source: string; skillId: string } }
  | { type: "CLEAR" };

function key(source: string, skillId: string) {
  return `${source}/${skillId}`;
}

function reducer(state: SelectedSkill[], action: Action): SelectedSkill[] {
  switch (action.type) {
    case "TOGGLE": {
      const k = key(action.payload.source, action.payload.skillId);
      const exists = state.some(
        (s) => key(s.source, s.skillId) === k,
      );
      if (exists) {
        return state.filter((s) => key(s.source, s.skillId) !== k);
      }
      return [...state, action.payload];
    }
    case "REMOVE":
      return state.filter(
        (s) =>
          key(s.source, s.skillId) !==
          key(action.payload.source, action.payload.skillId),
      );
    case "CLEAR":
      return [];
  }
}

interface BundleSelectionContextValue {
  selectedSkills: SelectedSkill[];
  toggleSkill: (skill: SelectedSkill) => void;
  removeSkill: (source: string, skillId: string) => void;
  clearAll: () => void;
  isSelected: (source: string, skillId: string) => boolean;
  count: number;
}

const BundleSelectionContext =
  createContext<BundleSelectionContextValue | null>(null);

export function BundleSelectionProvider({ children }: { children: ReactNode }) {
  const [selectedSkills, dispatch] = useReducer(reducer, []);

  const toggleSkill = useCallback(
    (skill: SelectedSkill) => dispatch({ type: "TOGGLE", payload: skill }),
    [],
  );

  const removeSkill = useCallback(
    (source: string, skillId: string) =>
      dispatch({ type: "REMOVE", payload: { source, skillId } }),
    [],
  );

  const clearAll = useCallback(() => dispatch({ type: "CLEAR" }), []);

  const selectedKeys = useMemo(
    () => new Set(selectedSkills.map((s) => key(s.source, s.skillId))),
    [selectedSkills],
  );

  const isSelected = useCallback(
    (source: string, skillId: string) => selectedKeys.has(key(source, skillId)),
    [selectedKeys],
  );

  const value = useMemo(
    () => ({
      selectedSkills,
      toggleSkill,
      removeSkill,
      clearAll,
      isSelected,
      count: selectedSkills.length,
    }),
    [selectedSkills, toggleSkill, removeSkill, clearAll, isSelected],
  );

  return (
    <BundleSelectionContext.Provider value={value}>
      {children}
    </BundleSelectionContext.Provider>
  );
}

export function useBundleSelection() {
  return useContext(BundleSelectionContext);
}

export function useBundleSelectionRequired() {
  const ctx = useContext(BundleSelectionContext);
  if (!ctx) {
    throw new Error(
      "useBundleSelectionRequired must be used within BundleSelectionProvider",
    );
  }
  return ctx;
}
