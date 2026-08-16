import type { MetadataRoute } from "next";
import { cacheLife } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { CATALOG_MAX_ROWS, maxIterForRows } from "@/convex/lib/pagination";
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
 * ONE request** to the whole site. Bingbot 17, Applebot 20. A ~16k-page
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
 * headline: it tells a crawler which of ~16k pages are worth returning to.
 * Google honours it only partially, so treat that as real but unquantified.
 * `changefreq` and `priority` are omitted deliberately: Google ignores both
 * outright, and a wrong `changefreq` is worse than none.
 *
 * One interaction with app/robots.ts, worth knowing before anyone reads a slow
 * Bing crawl as a fault: the wildcard rule there carries `crawlDelay: 10`.
 * Googlebot ignores it (it uses its own Search Console budget), but Bing
 * honours it, and ~31k URLs at 10s/request is >85h for one compliant pass.
 * Fine for a continuous process; surprising if you expect a sitemap to be
 * consumed in one sitting.
 *
 * ── What it costs, and where that cost actually lands ─────────────────────
 *
 * The naive version of this route is a net loss: ~16k skills enumerated per
 * request, times however often crawlers ask. `'use cache'` is what makes it
 * safe against CRAWLERS — generation is per cache entry, not per request, so
 * the crawler-facing cost is a CDN read of the XML.
 *
 * What `'use cache'` does NOT amortise is deploys. The cache key includes the
 * build ID, so every deployment starts from an empty entry and pays a full
 * walk (node_modules/next/dist/docs/01-app/03-api-reference/01-directives/
 * use-cache.md, "Cache keys"). One walk is ~21 MB of Convex database
 * bandwidth: ~16k rows at ~1.3 KB each, and the WHOLE `skillSummaries`
 * document is billed even though `listSitemapEntries` returns six fields —
 * Convex charges bytes read, not bytes projected.
 *
 * Measured 2026-08-16: ~24 walks/day, ~20 of them deployments (16 of those
 * previews, which build against the prod Convex URL), for **500 MB/day on
 * each of the dev and prod deployments**. Hence the production gate in
 * `loadSitemapRows` below — that gate, not the tag change, is what moved the
 * number. Deploy frequency is the dominant term here and there is no caching
 * arrangement on the Next side that can absorb it, so do not go looking for
 * one.
 *
 * If this ever needs to get cheaper again, the remaining lever is the ~1.3 KB
 * row, NOT the frequency: a slim projection table (source, skillId, lastmod)
 * would cut a walk to ~2.5 MB. That would be a third denormalization tier
 * after skills → skillSummaries, with a write path to keep in sync, so it is
 * deliberately not done yet. Re-measure before reaching for it.
 *
 * ── No cache tag, deliberately ────────────────────────────────────────────
 *
 * This route is not tag-invalidated at all. It used to ride "skill-content",
 * on the reasoning that both things which move this file — the URL SET (a
 * skill added or delisted) and the `lastmod` values (content moved) — are
 * "skill-content" events. That much is true; the cost was wrong.
 * `/api/revalidate` pings with `{ expire: 0 }`, so every ping made the next
 * crawler block on a full catalog walk, and convex/skills.ts:publishSkillUpdate
 * fires that tag ~4x every morning even on days when no SKILL.md moved.
 *
 * `cacheLife("days")` fits better than any ping, because staleness is the one
 * thing a sitemap can afford. That profile is stale 5m / revalidate 1 day /
 * expire 1 week, so the entry refreshes about once a day IN THE BACKGROUND and
 * no crawler ever waits on a walk. A URL up to a day late to appear (or to
 * leave) costs nothing against a crawler that needs >85h for one compliant
 * pass of this file — see the robots.txt note above. The weekly `isDuplicate`
 * flip, never covered by a publisher anyway, now falls under the same rule.
 *
 * If something later needs same-day submission of a new URL, add a
 * sitemap-specific tag and ping it from exactly one place. Do not re-attach
 * this to a catalog-wide content tag.
 *
 * ── Size ──────────────────────────────────────────────────────────────────
 *
 * ~16.0k live skills in production as of Aug 2026 (16,784 rows, 821 delisted),
 * plus their orgs, repos and well-known sources — call it twice that in URLs,
 * at ~130 B each. The 50 MB limit is still far off, but the 50k URL limit is
 * now within one catalog-doubling, so this stays a single file only for the
 * moment. `generateSitemaps` is the escape hatch when it lands.
 */

// 1000 rows/page keeps each Convex query two orders of magnitude inside the
// per-query read limits while holding the walk to ~10 round trips. The cap is
// the same drain backstop the paginated Convex jobs use: enough pages to cover
// a catalog far larger than today's, so hitting it means a cursor stopped
// advancing rather than a catalog that outgrew the number.
const PAGE_SIZE = 1000;
const MAX_PAGES = maxIterForRows(CATALOG_MAX_ROWS, PAGE_SIZE);

// Only a production deployment drains the whole catalog. Preview builds and
// local `next build` / `pnpm e2e` runs prerender this route exactly like
// production does — and nothing ever reads what they produce. At ~21 MB of
// Convex bandwidth per walk (see the header) those were ~80% of this route's
// entire cost, on both Convex deployments: previews build against the prod
// Convex URL, and local builds against dev.
//
// One page rather than zero, so a preview still serves a real sitemap with
// real rows in it: the XML shape, the `lastmod` derivation and the directory
// roll-up are all reviewable, just over the first 1000 skills instead of all
// of them. An empty file would make a broken sitemap and a correct one look
// identical on every preview URL, which is where anyone would go to check.
//
// The one way this gate fails badly is silently: if `VERCEL_ENV` ever went
// missing on a production build (it is a Vercel system env var, and the project
// setting that exposes those can be turned off), production would take the
// one-page path and ship a truncated sitemap that still looks well-formed.
// Nothing downstream could tell — hence the log in `loadSitemapRows`, which
// puts the branch and the row count in the build output. Check it after any
// change to the project's environment settings.
const isProductionDeployment = process.env.VERCEL_ENV === "production";

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

// The one observable trace that the production gate resolved the way it was
// meant to. A truncated sitemap is well-formed XML, so this line is what
// separates "prod walked the whole catalog" from "prod quietly took the preview
// path"; expect `env=production pages=16` in a production build's log and
// `env=preview pages=1` in a preview's.
function logAndReturn(rows: SitemapSkillRow[], pages: number) {
  console.log(
    `[sitemap] env=${process.env.VERCEL_ENV ?? "local"} pages=${pages} rows=${rows.length}`,
  );
  return rows;
}

async function loadSitemapRows(): Promise<SitemapSkillRow[]> {
  "use cache";
  // No cacheTag — the header explains why the timer is the right invalidator
  // here and a tag is not.
  cacheLife("days");

  const rows: SitemapSkillRow[] = [];
  let cursor: string | null = null;
  const maxPages = isProductionDeployment ? MAX_PAGES : 1;

  for (let page = 0; page < maxPages; page++) {
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
    if (result.isDone) return logAndReturn(rows, page + 1);
    cursor = result.continueCursor;
  }

  // Outside production the one-page cap IS the intended stopping point, not a
  // drained-cursor bug, so falling out of the loop here is expected and the
  // throw below must not fire.
  if (!isProductionDeployment) return logAndReturn(rows, maxPages);

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
