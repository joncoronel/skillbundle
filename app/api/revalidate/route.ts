import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { secretsMatch } from "@/lib/shared-secret";

// On-demand cache invalidation for the home-page leaderboards and skill detail
// pages. The Convex crons POST here right after they write new data, so the next
// request rebuilds the `'use cache'` entry from fresh data instead of serving
// a stale (or empty) one. Gated by a shared secret, and only a fixed allowlist
// of tags can be revalidated. Not a Clerk-private route, so the secret is the
// only gate (see proxy.ts).
//
// The two skill tags are split by cadence, NOT by skill — see the header of
// components/skill-detail-page.tsx for the full reasoning:
//
//   "skill-sync"    — install counts / ranks / snapshots / versions / copies.
//                     Pinged daily by syncSkills, which rewrites the entire
//                     ~9.5k-row leaderboard, plus the reconcile and curated
//                     refresh jobs. Churns every day, by design.
//   "skill-content" — the skill row itself (SKILL.md content, description,
//                     isDelisted, curatedOwner). Pinged only by jobs that
//                     actually mutate that row. Must NOT be pinged by
//                     install-count-only jobs, or the daily sync goes back to
//                     invalidating every skill's ~25 KB content entry.
const ALLOWED_TAGS = new Set([
  "home-hot",
  "home-trending",
  "home-popular",
  "skill-sync",
  "skill-content",
]);

export async function POST(request: Request) {
  const expected = process.env.REVALIDATE_SECRET;
  const provided = request.headers.get("x-revalidate-secret");
  if (!expected || !provided || !secretsMatch(provided, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let tag: unknown;
  try {
    ({ tag } = await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (typeof tag !== "string" || !ALLOWED_TAGS.has(tag)) {
    return NextResponse.json({ error: "invalid_tag" }, { status: 400 });
  }

  // { expire: 0 } expires the tag immediately, so the next home-page visit
  // refetches fresh — rather than "max"'s stale-while-revalidate, which would
  // serve the first post-sync visitor the old snapshot. This is Next 16's
  // documented pattern for external webhooks (our Convex cron) that need
  // immediate expiration, and it keeps Popular's cached page 1 aligned with
  // the live paginated pages 2+.
  //
  // Do NOT "modernise" this to `updateTag`, and do not drop the second
  // argument. Verified against the 16.3 docs:
  //   - The signature is `revalidateTag(tag, profile: string | { expire })`.
  //     The two-argument form used here is current. What's deprecated is the
  //     ONE-argument `revalidateTag(tag)`.
  //   - `updateTag` is Server-Actions-only and throws anywhere else, so it is
  //     not available to a Route Handler at all. `{ expire: 0 }` is the
  //     Route-Handler-legal way to get updateTag's immediate-expiry semantics.
  revalidateTag(tag, { expire: 0 });
  return NextResponse.json({ revalidated: true, tag });
}
