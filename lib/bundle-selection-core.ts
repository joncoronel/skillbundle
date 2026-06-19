/**
 * Pure, dependency-light core of the bundle selection model. Kept apart from
 * the jotai/React store (bundle-selection.ts) so the cap/dedup rule can be
 * unit-tested without a store or a DOM. bundle-selection.ts re-exports
 * `SelectedSkill`, so existing importers of "@/lib/bundle-selection" are
 * unaffected.
 */
import { MAX_BUNDLE_SKILLS } from "./bundle-limits";

export interface SelectedSkill {
  source: string;
  skillId: string;
  name: string;
}

/** Stable identity for a skill within a selection. */
export function selectionKey(source: string, skillId: string): string {
  return `${source}/${skillId}`;
}

export interface BulkAddPlan {
  /** Skills to append, in input order, after dedup + cap clamp. */
  additions: SelectedSkill[];
  /** = additions.length; the number actually added. */
  added: number;
  /** Incoming skills skipped because they were already selected. */
  alreadyPresent: number;
  /** Incoming skills skipped because the cap was reached. */
  skippedForCap: number;
}

/**
 * Plan a bulk add: given the current selection and an incoming list, decide
 * which skills to append. Dedupes within `incoming` and against `current`, then
 * clamps the total to `cap`. Pure — no atom, no storage — so callers can apply
 * `additions` in a single write and surface the counts in a toast.
 */
export function planBulkAdd(
  current: SelectedSkill[],
  incoming: SelectedSkill[],
  cap: number = MAX_BUNDLE_SKILLS,
): BulkAddPlan {
  const seen = new Set(current.map((s) => selectionKey(s.source, s.skillId)));
  const additions: SelectedSkill[] = [];
  let alreadyPresent = 0;
  let skippedForCap = 0;
  for (const skill of incoming) {
    const k = selectionKey(skill.source, skill.skillId);
    if (seen.has(k)) {
      alreadyPresent++;
      continue;
    }
    if (current.length + additions.length >= cap) {
      skippedForCap++;
      continue;
    }
    seen.add(k);
    additions.push(skill);
  }
  return {
    additions,
    added: additions.length,
    alreadyPresent,
    skippedForCap,
  };
}
