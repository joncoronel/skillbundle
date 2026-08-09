/**
 * The guard every dev-seeding function must call first.
 *
 * `internalMutation` keeps these off the client, which is the threat people
 * think of. It does nothing about the CLI: `npx convex run devSeed:x --prod` is
 * one flag away from `npx convex run devSeed:x`, and the doc comments show the
 * bare form. So the real exposure is a slip by someone with a deploy key —
 * which is everyone who works on this.
 *
 * What that slip can cost is not uniform, and the worst case is why this is a
 * shared helper rather than a line copied where it seemed to matter:
 *
 *   - `seedFault` / `seedFeedBundle` forge a delisting or a CRITICAL verdict on
 *     a real catalog row. Every watcher sees it. Reversible.
 *   - `clearSeededVersions` deletes every `skillVersions` row for a skill AND
 *     its storage blob. Despite the name it has no "seeded" predicate — it
 *     cannot distinguish fabricated history from the real archive. NOT
 *     reversible: the blobs are gone, and the archive is the product.
 *
 * An earlier pass guarded one function and left six, including that one.
 * Deciding case by case is exactly the judgement that failed, so the rule is
 * now blanket: every export in `devSeed.ts` and `devSeedFeed.ts` calls this,
 * whether or not it looks dangerous.
 */
export function assertNotProduction(fn: string): void {
  // `CRONS_ENABLED` is the flag prod sets and dev does not — the same signal
  // crons.ts and reconcile.ts already gate on, so there is one notion of
  // "this is production" rather than a second one to keep in step.
  if (process.env.CRONS_ENABLED === "true") {
    throw new Error(
      `${fn} is dev-only and refuses to run on production. ` +
        `If you meant to run it locally, drop the --prod flag.`,
    );
  }
}
