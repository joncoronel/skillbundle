import type { MetadataRoute } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { CATALOG_MAX_ROWS, maxIterForRows } from "@/convex/lib/pagination";
import { SKILL_CONTENT_TAG } from "@/lib/cache-tags";
import { SITE_URL } from "@/lib/site-url";
import {
  buildSitemapEntries,
  type SitemapSkillRow,
} from "@/lib/sitemap-entries";

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
 * One tag, not both, even though two independent things move this file: the URL
 * SET changes when a skill is added or delisted, and the `lastmod` values
 * change when content does. Both of those are "skill-content"
 * events: `markDelistedSkills` and the content chain's `publishSkillUpdate`
 * each ping BOTH tags, and a genuinely new row publishes through that chain
 * too (convex/skills.ts says so where it declines to ping "skill-content"
 * itself). So tagging "skill-sync" as well would add no coverage the sitemap
 * needs while inheriting its churn — that tag also fires from the per-batch
 * install refreshes in reconcile.ts and curatedRefresh.ts, 20+ times a day,
 * none of which move a single URL or `lastmod` here.
 *
 * That matters more than a regeneration count, because `/api/revalidate` uses
 * `{ expire: 0 }`: the first crawler after any ping does not get a stale copy,
 * it WAITS on the full catalog walk. Fewer pings means fewer crawlers paying
 * for one. The one thing left uncovered is an `isDuplicate` flip (weekly job,
 * no publisher), bounded to 24h by `cacheLife("days")` below — which is also
 * the backstop if every publisher for a day missed.
 *
 * ── Size ──────────────────────────────────────────────────────────────────
 *
 * ~18.6k URLs as of Aug 2026 (~9.5k skills plus their orgs, repos and
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

// The projection and the consumer's row type must name the same fields, and
// nothing else enforces that: every field is optional, so dropping or renaming
// one on the Convex side still assigns cleanly here and every `lastmod`
// silently disappears — the one thing this route exists to emit. The tests
// build their own rows, so they can't catch it either. Comparing the key sets
// makes it a `pnpm check` failure instead of a production non-event.
type Assert<T extends true> = T;
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false;
// Named rather than inlined so the compiler error points somewhere legible;
// the declaration IS the use, hence the disable.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _RowShapeMatchesQuery = Assert<
  SameKeys<SitemapPage["page"][number], SitemapSkillRow>
>;

async function loadSitemapRows(): Promise<SitemapSkillRow[]> {
  "use cache";
  cacheLife("days");
  cacheTag(SKILL_CONTENT_TAG);

  const rows: SitemapSkillRow[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result: SitemapPage = await fetchQuery(
      api.skills.listSitemapEntries,
      { paginationOpts: { numItems: PAGE_SIZE, cursor } },
    );
    rows.push(...result.page);
    // Convex ends a page against its own read limits rather than at `numItems`,
    // so `numItems` alone is not proof of a complete page. Its two statuses are
    // NOT interchangeable (see the doc comment on `pageStatus` in
    // convex/dist/cjs-types/server/pagination.d.ts):
    //
    //   "SplitRequired"    — the page MIGHT BE INCOMPLETE. Rows are missing and
    //                        the cursor still advances past them, which is the
    //                        same invisible truncation as the cap below.
    //   "SplitRecommended" — the page is complete; Convex is advising a smaller
    //                        one. Failing on this would break a sitemap that is
    //                        perfectly good, and because this route prerenders,
    //                        it would break `next build` rather than just a
    //                        request. So: log it, and treat it as the signal to
    //                        lower PAGE_SIZE before it becomes the other one.
    if (result.pageStatus === "SplitRequired") {
      throw new Error(
        `[sitemap] Convex returned pageStatus=SplitRequired on page ${page}; the page may be missing rows`,
      );
    }
    if (result.pageStatus === "SplitRecommended") {
      console.warn(
        `[sitemap] Convex recommends splitting page ${page} (PAGE_SIZE=${PAGE_SIZE}); the walk is still complete, but lower it before this becomes SplitRequired`,
      );
    }
    if (result.isDone) return rows;
    cursor = result.continueCursor;
  }

  // Throw rather than return what we have. A short sitemap is indistinguishable
  // from a complete one, and because this function is cached, returning would
  // persist the truncation and re-serve it as authoritative for a day, with a
  // single `console.warn` buried in the function logs as the only trace.
  // Throwing means no cache entry is written and the next crawler retries.
  throw new Error(
    `[sitemap] stopped at the ${MAX_PAGES}-page cap with ${rows.length} rows; refusing to cache a truncated sitemap`,
  );
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const rows = await loadSitemapRows();
  return buildSitemapEntries(rows, SITE_URL);
}
