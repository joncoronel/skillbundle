/**
 * Ping the Next.js site to invalidate one of its `'use cache'` tags, so the
 * next request rebuilds from fresh Convex data instead of serving the cached
 * snapshot. Drives every allowlisted tag, not just the home rails — the
 * allowlist itself lives in app/api/revalidate/route.ts.
 *
 * Which tag to ping is decided by WHICH FIELDS MOVED, not by which job you are.
 * A job that moves both kinds of data pings both (markDelistedSkills and
 * syncCurated do exactly that). Getting this wrong is expensive, not just wrong:
 *
 *   "home-hot" / "home-trending" / "home-popular"
 *       Home rails. Pinged by their own leaderboard crons.
 *   "skill-sync"
 *       Install counts, ranks, snapshots, version history, copies — plus the
 *       list surfaces that filter on `isDelisted` / read the curated rollup
 *       (`lib/source-skills.ts`, `app/(main)/[org]`, `app/(main)/official`).
 *       syncSkills rewrites the full ~9.5k-row leaderboard daily, so this tag
 *       churns the whole catalog every morning by design.
 *   "skill-content"
 *       The skill row read by `loadSkill`: SKILL.md content, description, name,
 *       isDelisted, curatedOwner. Long-lived (`cacheLife("weeks")`), so it
 *       depends on these pings for freshness rather than on a timer.
 *
 * Do NOT add "skill-content" to a job that moved only install numbers
 * (reconcile, curatedRefresh, and the unconditional part of the syncSkills
 * terminal). Those run daily across the whole catalog, and pairing them with the
 * content tag is exactly the coupling that made one routine number update cost 4
 * ISR writes per visited skill page instead of 1. See lib/skill-cache.ts, which
 * is also honest about what this does not yet buy.
 *
 * No-ops unless both env vars are set — they're configured on the PRODUCTION
 * Convex deployment only, so dev syncs never hit the live site. Set with:
 *   npx convex env set SITE_REVALIDATE_URL https://skillbundle.dev/api/revalidate --prod
 *   npx convex env set REVALIDATE_SECRET <secret> --prod
 * (REVALIDATE_SECRET must match the value set on Vercel.)
 *
 * Best-effort: a failed ping is logged, not thrown — the sync already
 * succeeded, and the cache's time-based `revalidate` is the safety net.
 */
/**
 * Every tag `app/api/revalidate/route.ts` will accept. Kept as a union rather
 * than a bare `string` so a typo is a compile error here instead of a 400 that
 * `revalidateSiteTag` swallows and logs. The two deployments can't share a
 * module, so this has to be mirrored by hand — `tests/revalidate-route.test.ts`
 * asserts the Next side matches.
 */
export type SiteTag =
  | "home-hot"
  | "home-trending"
  | "home-popular"
  | "skill-sync"
  | "skill-content";

export async function revalidateSiteTag(tag: SiteTag): Promise<void> {
  const url = process.env.SITE_REVALIDATE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!url || !secret) return;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-revalidate-secret": secret,
      },
      body: JSON.stringify({ tag }),
      // A redirect would carry `x-revalidate-secret` to the hop target: the
      // Fetch spec strips only Authorization / Cookie / Proxy-Authorization on
      // cross-origin redirects, not custom headers. Refuse the hop instead of
      // quietly handing the secret to wherever it points.
      //
      // SITE_REVALIDATE_URL must therefore be the canonical host. Verified Aug
      // 2026: the apex answers directly and `www` 308s to it, so the apex form
      // in the setup command above is correct.
      //
      // The refused hop surfaces as a literal 3xx on the Convex runtime
      // (measured), and as an opaque `status: 0` under a spec-exact fetch. The
      // check below takes either.
      redirect: "manual",
      // Fail fast — this is awaited inside the sync action, so a hung site
      // shouldn't pin the action open until Convex's action timeout.
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 0 || (res.status >= 300 && res.status < 400)) {
      console.error(
        `revalidate ${tag}: SITE_REVALIDATE_URL (${url}) redirected (${res.status}); point it at the canonical host`,
      );
    } else if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`revalidate ${tag}: ${res.status} ${body.slice(0, 200)}`);
    }
  } catch (e) {
    console.error(`revalidate ${tag} failed:`, e);
  }
}
