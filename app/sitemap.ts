import type { MetadataRoute } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { CATALOG_MAX_ROWS, maxIterForRows } from "@/convex/lib/pagination";
import { SKILL_CONTENT_TAG, SKILL_SYNC_TAG } from "@/lib/cache-tags";
import { SITE_URL } from "@/lib/site-url";
import { buildSitemapEntries, type SitemapSkillRow } from "@/lib/sitemap-entries";

/**
 * The catalog sitemap: every indexable skill page plus the directory pages
 * above them. `app/robots.ts` advertises it.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Not for discovery — the catalog is fully linked, so crawlers find it anyway.
 * It exists for `lastmod`. Without one, a crawler re-fetches pages on its own
 * schedule, and every cold fetch here re-renders the page and rewrites its ISR
 * entry, which is a billed write. Most SKILL.md files sit still for weeks, so
 * feeding real `contentUpdatedAt` values lets crawlers skip what hasn't moved.
 * Google honours `lastmod` only partially, so treat that as real but
 * unquantified. `changefreq` and `priority` are omitted deliberately: Google
 * ignores both outright, and a wrong `changefreq` is worse than none.
 *
 * ── Why it is not itself expensive ────────────────────────────────────────
 *
 * The naive version of this route is a net loss: ~9.5k skills enumerated per
 * request, times however often crawlers ask. `'use cache'` is what makes it
 * safe — generation is per cache entry, not per request, so the crawler-facing
 * cost is a CDN read of ~1.5 MB of XML.
 *
 * Both skill tags, because both halves of this file move independently: the URL
 * SET changes when a skill is added or delisted ("skill-sync"), and the
 * `lastmod` values change when content does ("skill-content"). The entry busts
 * on either. "skill-content" already churns catalog-wide a few times each
 * morning (see lib/skill-cache.ts), so in practice this regenerates ~5x/day:
 * ~50 Convex queries and ~5 ISR writes daily, against a crawl of ~13k pages.
 * `cacheLife("days")` is the backstop if every publisher for a day missed.
 *
 * ── Size ──────────────────────────────────────────────────────────────────
 *
 * ~13k URLs (~9.5k skills plus their orgs, repos and well-known sources) at
 * ~120 B each. Both sitemap limits — 50k URLs and 50 MB uncompressed — are far
 * off, so this stays a single file. `generateSitemaps` is the escape hatch if
 * the catalog ever approaches either, or if per-generation cost (not per
 * request — that's already amortised) becomes the problem.
 */

// 1000 rows/page keeps each Convex query two orders of magnitude inside the
// per-query read limits while holding the walk to ~10 round trips. The cap is
// the same drain backstop the paginated Convex jobs use: enough pages to cover
// a catalog far larger than today's, so hitting it means a cursor stopped
// advancing rather than a catalog that outgrew the number.
const PAGE_SIZE = 1000;
const MAX_PAGES = maxIterForRows(CATALOG_MAX_ROWS, PAGE_SIZE);

// Annotated at the call site below, not inferred: `cursor` is fed from
// `result.continueCursor` on the next iteration, and without this the checker
// sees `result` referenced in its own initializer (TS7022). Same reason
// lib/representative-params.ts spells out its page type.
type SitemapPage = FunctionReturnType<typeof api.skills.listSitemapEntries>;

async function loadSitemapRows(): Promise<SitemapSkillRow[]> {
  "use cache";
  cacheLife("days");
  cacheTag(SKILL_SYNC_TAG, SKILL_CONTENT_TAG);

  const rows: SitemapSkillRow[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result: SitemapPage = await fetchQuery(
      api.skills.listSitemapEntries,
      { paginationOpts: { numItems: PAGE_SIZE, cursor } },
    );
    rows.push(...result.page);
    if (result.isDone) return rows;
    cursor = result.continueCursor;
  }

  // Never silently truncate: a short sitemap looks identical to a complete one,
  // so the only symptom would be pages quietly dropping out of the index.
  console.warn(
    `[sitemap] stopped at the ${MAX_PAGES}-page cap with ${rows.length} rows; the sitemap is incomplete`,
  );
  return rows;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const rows = await loadSitemapRows();
  return buildSitemapEntries(rows, SITE_URL);
}
