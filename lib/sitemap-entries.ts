import type { MetadataRoute } from "next";
import { isSafeCommandSkillId, isSafeCommandSource } from "@/lib/install-commands";
import {
  isGitHubSource,
  ownerHref,
  skillHref,
  sourceHref,
} from "@/lib/skill-urls";

/**
 * Turns the flat skill list into the full URL set for `app/sitemap.ts`.
 *
 * Pure and separate from the route so it can be unit-tested without a Convex
 * deployment (`tests/sitemap-entries.test.ts`) — the route itself is then just
 * "fetch rows, call this, done".
 *
 * ── Why the directory pages are derived, not queried ──────────────────────
 *
 * `/[org]`, `/[org]/[repo]` and `/site/[source]` have no rows of their own:
 * each one is a view over the skills that share a `source` prefix. So they're
 * rolled up from the skill list rather than fetched, which keeps the whole
 * sitemap on one catalog walk and — more importantly — makes it impossible for
 * a directory URL to appear whose page would render empty.
 *
 * Paths come from `lib/skill-urls.ts` rather than being rebuilt here. That file
 * asks callers not to hard-code the shape, and the `/site/` rule living in two
 * places is exactly how the two drift.
 *
 * ── What is excluded, and why exclusion beats escaping ────────────────────
 *
 * A sitemap is a claim that these URLs resolve. Google reports one that doesn't
 * as "Submitted URL not found (404)" against the whole file, so an entry that
 * cannot resolve is worse than a missing one. Two classes cannot:
 *
 *   1. **Slugs the routes reject.** Both skill pages call
 *      `buildSkillInstallCommand` and `notFound()` on null
 *      (`app/(main)/[org]/[repo]/[skillId]/page.tsx`), so
 *      `isSafeCommandSource` + `isSafeCommandSkillId` ARE the routing
 *      predicate, not merely a shell-safety one. The catalog really carries
 *      these: 126 rows as of Aug 2026, slugs holding `:` or `&`, plus four
 *      with an embedded `/` that would emit a 4-segment path matching no
 *      route at all. Percent-encoding makes those emittable, not reachable —
 *      Next decodes params, so `react%3Acomponents` arrives as
 *      `react:components` and 404s exactly as the raw form would.
 *   2. **Sources whose org collides with one of our own root routes.** The
 *      catalog contains an org literally named `api`, and `app/robots.ts`
 *      disallows `/api/` — so those URLs were being submitted and forbidden at
 *      the same time. See `RESERVED_ROOT_SEGMENTS`.
 *
 * `encodeURIComponent` stays on every segment underneath both filters. Next
 * interpolates `url` into `<loc>` with NO XML escaping (verified in
 * `next/dist/build/webpack/loaders/metadata/resolve-route-data.js`), so a
 * stray `&` would invalidate the entire file rather than one entry. That is
 * defence in depth for a case the filters should already have removed.
 *
 * ── `lastModified` ────────────────────────────────────────────────────────
 *
 * `contentUpdatedAt` is the honest answer: the last time the SKILL.md actually
 * moved. It is only written by a fetch that found the hash changed, though, so
 * a skill whose file has sat still since ingest has none — most of the catalog.
 * Shipping ~9.5k URLs with no `lastmod` would leave nothing for a crawler to
 * act on, so `contentFetchedAt` (the last time we READ the file) stands in
 * where it is a sound proxy, i.e. where "we read this at T and have detected no
 * change since" is true. `lastChangedAt` below carries the three cases where it
 * is NOT, each of which would tick a `lastmod` for a file that never moved.
 *
 * A directory page's content is its children, so its `lastmod` is the newest
 * among them. A skill with no trustworthy timestamp contributes nothing and
 * gets no `lastmod` of its own: an omitted `lastmod` tells a crawler "decide
 * for yourself", which is right, while a guessed one is a lie it will cache.
 */

export type SitemapSkillRow = {
  source: string;
  skillId: string;
  contentUpdatedAt?: number;
  contentFetchedAt?: number;
  hasContentFetchError?: boolean;
  hasSkillMdUrl?: boolean;
};

/**
 * Root path segments a GitHub org may not occupy in the sitemap.
 *
 * `/[org]` is a root-level catch-all, so an org slug and one of our own routes
 * are the same URL, and ours wins. `app/robots.ts` documents the mirror image
 * of this hazard for robots.txt prefixes, and `proxy.ts` for the Clerk matcher;
 * this is the third face of it. Two reasons a segment is listed:
 *
 *   - **robots.txt forbids everything under it** (`/api/`, `/dashboard/`,
 *     `/settings/`, `/dev/`, `/sign-in/`, `/sign-up/`). Submitting a URL our
 *     own robots.txt disallows is the one thing TODO.md called worse than
 *     omitting it. Only `api` exists in the catalog today (10 URLs), but it
 *     exists, which is why this is a filter and not a comment.
 *   - **one of our pages already answers there** (`add`, `pricing`, `compare`,
 *     `official`, `bundle`, `site`). `/site/` is the worst of these: it is the
 *     whole well-known-source namespace, so an org named `site` would collide
 *     at every depth rather than just at the root.
 *
 * Whole rows are dropped rather than just the colliding org entry. Some deeper
 * URLs under a shadowed org would technically still resolve (`/add/repo/skill`
 * has no static route to lose to), but that reasoning is per-route and would
 * rot the first time someone adds a page. An ambiguous namespace is not worth
 * submitting.
 *
 * `tests/sitemap-entries.test.ts` asserts this covers every prefix
 * `app/robots.ts` disallows, so a new rule there fails the test rather than
 * silently contradicting the sitemap.
 */
