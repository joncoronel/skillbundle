import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { timingSafeEqual } from "node:crypto";

// Constant-time compare that also fails closed on length mismatch (and avoids
// timingSafeEqual's throw on unequal-length buffers).
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// On-demand cache invalidation for the home-page leaderboards and skill detail
// pages. The Convex crons POST here right after they write new data, so the next
// request rebuilds the `'use cache'` entry from fresh data instead of serving
// a stale (or empty) one. "skill-sync" is pinged by syncSkills to refresh every
// skill page's install count + chart in lockstep with the daily sync. Gated by a
// shared secret, and only a fixed allowlist of tags can be revalidated. Not a
// Clerk-private route, so the secret is the only gate (see proxy.ts).
const ALLOWED_TAGS = new Set([
  "home-hot",
  "home-trending",
  "home-popular",
  "skill-sync",
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
  revalidateTag(tag, { expire: 0 });
  return NextResponse.json({ revalidated: true, tag });
}
