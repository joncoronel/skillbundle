/**
 * Pure rules for bundles saved in the browser while signed out, apart from the
 * jotai store (local-bundles.ts) so they test without a DOM. They live in
 * localStorage until sign-in moves them to the account, under the free plan's
 * limits so signing up never takes anything away.
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
  /** Stored so the dashboard can list it without a catalog read. */
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
 * Why saving `incoming` (as `ignoreId`'s new contents, or a new bundle) would
 * be refused, or null. Counts the union, like the server's `assertWatchLimit`.
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
 * The new skill list, deduped, keeping `addedAt` for skills already held and
 * stamping `now` on new ones, like the server's `updateBundleSkills`.
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

/** Arguments for `listRecentChangesForSkills`. */
export function localFeedTargets(bundles: LocalBundle[]) {
  return feedTargets(bundles).map(({ bundle, ...target }) => ({
    ...target,
    bundleName: bundle.name,
  }));
}

/** A search param on a static route: there's nothing to prerender per id. */
export function localBundleHref(id: string): string {
  return `/bundle/local?id=${encodeURIComponent(id)}`;
}
