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
  /**
   * Set when the literal query has exact matches in the catalog (baseline
   * filters only) but the active narrowing filters exclude EVERY one of
   * them. In that state the engine's whole response is typo-corrected
   * fallback: Typesense decides "no exact results, escalate to typos" AFTER
   * filter_by, so a real word whose matches are all filtered out gets
   * silently swapped for its edit-distance neighbors (query "hero" +
   * Official → "zero" skills). A set verdict therefore comes with `hits`,
   * `found`, and `facets` EMPTY — the fabricated response is disowned at the
   * source, so a consumer that ignores this field degrades to an honest
   * generic empty state instead of re-shipping the fabricated results.
   * Render a filtered-to-empty state from the verdict's own fields (see
   * HiddenByFilters on why not from live UI state).
   *
   * A genuinely typo'd query ("naxt") never sets this — it has no exact
   * matches for filters to hide — so typo correction keeps working under
   * filters. Probed only on page 1 of a query search with narrowing filters;
   * undefined everywhere else (including probe transport failures, where we
   * fall back to trusting the engine's results).
   */
  hiddenByFilters?: HiddenByFilters;
}

/**
 * The filtered-to-empty verdict (see SkillSearchResult.hiddenByFilters). It
 * snapshots the state it was computed FOR: under keepPreviousData a previous
 * key's verdict renders (dimmed) while the live query/filter props are
 * already ahead of it, so empty-state copy built from live state would
 * describe a state this verdict knows nothing about. Build the copy from
 * these fields only.
 */
export interface HiddenByFilters {
  /** Exact matches for the literal query under baseline filters alone — what
   *  clearing the narrowing filters reveals. */
  count: number;
  /** The query the verdict was computed for. */
  query: string;
  /** Official was the sole active narrowing filter — picks the copy that
   *  names it (the common toggle case). */
  officialOnly: boolean;
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

// isOfficial feeds the Official toggle's potential count treatment;
// worstAuditStatus feeds the audit select's "pass" count. isDuplicate is NOT
// faceted: the flag is false on 100% of the catalog today (see the hideForks
// note in explorer-state.tsx), so its counts carry no information.
// Field-name accessor tied to the indexed doc shape: a doc-field rename becomes
// a compile error at every filter/facet site instead of a silently-broken query
// string — the client-side counterpart to the server's assertSchemaMirror.
const field = (name: keyof TypesenseSkillDoc): string => name;

const FACET_FIELDS = [
  "isOfficial",
  "worstAuditStatus",
] as const satisfies readonly (keyof TypesenseSkillDoc)[];

function buildFilterBy(filters: SkillFilters = {}): string | undefined {
  const clauses: string[] = [];
  if (filters.officialOnly) clauses.push(`${field("isOfficial")}:true`);
  if (filters.audit === "pass") clauses.push(`${field("worstAuditStatus")}:=pass`);
  if (filters.audit === "nofail") clauses.push(`${field("worstAuditStatus")}:!=fail`);
  if (filters.hideForks) clauses.push(`${field("isDuplicate")}:false`);
  if (filters.excludeBroken) clauses.push(`${field("hasContentFetchError")}:false`);
  if (filters.minInstalls !== undefined)
    clauses.push(`${field("installs")}:>=${filters.minInstalls}`);
  // Backtick-quote string values. These come from the URL (?pub=, source), so
  // strip any backtick first: an unescaped one closes the quote early and
  // malforms the filter, which Typesense 400s — turning "0 results" into the
  // full "Search is unavailable" error card. Owners/sources are slugs, so a
  // backtick is never a legitimate character to drop.
  const quote = (v: string) => `\`${v.replace(/`/g, "")}\``;
  if (filters.source) clauses.push(`${field("source")}:=${quote(filters.source)}`);
  if (filters.owners && filters.owners.length > 0) {
    // Any-of: owner:=[`a`,`b`].
    clauses.push(`${field("owner")}:=[${filters.owners.map(quote).join(",")}]`);
  }
  return clauses.length > 0 ? clauses.join(" && ") : undefined;
}

/**
 * Which filters narrow beyond the catalog baseline — THE enumeration of the
 * narrowing set; everything else derives from it (probe gating and the
 * verdict's officialOnly here, and the explorer's "Show all N matches"
 * action resets the same set — see clearSheetFilters in explorer-state.tsx).
 * `hideForks` is NOT narrowing: it's the always-on default every catalog
 * surface applies (and matches the entire catalog today — see
 * explorer-state.tsx), so it belongs on BOTH sides of the hidden-by-filters
 * comparison rather than triggering probes by itself.
 */
