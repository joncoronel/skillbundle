/**
 * Minimal REST client for our self-hosted Typesense (Railway).
 *
 * Transport only — no Convex imports here, so it stays a plain module the sync
 * actions can call. Uses `fetch` (Convex default runtime), mirroring the
 * skills.sh client in skillsApi.ts.
 *
 * Env (set on the Convex deployment, NOT Vercel — the admin key is secret):
 *   TYPESENSE_HOST           e.g. "typesense-production-0c4a.up.railway.app"
 *   TYPESENSE_ADMIN_API_KEY  the admin key from Railway (full read/write)
 *   TYPESENSE_COLLECTION     optional; defaults to "skills". Set to
 *                            "skills_dev" on the dev deployment so dev testing
 *                            doesn't write into the collection prod serves.
 *
 * Railway fronts Typesense with HTTPS on 443, so host + https is all we need.
 */

export interface TypesenseConfig {
  host: string;
  apiKey: string;
  collection: string;
}

export function getTypesenseConfig(): TypesenseConfig {
  const host = process.env.TYPESENSE_HOST;
  const apiKey = process.env.TYPESENSE_ADMIN_API_KEY;
  if (!host || !apiKey) {
    throw new Error(
      "Typesense not configured: set TYPESENSE_HOST and TYPESENSE_ADMIN_API_KEY " +
        "on the Convex deployment (npx convex env set ...).",
    );
  }
  return {
    host,
    apiKey,
    collection: process.env.TYPESENSE_COLLECTION ?? "skills",
  };
}

export class TypesenseError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "TypesenseError";
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  /** JSON body — stringified and sent as application/json. */
  json?: unknown;
  /** Raw body (e.g. JSONL for /import) — sent verbatim with `contentType`. */
  body?: string;
  contentType?: string;
  /** Extra query string (already-encoded), without the leading "?". */
  query?: string;
}

/**
 * Low-level request against the Typesense REST API. Returns the parsed JSON
 * for JSON responses, or the raw text for JSONL endpoints (/import), which the
 * caller parses line-by-line.
 */
async function tsRequest(
  path: string,
  opts: RequestOptions = {},
): Promise<{ text: string; json: <T>() => T }> {
  const { host, apiKey } = getTypesenseConfig();
  const url = `https://${host}${path}${opts.query ? `?${opts.query}` : ""}`;

  const headers: Record<string, string> = { "X-TYPESENSE-API-KEY": apiKey };
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = opts.contentType ?? "text/plain";
    body = opts.body;
  }

  const res = await fetch(url, { method: opts.method ?? "GET", headers, body });
  const text = await res.text();
  if (!res.ok) {
    throw new TypesenseError(
      res.status,
      `Typesense ${res.status} on ${opts.method ?? "GET"} ${path}: ${text.slice(0, 300)}`,
    );
  }
  return { text, json: <T>() => JSON.parse(text) as T };
}

// ---------------------------------------------------------------------------
// Collection schema
// ---------------------------------------------------------------------------

interface TypesenseField {
  name: string;
  type: string;
  facet?: boolean;
  optional?: boolean;
  index?: boolean;
  sort?: boolean;
}

/**
 * The `skills` collection schema. Mirrors the queryable subset of
 * `skillSummaries`. Field roles:
 *   - search:   name, description
 *   - filters:  source, curatedOwner, isOfficial, isDuplicate,
 *               hasContentFetchError, worstAuditStatus, worstAuditRiskLevel
 *   - facets:   installs (range buckets) + all the filter fields above
 *   - sorts:    installs (default), momentum7d/30d, contentUpdatedAt
 *   - display:  skillId, installRank, copyCount (index:false = stored, not queryable)
 *
 * momentum* and contentUpdatedAt are optional and populated in a later pass
 * (momentum needs the snapshot diff; contentUpdatedAt lives on the heavy
 * `skills` row). Optional fields may be omitted from documents until then.
 */
export function skillsCollectionSchema(name: string) {
  const fields: TypesenseField[] = [
    { name: "name", type: "string" },
    { name: "description", type: "string", optional: true },
    { name: "source", type: "string", facet: true },
    { name: "skillId", type: "string", index: false, optional: true },
    { name: "installs", type: "int32", facet: true },
    { name: "installRank", type: "int32", index: false, optional: true },
    { name: "curatedOwner", type: "string", facet: true, optional: true },
    { name: "isOfficial", type: "bool", facet: true },
    { name: "isDuplicate", type: "bool", facet: true },
    { name: "hasContentFetchError", type: "bool", facet: true },
    { name: "worstAuditStatus", type: "string", facet: true, optional: true },
    { name: "worstAuditRiskLevel", type: "string", facet: true, optional: true },
    { name: "copyCount", type: "int32", index: false, optional: true },
    // Forward-declared sorts, populated in a later sync pass.
    { name: "momentum7d", type: "int32", optional: true },
    { name: "momentum30d", type: "int32", optional: true },
    { name: "contentUpdatedAt", type: "int64", optional: true },
    // Mark-and-sweep stamp: every sync run sets this to its start time on each
    // upserted doc; the sweep then deletes docs left with an older stamp (rows
    // that dropped out of the non-delisted set since the last run).
    { name: "syncedAt", type: "int64", optional: true },
  ];
  return {
    name,
    fields,
    // Used when a search specifies no sort_by. installs is required + numeric.
    default_sorting_field: "installs",
  };
}

