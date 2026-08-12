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
 * ── Why this exists: traffic, not the bill ────────────────────────────────
 *
 * Measured in Vercel Observability on 2026-08-12, over 24h: **Googlebot made
 * ONE request** to the whole site. Bingbot 17, Applebot 20. A ~9.5k-page
 * catalog that Google is not crawling earns no organic search traffic, and
 * organic search is the discovery path this product depends on. That is the
 * reason this file exists. It is a growth problem, not an infrastructure one.
 *
 * Do NOT re-frame it as a caching win — the trap this feature was written into
 * twice, including by the TODO entry that specified it. `lastmod` letting
 * crawlers skip unchanged pages is a real effect but a weak one, because a
 * crawl is a sweep over DISTINCT URLs: a crawler has no reason to fetch the
 * same skill page twice, so its requests are uncacheable by construction no
 * matter what this file says. (Same day: skill detail pages cache at 5.3%,
 * against 97% for `/compare`, one URL absorbing all its traffic. Same code,
 * same settings — the only variable is how many URLs the traffic splits
 * across.) If this lands and the bill does not move, that is expected.
 *
 * `lastmod` still earns its place as the second-order effect rather than the
 * headline: it tells a crawler which of ~9.5k pages are worth returning to.
 * Google honours it only partially, so treat that as real but unquantified.
 * `changefreq` and `priority` are omitted deliberately: Google ignores both
 * outright, and a wrong `changefreq` is worse than none.
 *
 * One interaction with app/robots.ts, worth knowing before anyone reads a slow
 * Bing crawl as a fault: the wildcard rule there carries `crawlDelay: 10`.
 * Googlebot ignores it (it uses its own Search Console budget), but Bing
 * honours it, and 18.7k URLs at 10s/request is >50h for one compliant pass.
 * Fine for a continuous process; surprising if you expect a sitemap to be
 * consumed in one sitting.
 *
 * ── Why it is not itself expensive ────────────────────────────────────────
 *
 * The naive version of this route is a net loss: ~9.5k skills enumerated per
 * request, times however often crawlers ask. `'use cache'` is what makes it
 * safe — generation is per cache entry, not per request, so the crawler-facing
 * cost is a CDN read of ~2.4 MB of XML.
 *
 * Both skill tags, because both halves of this file move independently: the URL
 * SET changes when a skill is added or delisted ("skill-sync"), and the
 * `lastmod` values change when content does ("skill-content"). The entry busts
 * on either. "skill-content" already churns catalog-wide a few times each
 * morning (see lib/skill-cache.ts), so in practice this regenerates ~5x/day:
 * ~50 Convex queries and ~5 ISR writes daily, against a crawl of ~18.7k pages.
 * `cacheLife("days")` is the backstop if every publisher for a day missed.
 *
 * ── Size ──────────────────────────────────────────────────────────────────
 *
 * 18,701 URLs as of Aug 2026 (~9.5k skills plus their orgs, repos and
 * well-known sources) at ~130 B each. Both limits — 50k URLs and 50 MB — are far
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
