/**
 * Browser-direct Typesense search client.
 *
 * Reads the NEXT_PUBLIC_TYPESENSE_* vars and queries the search endpoint with a
 * search-only key, so search traffic (queries + results) goes browser → Railway
 * → browser and never touches a Vercel function. See docs/search-overhaul.md.
 *
 * The search key is search-only (documents:search); exposing it client-side is
 * expected and safe. This module is transport + query building only — the app's
 * filter/sort UI composes SkillSearchArgs; the mapping to Typesense params lives
 * here so the rest of the app stays engine-agnostic.
 */

import type { TypesenseSkillDoc } from "@/convex/lib/typesense";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HOST = process.env.NEXT_PUBLIC_TYPESENSE_HOST;
const SEARCH_KEY = process.env.NEXT_PUBLIC_TYPESENSE_SEARCH_KEY;
// The "skills" default only applies in production builds. Dev must set
// NEXT_PUBLIC_TYPESENSE_COLLECTION explicitly (e.g. "skills_dev") — a silent
// fallback here would point a misconfigured dev browser at the prod index.
// Vercel PREVIEW builds also run NODE_ENV=production and thus inherit the
// prod default — deliberate: previews should search the real (public,
// read-only) catalog rather than an empty index. Only local dev, where
// writes to a dev collection happen, needs the isolation.
const COLLECTION =
  process.env.NEXT_PUBLIC_TYPESENSE_COLLECTION ??
  (process.env.NODE_ENV === "production" ? "skills" : undefined);

