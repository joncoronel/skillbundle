import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { secretsMatch } from "@/lib/shared-secret";
import { SITE_TAGS } from "@/lib/cache-tags";

// On-demand cache invalidation for the home-page leaderboards and skill detail
// pages. The Convex crons POST here right after they write new data, so the next
// request rebuilds the `'use cache'` entry from fresh data instead of serving
// a stale (or empty) one. Gated by a shared secret, and only a fixed allowlist
// of tags can be revalidated. Not a Clerk-private route, so the secret is the
// only gate (see proxy.ts).
//
// Derived from lib/cache-tags.ts rather than restated, so the allowlist and the
// `cacheTag(...)` call sites cannot drift apart. What each tag means, and why the
// three skill tags are split by cadence rather than by skill, is documented in
// lib/skill-cache.ts; convex/lib/revalidate.ts takes its `SiteTag` union from
// the same module by `import type`, so the caller side cannot drift either.
// tests/revalidate-route.test.ts covers the runtime half.
const ALLOWED_TAGS = new Set<string>(SITE_TAGS);

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
