import { watchKey } from "../bundle-limits";

/**
 * One change-feed target per distinct skill across `bundles`, which is what a
 * dashboard feed checks. A skill's baseline is `max(lastViewedAt, addedAt)`,
 * and a skill in two bundles is reported against the one it has been unread
 * in longest.
 *
 * The one copy of that rule, shared by the account feed
 * (`listRecentChangesForUser`, over bundle rows) and the browser feed
 * (`localFeedTargets`, over bundles in localStorage), so the two dashboards
 * can't disagree about what counts as new.
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