function requireConfig(): { host: string; searchKey: string; collection: string } {
  if (!HOST || !SEARCH_KEY || !COLLECTION) {
    throw new Error(
      "Typesense is not configured (NEXT_PUBLIC_TYPESENSE_HOST / _SEARCH_KEY " +
        "/ _COLLECTION — the collection default applies only in production).",
    );
  }
  return { host: HOST, searchKey: SEARCH_KEY, collection: COLLECTION };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A search hit: the synced document (type derived from the sync pipeline's own
 * validator, so this can't drift from what's actually indexed) minus the
 * mark-and-sweep bookkeeping stamp, plus the search-time highlight.
 */
export interface SkillHit extends Omit<TypesenseSkillDoc, "syncedAt"> {
  /**
   * Typesense's highlight of `name`: the field value with matched tokens wrapped
   * in `<mark>…</mark>`. Present only on query searches (not browse). It's
   * fuzzy-aware — a typo'd query still marks the corrected token — so we render
   * this rather than re-marking the query client-side. Parse via
   * `renderHighlight` (never innerHTML). Undefined = show the plain name.
   */
  nameHighlight?: string;
}

export interface FacetCount {
  value: string;
  count: number;
}

export interface SkillSearchResult {
  found: number;
  page: number;
  hits: SkillHit[];
  /** Facet counts keyed by field name (only present when `facets` requested). */
  facets: Record<string, FacetCount[]>;
}

/**
 * Catalog sorts. All map to per-skill fields so they compose with any query.
 * "recent" (contentUpdatedAt) and "rising" (momentum7d) join once the sync
 * populates those fields — adding them earlier would sort on data no document
 * has yet.
 */
export type SkillSort = "relevance" | "installs";

export interface SkillFilters {
  /** Only curated/official skills. */
  officialOnly?: boolean;
  /**
   * Audit narrowing: "pass" = passed audits only; "nofail" = anything except
   * a failed verdict (pass/warn/unknown all allowed).
   */
  audit?: "pass" | "nofail";
  /** Hide forks/copies (defaults handled by the caller). */
  hideForks?: boolean;
  /** Drop skills whose SKILL.md fetch failed (install command may break). */
  excludeBroken?: boolean;
  /** Minimum lifetime install count. */
  minInstalls?: number;
  /** Restrict to one publisher ("owner/repo" or "owner"). Exact match. */
  source?: string;
  /** Restrict to any of these publisher owners (slug before "/" in source). */
  owners?: string[];
}

/** A publisher (owner) and how many skills it has, for the Publisher picker. */
export interface OwnerCount {
  value: string;
  count: number;
}

export interface SkillSearchArgs {
  /** Text query; "" (or omitted) = browse the whole catalog. */
  query?: string;
  sort?: SkillSort;
  filters?: SkillFilters;
  /** Also match on `description` (default: names only). */
  searchDescriptions?: boolean;
  page?: number;
  perPage?: number;
  /** Request facet counts for the filter fields (for sidebar counts). */
  facets?: boolean;
  /** Cancels a stale in-flight request (React Query passes its queryFn signal
   *  through here, so superseded keystrokes abort instead of racing). */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

const FACET_FIELDS = ["isOfficial", "worstAuditStatus", "isDuplicate"] as const;

function buildFilterBy(filters: SkillFilters = {}): string | undefined {
  const clauses: string[] = [];
  if (filters.officialOnly) clauses.push("isOfficial:true");
  if (filters.audit === "pass") clauses.push("worstAuditStatus:=pass");
  if (filters.audit === "nofail") clauses.push("worstAuditStatus:!=fail");
  if (filters.hideForks) clauses.push("isDuplicate:false");
  if (filters.excludeBroken) clauses.push("hasContentFetchError:false");
  if (filters.minInstalls !== undefined) clauses.push(`installs:>=${filters.minInstalls}`);
  // Backtick-quote string values (sources/owners are simple slugs, but this is
  // robust to any that aren't — and keeps the two clauses' escaping consistent).
  if (filters.source) clauses.push(`source:=\`${filters.source}\``);
  if (filters.owners && filters.owners.length > 0) {
    // Any-of: `owner:=[`a`,`b`]`.
    const list = filters.owners.map((o) => `\`${o}\``).join(",");
    clauses.push(`owner:=[${list}]`);
  }
  return clauses.length > 0 ? clauses.join(" && ") : undefined;
}

// Trust tie-breaker for the relevance ranking: among equally-relevant matches
// (`_text_match` ties constantly), float official + audit-passed skills up, then
// by installs. Weighted `_eval` — official worth 2, passed audit worth 1, summed
// — so it only orders ties that were already arbitrary; it never reorders across
// relevance bands. Query path only (browsing is installs:desc, which rarely
// ties). Kept to Typesense's 3-sort-field limit: text_match, _eval, installs.
const RELEVANCE_SORT_BY =
  "_text_match:desc," +
  "_eval([(isOfficial:true):2,(worstAuditStatus:=pass):1]):desc," +
  "installs:desc";

/**
 * Map a catalog sort to a Typesense sort_by. `relevance` uses text ranking with
 * a trust tie-breaker when a query is present, but falls back to installs when
 * browsing (relevance is meaningless with no query / a match-all `*`).
 */
function buildSortBy(sort: SkillSort | undefined, hasQuery: boolean): string | undefined {
  switch (sort) {
    case "installs":
      return "installs:desc";
    case "relevance":
    case undefined:
      return hasQuery ? RELEVANCE_SORT_BY : "installs:desc";
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

interface RawHighlight {
  field: string;
  value?: string;
}

interface RawSearchResponse {
  found: number;
  page: number;
  hits?: Array<{
    document: SkillHit;
    // Newer Typesense returns `highlight` (keyed by field); older, `highlights`
    // (an array). We read whichever is present.
    highlight?: Record<string, { value?: string }>;
    highlights?: RawHighlight[];
  }>;
  facet_counts?: Array<{
    field_name: string;
    counts: Array<{ value: string; count: number }>;
  }>;
}

function readNameHighlight(h: {
  highlight?: Record<string, { value?: string }>;
  highlights?: RawHighlight[];
}): string | undefined {
  return (
    h.highlight?.name?.value ??
    h.highlights?.find((x) => x.field === "name")?.value
  );
}

/**
 * Run a catalog search / browse against Typesense. Throws if the engine isn't
 * configured or the request fails — callers (a React Query queryFn) surface it.
 */
export async function searchSkills(args: SkillSearchArgs): Promise<SkillSearchResult> {
  const { host, searchKey, collection } = requireConfig();

  const query = args.query?.trim() ?? "";
  const hasQuery = query.length > 0;

  const params = new URLSearchParams();
  params.set("q", hasQuery ? query : "*"); // "*" = match-all for browse
  if (args.searchDescriptions) {
    params.set("query_by", "name,description");
    // Name matches outrank description matches (see docs/search-overhaul.md).
    params.set("query_by_weights", "3,1");
  } else {
    // Default: names only — tighter, more precise matches.
    params.set("query_by", "name");
  }
  if (hasQuery) {
    // Highlight the full `name` (it's short, so no snippet windowing) so the UI
    // can mark matched tokens — fuzzy-aware, straight from the engine. Browse
    // (`*`) needs no highlight; omitting it there avoids a whole-name mark.
    params.set("highlight_full_fields", "name");
  }
  params.set("page", String(args.page ?? 1));
  params.set("per_page", String(args.perPage ?? 30));

  const filterBy = buildFilterBy(args.filters);
  if (filterBy) params.set("filter_by", filterBy);

  const sortBy = buildSortBy(args.sort, hasQuery);
  if (sortBy) params.set("sort_by", sortBy);

  if (args.facets) params.set("facet_by", FACET_FIELDS.join(","));

  const url =
    `https://${host}/collections/${encodeURIComponent(collection)}` +
    `/documents/search?${params.toString()}`;

  const res = await fetch(url, {
    headers: { "X-TYPESENSE-API-KEY": searchKey },
    signal: args.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Typesense search ${res.status}: ${body.slice(0, 200)}`);
  }

  const raw = (await res.json()) as RawSearchResponse;
  const facets: Record<string, FacetCount[]> = {};
  for (const f of raw.facet_counts ?? []) facets[f.field_name] = f.counts;

  return {
    found: raw.found,
    page: raw.page,
    hits: (raw.hits ?? []).map((h) => ({
      ...h.document,
      nameHighlight: readNameHighlight(h),
    })),
    facets,
  };
}

/**
 * Publishers (owners) for the Publisher picker, as a facet-only request
 * (`per_page=0`), ordered by skill count. With no `query` this returns the top
 * owners (browse-on-open); with a `query` it runs a `facet_query` so *any*
 * owner is reachable by typing, not just the top slice. `signal` lets the caller
 * cancel a stale in-flight lookup.
 */
export async function listOwners(opts: {
  query?: string;
  limit?: number;
  signal?: AbortSignal;
} = {}): Promise<OwnerCount[]> {
  const { host, searchKey, collection } = requireConfig();
  const query = opts.query?.trim();
  const params = new URLSearchParams();
  params.set("q", "*");
  params.set("query_by", "name"); // required, but per_page=0 returns no hits
  params.set("per_page", "0");
  params.set("facet_by", "owner");
  params.set("max_facet_values", String(opts.limit ?? 250));
  params.set("filter_by", "isDuplicate:false"); // parity with the catalog default
  // Typeahead: narrow the returned facet values to those matching the input.
  if (query) params.set("facet_query", `owner:${query}`);

  const url =
    `https://${host}/collections/${encodeURIComponent(collection)}` +
    `/documents/search?${params.toString()}`;
  const res = await fetch(url, {
    headers: { "X-TYPESENSE-API-KEY": searchKey },
    signal: opts.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Typesense facet ${res.status}: ${body.slice(0, 200)}`);
  }
  const raw = (await res.json()) as RawSearchResponse;
  const counts =
    raw.facet_counts?.find((f) => f.field_name === "owner")?.counts ?? [];
  return counts.map((c) => ({ value: c.value, count: c.count }));
}
