import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

/**
 * Cache tags for skill data, and the one loader shared across every surface
 * that renders a skill row.
 *
 * ── The tag split ─────────────────────────────────────────────────────────
 *
 * Two tags, divided by CADENCE rather than by skill. This is the canonical
 * description; convex/lib/revalidate.ts lists the callers.
 *
 *   "skill-sync"    — install count, rank, snapshots, version history, copies.
 *                     syncSkills rewrites the ENTIRE leaderboard (~9.5k rows)
 *                     every morning, so this tag genuinely churns daily.
 *   "skill-content" — the skill row itself: SKILL.md content, description,
 *                     name, isDelisted, curatedOwner. Changes per-skill every
 *                     few WEEKS (markStaleContent only re-flags rows past the
 *                     7-day backstop).
 *
 * Both used to be one tag, which meant the daily install-count refresh
 * invalidated every skill's ~25 KB content entry too. Since ISR writes are
 * billed per entry, that made a routine number update cost 4 writes per visited
 * page instead of 1. Keep install-count-only jobs (syncSkills, reconcile,
 * curatedRefresh — all of them go through drainRefreshBatch) pinging ONLY
 * "skill-sync"; anything that mutates the skill row must ping "skill-content".
 *
 * ── What this does NOT yet buy ────────────────────────────────────────────
 *
 * Be accurate about the current ceiling, because two things still invalidate
 * the content entry daily and it is easy to assume otherwise:
 *
 *   1. The content chain fires end to end every morning whether or not any
 *      SKILL.md changed (`markStaleContent` chains into `backfillDiscoverUrls`
 *      unconditionally, and both terminals schedule `publishSkillUpdate` with
 *      no "did we write anything" gate). Gating it needs somewhere to collect
 *      which skills changed across independent staggered actions — parked in
 *      TODO.md under "Per-skill cache invalidation".
 *   2. `cacheLife` is orthogonal to `cacheTag`: an entry's own `revalidate`
 *      timer fires regardless of tags. That is why `loadSkill` sits on "weeks"
 *      below rather than "days" — on "days" it would rewrite itself every 24h
 *      no matter how clean the tag routing got.
 *
 * So today the reliable per-visit saving comes from the loader consolidation in
 * components/skill-detail-page.tsx and from (2), not from the tag split alone.
 */
export const SKILL_SYNC_TAG = "skill-sync";
export const SKILL_CONTENT_TAG = "skill-content";

/**
 * The skill row. Lives here rather than beside the detail page's other loaders
 * because THREE separate surfaces need it, and `'use cache'` keys on function
 * identity + args — so two textually identical loaders are two cache entries,
 * each written and expired independently. The consumers:
 *
 *   1. the detail page body (components/skill-detail-page.tsx),
 *   2. that route's `generateMetadata` pass,
 *   3. the OG card (lib/og/images.tsx).
 *
 * (3) used to keep its own untagged copy, so every OG render wrote a second
 * entry for data the page had already cached, and — being untagged on a 1-day
 * life — rewrote it daily forever instead of when the content actually changed.
 * Same reasoning as the shared loader in lib/source-skills.ts. Importing the
 * detail-page module into an OG route would have worked too, but it would drag
 * that component's whole graph (markdown, shiki, icons) into the image route.
 *
 * `'use cache'` also isolates `fetchQuery`'s forced `no-store` behind a cache
 * boundary, which is what lets these routes prerender a static shell at all.
 *
 * "weeks" (revalidate 7d / expire 30d), not "days" (revalidate 24h): the whole
 * point of putting this entry on its own tag is that on-demand pings —
 * `publishSkillUpdate`, `markDelistedSkills`, `syncCurated`, `kickPostAddChain`
 * — now keep it fresh, so it does not need a 24h timer as well. 7d matches the
 * content re-fetch backstop in `markStaleContent`. Leaving it on "days" would
 * have made the tag work pointless: the entry would rewrite itself daily
 * anyway.
 */
export async function loadSkill(source: string, skillId: string) {
  "use cache";
  cacheLife("weeks");
  cacheTag(SKILL_CONTENT_TAG);
  return fetchQuery(api.skills.getBySourceAndSkillId, { source, skillId });
}
