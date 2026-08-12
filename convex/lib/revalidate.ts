/**
 * Ping the Next.js site to invalidate a cached home-page leaderboard tag, so
 * the next request rebuilds from fresh Convex data instead of serving the
 * `'use cache'` snapshot. Called from a leaderboard sync action right after
 * it writes new ranks.
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
export async function revalidateHomeTag(tag: string): Promise<void> {
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
