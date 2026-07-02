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

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HOST = process.env.NEXT_PUBLIC_TYPESENSE_HOST;
const SEARCH_KEY = process.env.NEXT_PUBLIC_TYPESENSE_SEARCH_KEY;
const COLLECTION = process.env.NEXT_PUBLIC_TYPESENSE_COLLECTION ?? "skills";

export function isTypesenseConfigured(): boolean {
  return Boolean(HOST && SEARCH_KEY);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A search hit document. Mirrors the fields synced from `skillSummaries`. */
export interface SkillHit {
  id: string;
  name: string;
  description?: string;
  source: string;
  skillId: string;
  installs: number;
  installRank?: number;
  curatedOwner?: string;
  isOfficial: boolean;
  isDuplicate: boolean;
  hasContentFetchError: boolean;
  worstAuditStatus?: string;
  worstAuditRiskLevel?: string;
  copyCount?: number;
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

/** Catalog sorts. All map to per-skill fields so they compose with any query. */
export type SkillSort = "relevance" | "installs" | "recent" | "rising";

export interface SkillFilters {
  /** Only curated/official skills. */
  officialOnly?: boolean;
  /** Restrict to a single audit verdict (e.g. "pass" for "verified safe"). */
  auditStatus?: "pass" | "warn" | "fail" | "unknown";
  /** Hide forks/copies (defaults handled by the caller). */
  hideForks?: boolean;
  /** Drop skills whose SKILL.md fetch failed (install command may break). */
  excludeBroken?: boolean;
  /** Minimum lifetime install count. */
  minInstalls?: number;
  /** Restrict to one publisher ("owner/repo" or "owner"). Exact match. */
  source?: string;
}

export interface SkillSearchArgs {
  /** Text query; "" (or omitted) = browse the whole catalog. */
  query?: string;
  sort?: SkillSort;
  filters?: SkillFilters;
  page?: number;
  perPage?: number;
  /** Request facet counts for the filter fields (for sidebar counts). */
  facets?: boolean;
}

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

const FACET_FIELDS = ["isOfficial", "worstAuditStatus", "isDuplicate"] as const;

function buildFilterBy(filters: SkillFilters = {}): string | undefined {
  const clauses: string[] = [];
  if (filters.officialOnly) clauses.push("isOfficial:true");
  if (filters.auditStatus) clauses.push(`worstAuditStatus:=${filters.auditStatus}`);
  if (filters.hideForks) clauses.push("isDuplicate:false");
  if (filters.excludeBroken) clauses.push("hasContentFetchError:false");
  if (filters.minInstalls !== undefined) clauses.push(`installs:>=${filters.minInstalls}`);
  if (filters.source) clauses.push(`source:=${filters.source}`);
  return clauses.length > 0 ? clauses.join(" && ") : undefined;
}

/**
 * Map a catalog sort to a Typesense sort_by. `relevance` uses the default text
 * ranking when a query is present, but falls back to installs when browsing
 * (relevance is meaningless with no query / a match-all `*`).
 */
function buildSortBy(sort: SkillSort | undefined, hasQuery: boolean): string | undefined {
  switch (sort) {
    case "installs":
      return "installs:desc";
    case "recent":
      return "contentUpdatedAt:desc";
    case "rising":
      return "momentum7d:desc";
    case "relevance":
    case undefined:
      return hasQuery ? undefined : "installs:desc";
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

interface RawSearchResponse {
  found: number;
  page: number;
  hits?: Array<{ document: SkillHit }>;
  facet_counts?: Array<{
    field_name: string;
    counts: Array<{ value: string; count: number }>;
  }>;
}

/**
 * Run a catalog search / browse against Typesense. Throws if the engine isn't
 * configured or the request fails — callers (a React Query queryFn) surface it.
 */
export async function searchSkills(args: SkillSearchArgs): Promise<SkillSearchResult> {
  if (!HOST || !SEARCH_KEY) {
    throw new Error("Typesense is not configured (NEXT_PUBLIC_TYPESENSE_* missing).");
  }

  const query = args.query?.trim() ?? "";
  const hasQuery = query.length > 0;

  const params = new URLSearchParams();
  params.set("q", hasQuery ? query : "*"); // "*" = match-all for browse
  params.set("query_by", "name,description");
  params.set("page", String(args.page ?? 1));
  params.set("per_page", String(args.perPage ?? 30));

  const filterBy = buildFilterBy(args.filters);
  if (filterBy) params.set("filter_by", filterBy);

  const sortBy = buildSortBy(args.sort, hasQuery);
  if (sortBy) params.set("sort_by", sortBy);

  if (args.facets) params.set("facet_by", FACET_FIELDS.join(","));

  const url =
    `https://${HOST}/collections/${encodeURIComponent(COLLECTION)}` +
    `/documents/search?${params.toString()}`;

  const res = await fetch(url, { headers: { "X-TYPESENSE-API-KEY": SEARCH_KEY } });
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
    hits: (raw.hits ?? []).map((h) => h.document),
    facets,
  };
}
