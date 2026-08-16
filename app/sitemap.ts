import type { MetadataRoute } from "next";
import { cacheLife } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { CATALOG_MAX_ROWS, maxIterForRows } from "@/convex/lib/pagination";
import { IS_PRODUCTION_DEPLOYMENT } from "@/lib/deployment-env";
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
 * honours it, and ~18.7k URLs at 10s/request is >50h for one compliant pass.
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
 * Measured 2026-08-16, and the counts are PER CONVEX DEPLOYMENT, not shared:
 * prod took ~24 walks/day (~21 MB each) and dev ~28 (~18 MB each), so each of
 * the two independently reached **~500 MB/day**. Prod's ~24 is ~20 deployments
 * — 4 production plus 16 previews, which build against the prod Convex URL —
 * and ~4 tag pings. Dev's ~28 is local `pnpm build` and `pnpm e2e` runs. Read
 * as one shared 24 the arithmetic does not close and the gate looks half
 * broken, so keep the split explicit. Hence the production gate in
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
 * expire 1 week, so a request arriving a day after generation is served the
 * cached copy while the walk runs in the background. A URL up to a day late to
 * appear (or to leave) costs nothing against a crawler that needs >50h for one
 * compliant pass of this file — see the robots.txt note above. The weekly
 * `isDuplicate` flip, never covered by a publisher anyway, falls under the same
 * rule.
 *
 * Both behaviors are request-driven, not timer-driven, so "nobody ever waits"
 * is not quite a guarantee: `expire` is what happens after a week with NO
 * traffic, and then the next request regenerates SYNCHRONOUSLY (cacheLife.md
 * :109-125). At the crawl rate measured above a quiet week is conceivable, so
 * the accurate claim is: no crawler waits as long as this file is requested at
 * least once a week, or a production deploy lands inside that window — which
 * at the current deploy cadence is every one of them.
 *
 * If something later needs same-day submission of a new URL, add a
 * sitemap-specific tag and ping it from exactly one place. Do not re-attach
 * this to a catalog-wide content tag.
 *
 * ── Size ──────────────────────────────────────────────────────────────────
 *
 * **18,701 URLs / 2.4 MB, MEASURED** off the PR #68 build (Aug 2026) — not
 * derived, and do not re-derive it. The skill-to-URL ratio is not a constant
 * you can multiply by: directory pages saturate as the catalog grows, because
 * ~98% of skills are GitHub repos averaging ~6.8 skills each
 * (convex/freshness.ts). A one-page build of this branch emits 1,323 URLs from
 * 1,000 skills — 1.32x — and the full-catalog ratio is strictly lower than that
 * (~1.17x), since later pages land mostly in orgs and repos already counted.
 * An earlier version of this comment guessed "twice the skill count" and landed
 * ~60% high, which then made both the crawl-time and headroom figures wrong.
 * Re-measure from a production `[sitemap] rows=` log rather than guessing again.
 *
 * At ~130 B/URL (2.4 MB / 18,701) both limits — 50k URLs and 50 MB — are far
 * off; the URL count is the nearer one at ~2.5x of headroom, which agrees with
 * TODO.md's reading that only the catalog PLUS public bundle pages could
 * approach it. `generateSitemaps` is the escape hatch if that day comes, or if
 * per-generation cost (not per request — that's already amortised) becomes the
 * problem.
 */

// 1000 rows/page holds the walk to ~16 round trips at today's catalog size.
//
// On headroom: a `skillSummaries` row bills ~1.3 KB (measured; see the header),
// so a 1000-row page reads ~1.3 MB. Against the 16 MB read budget this repo
// cites at convex/skills.ts:3022 that is ~12x — comfortable, but NOT the "two
// orders of magnitude" this comment claimed before Aug 2026, which was computed
// off a ~200 B row that had drifted 6x. Treat ~12x as the number when deciding
// whether to lower PAGE_SIZE after a SplitRecommended warning below, and note
// it shrinks as rows grow, unlike a page count.
//
// The cap is the same drain backstop the paginated Convex jobs use: enough
// pages to cover a catalog far larger than today's, so hitting it means a
// cursor stopped advancing rather than a catalog that outgrew the number.
const PAGE_SIZE = 1000;
const MAX_PAGES = maxIterForRows(CATALOG_MAX_ROWS, PAGE_SIZE);

// Two pages, not one, outside production. One page would leave cursor threading
// — `continueCursor` feeding the next `fetchQuery` — running for the first time
// on a production build, where a stalled cursor surfaces as a failed deploy with
// green CI and a green preview behind it. Nothing in tests/ or e2e/ covers this
// loader (tests/sitemap-entries.test.ts covers only the pure builder), so the
// preview build is the only canary there is. The second page costs ~1.3 MB and
// buys back the multi-page path; the drain-cap throw stays production-only,
// which is fine — it is a backstop, not a code path anyone should reach.
const NON_PRODUCTION_PAGES = 2;

// Only a production deployment drains the whole catalog. Preview builds and
// local `next build` / `pnpm e2e` runs prerender this route exactly like
// production does — and nothing ever reads what they produce. At ~21 MB of
// Convex bandwidth per walk (see the header) those were ~80% of this route's
// entire cost, on both Convex deployments: previews build against the prod
// Convex URL, and local builds against dev.
//
// A small page count rather than zero, so a preview still serves a real sitemap
// with real rows in it: the XML shape, the `lastmod` derivation and the
// directory roll-up are all reviewable, just over the first 2000 skills instead
// of all of them. An empty file would make a broken sitemap and a correct one
// look identical on every preview URL, which is where anyone would go to check.
//
// Two ways this gate fails SILENTLY, both ending in a truncated sitemap that is
// still well-formed XML, so nothing downstream can tell:
//
//   1. `VERCEL_ENV` goes missing on a production build. It is a Vercel system
//      env var and the project setting that exposes those can be turned off.
//      Note this takes `lib/site-url.ts`'s https-origin guard down with it —
//      same predicate, same blind spot — which is why both now read the shared
//      `IS_PRODUCTION_DEPLOYMENT` and the hazard is documented on it there.
//   2. A deployment BUILT as a preview is later promoted to production. The
//      gate resolves at build time and is baked into the prerendered XML, so
//      the production domain serves the short version, and the build log reads
//      exactly like a healthy preview. It self-heals: `VERCEL_ENV` is not
//      compile-time inlined, so the first background revalidation on the
//      promoted deployment re-reads it as "production" and walks the full
//      catalog. Bounded by `cacheLife("days")`, and harmless at the crawl rate
//      measured above — worth knowing rather than worth engineering against.
//
// The log in `loadSitemapRows` is the trace for (1). Check it after any change
// to the project's environment settings.

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
  // No cacheTag — the header explains why the timer is the right invalidator
  // here and a tag is not.
  cacheLife("days");

  const rows: SitemapSkillRow[] = [];
  let cursor: string | null = null;
  let drained = false;
  let pages = 0;
  const maxPages = IS_PRODUCTION_DEPLOYMENT ? MAX_PAGES : NON_PRODUCTION_PAGES;

  for (; pages < maxPages && !drained; pages++) {
    const page = pages;
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
    drained = result.isDone;
    cursor = result.continueCursor;
  }

  // Hitting the cap without draining is a bug ONLY in production — outside it,
  // the small-page cap is the intended stopping point (see NON_PRODUCTION_PAGES).
  //
  // Throw rather than return what we have: a short sitemap is indistinguishable
  // from a complete one, and because this function is cached, returning would
  // persist the truncation and re-serve it as authoritative, with a single
  // `console.warn` buried in the function logs as the only trace.
  //
  // What throwing costs depends on which phase reached here, and the two are
  // very different. At build time — the path that runs on every deployment —
  // it fails `next build` and blocks the deploy, which is the same fact the
  // SplitRecommended branch above declines to trigger. At runtime it aborts a
  // background revalidation and leaves the previous entry serving until
  // `expire`, after which the regeneration is synchronous and the route 500s.
  // Neither is "the next crawler retries", which is what this comment used to
  // claim.
  if (!drained && IS_PRODUCTION_DEPLOYMENT) {
    throw new Error(
      `[sitemap] stopped at the ${MAX_PAGES}-page cap with ${rows.length} rows; refusing to cache a truncated sitemap`,
    );
  }

  // The one observable trace that the production gate resolved the way it was
  // meant to. A truncated sitemap is well-formed XML, so this line is what
  // separates "prod walked the whole catalog" from "prod quietly took the
  // preview path": expect `env=production pages=16` in a production build's log
  // and `env=preview pages=2` in a preview's.
  console.log(
    `[sitemap] env=${process.env.VERCEL_ENV ?? "local"} pages=${pages} rows=${rows.length}`,
  );
  return rows;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const rows = await loadSitemapRows();
  return buildSitemapEntries(rows, SITE_URL);
}
