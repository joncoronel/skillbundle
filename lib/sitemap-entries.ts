import type { MetadataRoute } from "next";
import { isGitHubSource } from "@/lib/skill-urls";

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
 * ── `lastModified` ────────────────────────────────────────────────────────
 *
 * Each skill's is `contentUpdatedAt ?? contentFetchedAt` — when the file last
 * moved, falling back to when we last read it. The fallback is not a
 * consolation prize: `contentUpdatedAt` is written only by a fetch that found
 * the hash changed, so a skill whose SKILL.md has sat still since ingest has
 * none, which is most of the catalog. Shipping ~9.5k URLs with no `lastmod`
 * would leave nothing for a crawler to act on — the one thing this file exists
 * to provide. "We read this file at T and have detected no change since" is a
 * sound claim: the daily freshness sweep re-fetches when a blob SHA moves, and
 * that same fetch overwrites both fields. See convex/skills.ts
 * `listSitemapEntries` for the full argument.
 *
 * A directory page's content is its children, so its `lastmod` is the newest
 * among them. A skill with neither timestamp (never successfully
 * content-fetched) contributes nothing and gets no `lastmod` of its own: an
 * omitted `lastmod` tells a crawler "decide for yourself", which is exactly
 * right, while a guessed one is a lie it will cache.
 *
 * ── Escaping ──────────────────────────────────────────────────────────────
 *
 * Next interpolates `url` into `<loc>` raw — no XML escaping anywhere in
 * `next/dist/build/webpack/loaders/metadata/resolve-route-data.js`. So a `&` or
 * `<` reaching a slug would emit malformed XML and invalidate the whole file,
 * not just that entry. Encoding per path segment closes that off: it is the
 * correct URL encoding regardless, and `encodeURIComponent` escapes every
 * character XML treats as markup. Today's slugs are all `[A-Za-z0-9._-]` and
 * pass through untouched.
 */

export type SitemapSkillRow = {
  source: string;
  skillId: string;
  contentUpdatedAt?: number;
  contentFetchedAt?: number;
};

/**
 * Pages with no catalog data behind them. No `lastModified`: their content is
 * this repo's source, so the only honest value would be a deploy timestamp,
 * and a build-time `new Date()` would mark them modified on every unrelated
 * deploy. Everything here must be crawlable per `app/robots.ts` — `/compare`
 * appears in its bare form only, never with the `?skills=` query that file
 * disallows.
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

export function buildSitemapEntries(
  rows: readonly SitemapSkillRow[],
  baseUrl: string,
): MetadataRoute.Sitemap {
  // Insertion order is the caller's order (install-descending), and Map
  // preserves it, so the most-installed org/repo leads its section.
  const sourceLastModified = new Map<string, number | undefined>();
  const orgLastModified = new Map<string, number | undefined>();
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
    const isGitHub = isGitHubSource(source);
    const changedAt = row.contentUpdatedAt ?? row.contentFetchedAt;

    skillEntries.push(
      entry(
        isGitHub ? `${source}/${skillId}` : `site/${source}/${skillId}`,
        changedAt,
      ),
    );

    sourceLastModified.set(
      source,
      newest(sourceLastModified.get(source), changedAt),
    );
    if (isGitHub) {
      const org = source.slice(0, source.indexOf("/"));
      orgLastModified.set(org, newest(orgLastModified.get(org), changedAt));
    }
    catalogLastModified = newest(catalogLastModified, changedAt);
  }

  return [
    ...CATALOG_ROOT_PATHS.map((path) => entry(path, catalogLastModified)),
    ...STATIC_PATHS.map((path) => ({ url: absoluteUrl(baseUrl, path) })),
    ...[...orgLastModified].map(([org, lastModified]) =>
      entry(org, lastModified),
    ),
    ...[...sourceLastModified].map(([source, lastModified]) =>
      entry(isGitHubSource(source) ? source : `site/${source}`, lastModified),
    ),
    ...skillEntries,
  ];
}
