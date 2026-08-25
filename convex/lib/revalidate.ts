/**
 * Ping the Next.js site to invalidate one of its `'use cache'` tags, so the
 * next request rebuilds from fresh Convex data instead of serving the cached
 * snapshot. Drives every allowlisted tag, not just the home rails — the tag
 * vocabulary lives in lib/cache-tags.ts, which both this file and the route
 * derive from.
 *
 * Which tag to ping is decided by WHICH FIELDS MOVED, not by which job you are.
 * A job that moves both kinds of data pings both (markDelistedSkills and
 * syncCurated do exactly that). Getting this wrong is expensive, not just wrong:
 *
 *   "home-popular"
 *       The home page's popular rail. Pinged by the sync cron.
 *   "skill-sync"
 *       Install counts, ranks, snapshots, version history, copies — plus the
 *       list surfaces that filter on `isDelisted` / read the curated rollup
 *       (`lib/source-skills.ts`, `app/(main)/[org]`, `app/(main)/official`).
 *       syncSkills rewrites the full ~16k-row leaderboard daily, so this tag
 *       churns the whole catalog every morning by design.
 *   "skill-content"
 *       The skill row read by `loadSkill`: SKILL.md content, description, name,
 *       isDelisted, curatedOwner, isGitHubOnly, and the denormalized audit
 *       verdict (worstAuditStatus / worstAuditRiskLevel). Long-lived
 *       (`cacheLife("weeks")`), so it depends on these pings for freshness
 *       rather than on a timer — if you add a field to this list, find its
 *       writer and give it a ping.
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
 * succeeded. Note the time-based safety net is a weak one for "skill-content":
 * `cacheLife("weeks")` means a dropped ping is up to 7 days of staleness, not
 * the 24h it used to be.
 */
// The tag vocabulary is IMPORTED from the Next.js side, not mirrored by hand.
// lib/cache-tags.ts is dependency-free precisely so this works: /api/revalidate
// derives its allowlist from the same module, so a tag can no longer exist on
// one side and not the other. Relative path, not the `@/` alias — convex/
// typechecks under its own tsconfig, which defines no path aliases.
import type { SiteTag } from "../../lib/cache-tags";

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
