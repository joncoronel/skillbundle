/**
 * Shared bundle field limits, imported by both server (Convex mutations)
 * and client (form validation + character counters). Server is
 * authoritative — clients import these to preempt failures, but the
 * server re-validates as defense-in-depth.
 */

export const MAX_BUNDLE_DESCRIPTION_LENGTH = 500;

/**
 * Hard cap on the number of skills a single bundle can hold. Enforced by
 * `createBundle` and `updateBundleSkills` before they hit the catalog
 * validator, so a pathological payload (10k skill refs) fails with a
 * clear error instead of a cryptic Convex `TRANSACTION_LIMIT_EXCEEDED`
 * when the parallel `Promise.all` of index lookups exhausts the
 * per-transaction budget. Also serves as a DoS-shape guard.
 *
 * Bundles in real use are 5–20 skills; 100 is a generous ceiling that
 * still gives the validator predictable cost (~100 indexed reads /
 * ~50ms execution time).
 */
export const MAX_BUNDLE_SKILLS = 100;

/**
 * Distinct skills a free account can watch.
 *
 * Lives here, in the dependency-free module both sides already import, because
 * it was previously declared twice — once in `convex/lib/plans.ts` as the
 * ENFORCED value and once in `lib/plans.ts` as the ADVERTISED one, kept in step
 * by a comment. The pricing page is the single surface where those two
 * disagreeing is a false claim rather than a bug, so it should not be possible.
 *
 * 25 is meant to be a real working limit, not a teaser. A personal agent setup
 * lands well inside it, so the free tier delivers the entire product rather
 * than a demo of it; the people past it are running something they would notice
 * breaking, which is the same population that will pay to keep watching it.
 */
export const FREE_WATCHED_SKILLS = 25;

/**
 * Sanity cap on bundles per user. Deliberately NOT a plan gate — metering moved
 * to distinct skills watched, and this is not a re-introduction of the old
 * `maxBundles`; it is the bound that removing it left absent.
 *
 * Two things need one. An EMPTY bundle passes every existing check for free
 * (the watch-limit union adds nothing, and the catalog validator returns early
 * on an empty array), so nothing stopped unbounded row creation. And every
 * per-user path `.collect()`s the whole `by_userId` range, including the
 * dashboard feed, which then fans out 2-3 indexed reads per distinct watched
 * skill — enough bundles and that query hits Convex's read ceiling and the
 * dashboard fails outright rather than degrading.
 *
 * 200 is far above any real organisational need and far below where the fan-out
 * becomes a problem.
 */
export const MAX_BUNDLES_PER_USER = 200;

/**
 * The identity of a watched skill, everywhere.
 *
 * `source::skillId` was written out inline at every site that counts, compares
 * or joins skills — the server's limit check, the client preempts, the
 * dashboard metric, the change feed and the register's row map. They agreed,
 * but nothing made them agree, and a count that silently uses a different key
 * from the enforcement it previews is the failure mode this whole area already
 * produced once.
 */
export function watchKey(skill: { source: string; skillId: string }): string {
  return `${skill.source}::${skill.skillId}`;
}