/** The document shape we push. Keep in sync with the schema above. */
export interface TypesenseSkillDoc {
  id: string; // `${source}::${skillId}`
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
  momentum7d?: number;
  momentum30d?: number;
  contentUpdatedAt?: number;
  syncedAt?: number;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchParams {
  q: string;
  queryBy?: string; // default: "name,description"
  filterBy?: string;
  sortBy?: string; // e.g. "installs:desc"; omit to use default_sorting_field
  facetBy?: string; // e.g. "isOfficial,worstAuditStatus"
  page?: number;
  perPage?: number;
}

export interface SearchResponse {
  found: number;
  page: number;
  hits: Array<{ document: TypesenseSkillDoc }>;
  facet_counts?: Array<{
    field_name: string;
    counts: Array<{ value: string; count: number }>;
  }>;
}

/** Run a search against the collection. Used server-side; the browser will use
 * a scoped search-only key against the same endpoint (see step 5). */
export async function search(params: SearchParams): Promise<SearchResponse> {
  const { collection } = getTypesenseConfig();
  const qp = new URLSearchParams();
  qp.set("q", params.q);
  qp.set("query_by", params.queryBy ?? "name,description");
  if (params.filterBy) qp.set("filter_by", params.filterBy);
  if (params.sortBy) qp.set("sort_by", params.sortBy);
  if (params.facetBy) qp.set("facet_by", params.facetBy);
  qp.set("page", String(params.page ?? 1));
  qp.set("per_page", String(params.perPage ?? 10));
  const { json } = await tsRequest(
    `/collections/${encodeURIComponent(collection)}/documents/search`,
    { query: qp.toString() },
  );
  return json<SearchResponse>();
}

/**
 * Create a search-only API key. Safe to expose to the browser: it can only
 * hit documents:search, never write or read admin endpoints. Typesense returns
 * the full key value ONLY on creation — capture it now, it can't be retrieved
 * later. Scoped to all collections (`*`) since both our collections
 * (skills / skills_dev) are public catalog data.
 */
export async function createSearchOnlyKey(
  description: string,
): Promise<{ id: number; value: string }> {
  const { json } = await tsRequest("/keys", {
    method: "POST",
    json: { description, actions: ["documents:search"], collections: ["*"] },
  });
  return json<{ id: number; value: string }>();
}

/** GET /health → true when the server is up. */
export async function ping(): Promise<boolean> {
  const { host } = getTypesenseConfig();
  const res = await fetch(`https://${host}/health`);
  if (!res.ok) return false;
  const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
  return body?.ok === true;
}

/** Collection info, including the live indexed document count. */
export async function getCollectionInfo(): Promise<{
  name: string;
  numDocuments: number;
}> {
  const { collection } = getTypesenseConfig();
  const { json } = await tsRequest(`/collections/${encodeURIComponent(collection)}`);
  const info = json<{ name: string; num_documents: number }>();
  return { name: info.name, numDocuments: info.num_documents };
}

export async function collectionExists(name: string): Promise<boolean> {
  try {
    await tsRequest(`/collections/${encodeURIComponent(name)}`);
    return true;
  } catch (e) {
    if (e instanceof TypesenseError && e.status === 404) return false;
    throw e;
  }
}

/** Create the collection if it doesn't exist. Returns true if created. */
export async function ensureCollection(): Promise<{
  created: boolean;
  name: string;
}> {
  const { collection } = getTypesenseConfig();
  if (await collectionExists(collection)) return { created: false, name: collection };
  await tsRequest("/collections", {
    method: "POST",
    json: skillsCollectionSchema(collection),
  });
  return { created: true, name: collection };
}

/** Drop the collection (for a clean rebuild). No-op if it doesn't exist. */
export async function dropCollection(): Promise<void> {
  const { collection } = getTypesenseConfig();
  try {
    await tsRequest(`/collections/${encodeURIComponent(collection)}`, {
      method: "DELETE",
    });
  } catch (e) {
    if (e instanceof TypesenseError && e.status === 404) return;
    throw e;
  }
}

/**
 * Bulk upsert documents via the /import endpoint (JSONL). Returns the count of
 * failed rows plus their error lines (Typesense reports per-document success in
 * the JSONL response; a 200 overall can still contain individual failures).
 */
export async function importDocuments(
  docs: TypesenseSkillDoc[],
): Promise<{ imported: number; failed: number; errors: string[] }> {
  if (docs.length === 0) return { imported: 0, failed: 0, errors: [] };
  const { collection } = getTypesenseConfig();
  const jsonl = docs.map((d) => JSON.stringify(d)).join("\n");
  const { text } = await tsRequest(
    `/collections/${encodeURIComponent(collection)}/documents/import`,
    { method: "POST", body: jsonl, contentType: "text/plain", query: "action=upsert" },
  );
  let failed = 0;
  const errors: string[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const result = JSON.parse(line) as { success: boolean; error?: string };
    if (!result.success) {
      failed++;
      if (errors.length < 5 && result.error) errors.push(result.error);
    }
  }
  return { imported: docs.length - failed, failed, errors };
}

/**
 * Delete every document matching a Typesense `filter_by` expression.
 * Returns the number of documents removed. Used by the sync sweep
 * (`syncedAt:<runStart`) to drop rows that left the non-delisted set.
 */
export async function deleteByFilter(filterBy: string): Promise<number> {
  const { collection } = getTypesenseConfig();
  const { json } = await tsRequest(
    `/collections/${encodeURIComponent(collection)}/documents`,
    { method: "DELETE", query: `filter_by=${encodeURIComponent(filterBy)}` },
  );
  return json<{ num_deleted: number }>().num_deleted;
}
