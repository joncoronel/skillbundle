import { watchKey } from "../bundle-limits";

/**
 * One change-feed target per distinct skill, with baseline
 * `max(lastViewedAt, addedAt)` from the bundle it's been unread in longest.
 * Shared by the account and browser feeds so they agree on what's new.
 */
export function feedTargets<
  B extends {
    lastViewedAt?: number;
    skills: { source: string; skillId: string; addedAt?: number }[];
  },
>(
  bundles: B[],
): { source: string; skillId: string; baseline: number; bundle: B }[] {
  const byKey = new Map<
    string,
    { source: string; skillId: string; baseline: number; bundle: B }
  >();
  for (const bundle of bundles) {
    for (const s of bundle.skills) {
      const baseline = Math.max(bundle.lastViewedAt ?? 0, s.addedAt ?? 0);
      const key = watchKey(s);
      const existing = byKey.get(key);
      if (!existing || baseline < existing.baseline) {
        byKey.set(key, {
          source: s.source,
          skillId: s.skillId,
          baseline,
          bundle,
        });
      }
    }
  }
  return Array.from(byKey.values());
}
