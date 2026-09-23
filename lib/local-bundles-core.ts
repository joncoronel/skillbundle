/**
 * Pure core of bundles saved in the browser while signed out. Kept apart from
 * the jotai store (local-bundles.ts) so the limit and merge rules can be
 * unit-tested without a store or a DOM, the same split as
 * bundle-selection-core.ts.
 *
 * These bundles never touch the database. They live in localStorage until the
 * browser signs in, when `importLocalBundles` moves them into the account. The
 * limits below mirror what an account on the free plan gets, so signing up
 * never takes anything away.
 */
import {
  FREE_WATCHED_SKILLS,
  MAX_BUNDLE_SKILLS,
  MAX_LOCAL_BUNDLES,
  watchKey,
} from "./bundle-limits";
import { feedTargets } from "./monitoring/feed-targets";

export interface LocalBundleSkill {
  source: string;
  skillId: string;
  /** Stored so the dashboard can list a bundle without a catalog read. */
  name: string;
  /** When the skill joined this bundle: its change-tracking baseline. */
  addedAt: number;
}

export interface LocalBundle {
  id: string;
  name: string;
  description?: string;
  skills: LocalBundleSkill[];
  createdAt: number;
  updatedAt: number;
  /** Same role as the account row's: the dashboard's "unread since". */
  lastViewedAt?: number;
}

/** Distinct watched skills across `bundles`, optionally ignoring one. */
export function localWatchedKeys(
  bundles: LocalBundle[],
  ignoreId?: string,
): Set<string> {
  const keys = new Set<string>();
  for (const b of bundles) {
    if (b.id === ignoreId) continue;
    for (const s of b.skills) keys.add(watchKey(s));
  }
  return keys;
}

/**
 * Why saving `incoming` (as bundle `ignoreId`'s new contents, or as a new
 * bundle) would be refused, or null when it fits. Counts the UNION, like the
 * server's `assertWatchLimit`: filing a skill you already watch in a second
 * bundle is free.
 */
export function localSaveRefusal(
  bundles: LocalBundle[],
  incoming: { source: string; skillId: string }[],
  ignoreId?: string,
): string | null {
  if (ignoreId === undefined && bundles.length >= MAX_LOCAL_BUNDLES) {
    return `This browser holds up to ${MAX_LOCAL_BUNDLES} bundles. Delete one, or sign in to keep more.`;
  }
  if (incoming.length > MAX_BUNDLE_SKILLS) {
    return `Bundles are limited to ${MAX_BUNDLE_SKILLS} skills.`;
  }
  const union = localWatchedKeys(bundles, ignoreId);
  for (const s of incoming) union.add(watchKey(s));
  if (union.size > FREE_WATCHED_SKILLS) {
    return `That would put you at ${union.size} watched skills; the free plan covers ${FREE_WATCHED_SKILLS}.`;
  }
  return null;
}

/**
 * The bundle's new skill list: deduped, in the given order, keeping `addedAt`
 * for skills it already held and stamping `now` on new ones. Same rule as the
 * server's `updateBundleSkills`, so a skill's change history does not restart
 * because the bundle was edited.
 */
export function mergeSkills(
  prior: LocalBundleSkill[],
  next: { source: string; skillId: string; name: string }[],
  now: number,
): LocalBundleSkill[] {
  const priorByKey = new Map(prior.map((s) => [watchKey(s), s]));
  const seen = new Set<string>();
  const out: LocalBundleSkill[] = [];
  for (const s of next) {
    const key = watchKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source: s.source,
      skillId: s.skillId,
      name: s.name,
      addedAt: priorByKey.get(key)?.addedAt ?? now,
    });
  }
  return out;
}

/**
 * The arguments for `listRecentChangesForSkills`: the shared `feedTargets`,
 * with the bundle reduced to the name the feed rows show.
 */
export function localFeedTargets(bundles: LocalBundle[]) {
  return feedTargets(bundles).map(({ bundle, ...target }) => ({
    ...target,
    bundleName: bundle.name,
  }));
}

/**
 * Where a browser bundle opens. A search param on a static route rather than a
 * `[id]` segment, because the page renders entirely in the browser and there
 * is nothing for a server to prerender per id (same shape as `/compare`).
 */
export function localBundleHref(id: string): string {
  return `/bundle/local?id=${encodeURIComponent(id)}`;
}