function activeNarrowingKeys(filters: SkillFilters = {}): (keyof SkillFilters)[] {
  const keys: (keyof SkillFilters)[] = [];
  if (filters.officialOnly) keys.push("officialOnly");
  if (filters.audit) keys.push("audit");
  if (filters.excludeBroken) keys.push("excludeBroken");
  if (filters.minInstalls !== undefined) keys.push("minInstalls");
  if (filters.source) keys.push("source");
  if (filters.owners !== undefined && filters.owners.length > 0)
    keys.push("owners");
  return keys;
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
function buildSortBy(sort: SkillSort | undefined, hasQuery: boolean): string {
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
    // The wire document is the synced doc as indexed — syncedAt included,
    // nameHighlight (a search-time construct) never present. SkillHit is
    // built from it explicitly below.
    document: TypesenseSkillDoc;
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

/** Search parameters as a plain record — serializable to a GET query string
 *  (tsSearch) or embedded in a multi_search body (tsMultiSearch) unchanged. */
type TsParams = Record<string, string>;

/**
 * Shared transport for the single-search endpoints: one search request against
 * the configured collection with the search-only key, throwing on config or
 * HTTP errors (callers are React Query queryFns — they surface it).
 */
async function tsSearch(
  params: TsParams,
  label: string,
  signal?: AbortSignal,
): Promise<RawSearchResponse> {
  const { host, searchKey, collection } = requireConfig();
  const url =
    `https://${host}/collections/${encodeURIComponent(collection)}` +
    `/documents/search?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, {
    headers: { "X-TYPESENSE-API-KEY": searchKey },
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Typesense ${label} ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as RawSearchResponse;
}

/** A failed entry in a multi_search response — Typesense returns HTTP 200 for
 *  the batch and reports per-search failures inline. */
interface RawSearchError {
  code: number;
  error: string;
}

function isSearchError(
  r: RawSearchResponse | RawSearchError,
): r is RawSearchError {
  return "error" in r;
}

/**
 * Batched transport: N searches in ONE request via Typesense's multi_search
 * endpoint (same search-only key). Used when a catalog search carries its
 * honest-fallback probes, so the extra queries cost no extra round trip.
 * Throws on config/HTTP errors — a batch-level failure fails the whole
 * request, exactly as it would on the single-search path (same host, same
 * key; no fallback). Per-search failures come back inline as RawSearchError
 * entries for the caller to triage: a probe that errors individually loses
 * its verdict, not the search it rides with.
 */
async function tsMultiSearch(
  searches: TsParams[],
  label: string,
  signal?: AbortSignal,
): Promise<Array<RawSearchResponse | RawSearchError>> {
  const { host, searchKey, collection } = requireConfig();
  const res = await fetch(`https://${host}/multi_search`, {
    method: "POST",
    headers: {
      "X-TYPESENSE-API-KEY": searchKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      searches: searches.map((s) => ({ collection, ...s })),
    }),
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Typesense ${label} ${res.status}: ${body.slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    results: Array<RawSearchResponse | RawSearchError>;
  };
  return body.results;
}

/**
 * Run a catalog search / browse against Typesense. Throws if the engine isn't
 * configured or the request fails — callers (a React Query queryFn) surface it.
 */
export async function searchSkills(args: SkillSearchArgs): Promise<SkillSearchResult> {
  const query = args.query?.trim() ?? "";
  const hasQuery = query.length > 0;
  const page = args.page ?? 1;

  const params: TsParams = {
    q: hasQuery ? query : "*", // "*" = match-all for browse
  };
  if (args.searchDescriptions) {
    params.query_by = "name,description";
    // Name matches outrank description matches (see docs/search-overhaul.md).
    params.query_by_weights = "3,1";
  } else {
    // Default: names only — tighter, more precise matches.
    params.query_by = "name";
  }
  if (hasQuery) {
    // Highlight the full `name` (it's short, so no snippet windowing) so the UI
    // can mark matched tokens — fuzzy-aware, straight from the engine. Browse
    // (`*`) needs no highlight; omitting it there avoids a whole-name mark.
    params.highlight_full_fields = "name";
  }
  params.page = String(page);
  params.per_page = String(args.perPage ?? 30);

  const filterBy = buildFilterBy(args.filters);
  if (filterBy) params.filter_by = filterBy;

  // Always present (every catalog sort maps to a sort_by).
  params.sort_by = buildSortBy(args.sort, hasQuery);

  if (args.facets) params.facet_by = FACET_FIELDS.join(",");

  // Honest-fallback probes (see SkillSearchResult.hiddenByFilters). Typesense
  // escalates to typo matching when the FILTERED exact-match set is empty, so
  // a narrowed query search can't tell "this word doesn't exist" (typo
  // correction welcome) from "this word exists but the filters hid it" (typo
  // correction fabricates a disjoint result set). Two count-only exact twins
  // of the main query — one narrowed, one baseline — make that call, batched
  // into the SAME request via multi_search so they cost no extra round trip.
  // Page 1 only: the verdict can't change with the page (same rationale as
  // the facets fetch in use-catalog-search).
  const narrowingKeys = activeNarrowingKeys(args.filters);
  let raw: RawSearchResponse;
  let hiddenByFilters: HiddenByFilters | undefined;
  if (hasQuery && page === 1 && narrowingKeys.length > 0) {
    const probeBase: TsParams = {
      q: query,
      // Mirror the main query's matching scope exactly — the probes answer
      // "would THIS search have exact matches", not some other search's.
      query_by: params.query_by,
      num_typos: "0",
      per_page: "0", // count-only: `found` is all we read
    };
    if (params.query_by_weights)
      probeBase.query_by_weights = params.query_by_weights;

    const narrowedProbe: TsParams = { ...probeBase };
    if (filterBy) narrowedProbe.filter_by = filterBy;

    // Baseline = the catalog's always-on defaults only (hideForks), so the
    // count matches what clearing the narrowing filters would reveal.
    const baselineFilterBy = buildFilterBy({
      hideForks: args.filters?.hideForks,
    });
    const baselineProbe: TsParams = { ...probeBase };
    if (baselineFilterBy) baselineProbe.filter_by = baselineFilterBy;

    const [main, narrowed, baseline] = await tsMultiSearch(
      [params, narrowedProbe, baselineProbe],
      "search",
      args.signal,
    );
    // Shape guard first: a short/malformed batch must surface as the labeled
    // error below, not as an `in`-operator TypeError inside isSearchError.
    if (main === undefined) {
      throw new Error("Typesense search: malformed multi_search response");
    }
    if (isSearchError(main)) {
      throw new Error(`Typesense search ${main.code}: ${main.error}`);
    }
    raw = main;
    // Probe failures degrade gracefully: no verdict, trust the main results.
    if (
      narrowed !== undefined &&
      baseline !== undefined &&
      !isSearchError(narrowed) &&
      !isSearchError(baseline) &&
      narrowed.found === 0 &&
      baseline.found > 0
    ) {
      hiddenByFilters = {
        count: baseline.found,
        // Snapshot the state the verdict was computed FOR — the empty state
        // renders these even when it's a previous key's data showing dimmed
        // under keepPreviousData (see HiddenByFilters).
        query,
        officialOnly:
          narrowingKeys.length === 1 && narrowingKeys[0] === "officialOnly",
      };
    }
  } else {
    raw = await tsSearch(params, "search", args.signal);
  }

  // A set verdict DISOWNS the engine's response: the hits are typo fallback
  // for a word the filters hid (never render them), the facet counts were
  // computed over that same fabricated set (never let them drive the filter
  // controls), and a real `found` would keep pagination alive for rows no one
  // shows. Returning them empty makes naive consumption fail honest.
  if (hiddenByFilters) {
    return { found: 0, page: raw.page, hits: [], facets: {}, hiddenByFilters };
  }

  const facets: Record<string, FacetCount[]> = {};
  for (const f of raw.facet_counts ?? []) facets[f.field_name] = f.counts;

  return {
    found: raw.found,
    page: raw.page,
    hits: (raw.hits ?? []).map((h) => {
      // Strip the mark-and-sweep bookkeeping stamp so rows carry only the
      // catalog fields SkillHit declares.
      const { syncedAt, ...doc } = h.document;
      void syncedAt;
      return { ...doc, nameHighlight: readNameHighlight(h) };
    }),
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
  const query = opts.query?.trim();
  const params: TsParams = {
    q: "*",
    query_by: "name", // required, but per_page=0 returns no hits
    per_page: "0",
    facet_by: "owner",
    max_facet_values: String(opts.limit ?? 250),
    filter_by: "isDuplicate:false", // parity with the catalog default
  };
  // Typeahead: narrow the returned facet values to those matching the input.
  if (query) params.facet_query = `owner:${query}`;

  const raw = await tsSearch(params, "facet", opts.signal);
  const counts =
    raw.facet_counts?.find((f) => f.field_name === "owner")?.counts ?? [];
  return counts.map((c) => ({ value: c.value, count: c.count }));
}