export const RESERVED_ROOT_SEGMENTS: ReadonlySet<string> = new Set([
  "api",
  "dashboard",
  "settings",
  "dev",
  "sign-in",
  "sign-up",
  "add",
  "pricing",
  "compare",
  "official",
  "bundle",
  "site",
]);

/**
 * Pages with no catalog data behind them. No `lastModified`: their content is
 * this repo's source, so the only honest value would be a deploy timestamp,
 * and a build-time `new Date()` would mark them modified on every unrelated
 * deploy. `/compare` appears in its bare form only, never with the `?skills=`
 * query `app/robots.ts` disallows.
 */
const STATIC_PATHS = ["/add", "/pricing", "/compare"] as const;

/**
 * Listing pages whose content IS the catalog, so they inherit its newest
 * change: the home page's rails and the curated directory.
 */
const CATALOG_ROOT_PATHS = ["/", "/official"] as const;

function absoluteUrl(baseUrl: string, path: string): string {
  const encoded = path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return encoded ? `${baseUrl}/${encoded}` : baseUrl;
}

/** `undefined` unless at least one input had a value — see `lastModified` above. */
function newest(a: number | undefined, b: number | undefined) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

function orgOf(source: string): string {
  return source.slice(0, source.indexOf("/"));
}

/** Would this row's skill page actually render? See "What is excluded" above. */
function isRoutable(source: string, skillId: string): boolean {
  if (!isSafeCommandSource(source) || !isSafeCommandSkillId(skillId)) {
    return false;
  }
  // Well-known sources live under `/site/`, a namespace of ours by
  // construction, and their dotted domains cannot equal a reserved slug. But
  // `isGitHubSource` calls anything dotted well-known, including a two-part
  // `docs.example.com/x`, which `skillHref` would render as the 4-segment
  // `/site/docs.example.com/x/<skillId>` — no route matches that, the same
  // class of dead URL the checks above exist to remove. Nothing in the catalog
  // has that shape today; this is the guard that keeps it that way.
  if (!isGitHubSource(source)) return !source.includes("/");
  return !RESERVED_ROOT_SEGMENTS.has(orgOf(source).toLowerCase());
}

/**
 * The timestamp to advertise, or `undefined` to advertise none.
 *
 * The three cases where `contentFetchedAt` is NOT evidence the file is
 * unchanged — each would advertise a change that never happened, the failure
 * the fallback exists to avoid:
 *
 *   1. **Well-known sources.** They have no tree to walk, so
 *      `WELL_KNOWN_CONTENT_REFRESH_MS` re-fetches all ~170 of them DAILY
 *      (convex/skills.ts) and the unchanged-hash path still stamps
 *      `contentFetchedAt`. Their `lastmod` would tick every single day, and
 *      roll up onto every `/site/[source]` page with it. The 30-day
 *      `markStaleContent` backstop that makes this proxy sound applies only to
 *      the GitHub branch.
 *   2. **Rows erroring right now.** `markContentFetchFailed` stamps
 *      `contentFetchedAt` on both of its branches, so a failed read looks
 *      exactly like a successful one.
 *   3. **Rows that never had a SKILL.md URL.** Same stamp, and nothing was
 *      ever read.
 */
function lastChangedAt(row: SitemapSkillRow): number | undefined {
  if (row.contentUpdatedAt !== undefined) return row.contentUpdatedAt;
  if (!isGitHubSource(row.source)) return undefined;
  if (row.hasContentFetchError) return undefined;
  if (row.hasSkillMdUrl === false) return undefined;
  return row.contentFetchedAt;
}

export function buildSitemapEntries(
  rows: readonly SitemapSkillRow[],
  baseUrl: string,
): MetadataRoute.Sitemap {
  // Keyed on the finished path, so the `/site/` decision is made once per row
  // by `lib/skill-urls.ts` and never re-derived. Insertion order is the
  // caller's, and Map preserves it.
  const sourcePaths = new Map<string, number | undefined>();
  const orgPaths = new Map<string, number | undefined>();
  let catalogLastModified: number | undefined;

  const skillEntries: MetadataRoute.Sitemap = [];

  const entry = (path: string, lastModified: number | undefined) => ({
    url: absoluteUrl(baseUrl, path),
    ...(lastModified === undefined
      ? {}
      : { lastModified: new Date(lastModified) }),
  });

  for (const row of rows) {
    const { source, skillId } = row;
    if (!isRoutable(source, skillId)) continue;

    const changedAt = lastChangedAt(row);
    skillEntries.push(entry(skillHref(source, skillId), changedAt));

    const sourcePath = sourceHref(source);
    sourcePaths.set(sourcePath, newest(sourcePaths.get(sourcePath), changedAt));
    if (isGitHubSource(source)) {
      const orgPath = ownerHref(orgOf(source));
      orgPaths.set(orgPath, newest(orgPaths.get(orgPath), changedAt));
    }
    catalogLastModified = newest(catalogLastModified, changedAt);
  }

  return [
    ...CATALOG_ROOT_PATHS.map((path) => entry(path, catalogLastModified)),
    ...STATIC_PATHS.map((path) => entry(path, undefined)),
    ...[...orgPaths].map(([path, lastModified]) => entry(path, lastModified)),
    ...[...sourcePaths].map(([path, lastModified]) => entry(path, lastModified)),
    ...skillEntries,
  ];
}
