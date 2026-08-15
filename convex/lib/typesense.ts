/**
 * Minimal REST client for our self-hosted Typesense (Railway).
 *
 * Transport only — no generated-Convex imports here (only the plain
 * `convex/values` library, for the document validator), so it stays a module
 * the sync actions can call. Uses `fetch` (Convex default runtime), mirroring
 * the skills.sh client in skillsApi.ts.
 *
 * Env (set on the Convex deployment, NOT Vercel — the admin key is secret):
 *   TYPESENSE_HOST           e.g. "typesense-production-0c4a.up.railway.app"
 *   TYPESENSE_ADMIN_API_KEY  the admin key from Railway (full read/write)
 *   TYPESENSE_COLLECTION     REQUIRED on non-production deployments (e.g.
 *                            "skills_dev"); defaults to "skills" only on prod
 *                            (CRONS_ENABLED=true). This client can drop and
 *                            rewrite the collection, so a dev deployment must
 *                            never silently point at the one prod serves.
 *
 * Railway fronts Typesense with HTTPS on 443, so host + https is all we need.
 */

import { v, type Infer } from "convex/values";
// The separator set lives in a dependency-free shared leaf: the browser
// highlight renderer needs the same characters, and a value import of THIS
// module (the admin transport) would put it on the client bundle path.
import { NAME_TOKEN_SEPARATORS } from "../../lib/search/token-separators";

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
  // The "skills" default applies ONLY on the production deployment
  // (CRONS_ENABLED=true, this codebase's prod marker — see crons.ts). This is
  // the WRITE path — sync, resetCollection, dropCollection — so a dev
  // deployment missing TYPESENSE_COLLECTION must fail loudly here rather than
  // silently sync into (or drop) the collection production serves. Mirrors the
  // NODE_ENV gate on the browser read client (lib/search/typesense.ts).
  const collection =
    process.env.TYPESENSE_COLLECTION ??
    (process.env.CRONS_ENABLED === "true" ? "skills" : undefined);
  if (!collection) {
    throw new Error(
      'TYPESENSE_COLLECTION is not set. Set it explicitly (e.g. "skills_dev") on ' +
        'this deployment — the "skills" default applies only in production ' +
        "(CRONS_ENABLED=true), so non-prod deployments can never write to the prod collection.",
    );
  }
  return { host, apiKey, collection };
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
  /** Extra characters (besides space/newline) that split text into tokens. */
  token_separators?: string[];
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
    // Publisher (the "owner" of "owner/repo"), derived from source at sync.
    // Faceted so the Publisher picker can typeahead + count. optional so the
    // field can be added to an existing collection without a destructive reset;
    // the sync always populates it, so filtering/faceting never skips a doc.
    { name: "owner", type: "string", facet: true, optional: true },
    { name: "skillId", type: "string", index: false, optional: true },
    { name: "installs", type: "int32", facet: true },
    { name: "installRank", type: "int32", index: false, optional: true },
    { name: "curatedOwner", type: "string", facet: true, optional: true },
    { name: "isOfficial", type: "bool", facet: true },
    // True for skills added straight from GitHub (not on skills.sh). Faceted
    // so the "Hide GitHub-only skills" filter can exclude them. optional so
    // docs indexed before a backfill don't fail import.
    //
    // DEPLOY NOTE: this schema only applies at collection CREATE time
    // (ensureCollection is create-if-missing; there is no alter path in this
    // codebase). A pre-existing collection doesn't know the field, and a
    // filter_by on a schema-missing field is a Typesense request error — the
    // filter breaks outright, it doesn't just under-match. Adding a field
    // therefore requires, per environment, once:
    //   npx convex run typesense:resetCollection [--prod]
    //   npx convex run typesense:syncCatalog [--prod]
    // (brief empty-index window until the sync refills; run them back to
    // back). Done on dev 2026-07-22; prod tracked in TODO.md.
    { name: "isGitHubOnly", type: "bool", facet: true, optional: true },
    { name: "isDuplicate", type: "bool", facet: true },
    { name: "hasContentFetchError", type: "bool", facet: true },
    { name: "worstAuditStatus", type: "string", facet: true, optional: true },
    {
      name: "worstAuditRiskLevel",
      type: "string",
      facet: true,
      optional: true,
    },
    { name: "copyCount", type: "int32", index: false, optional: true },
    // Forward-declared sorts, populated in a later sync pass.
    { name: "momentum7d", type: "int32", optional: true },
    { name: "momentum30d", type: "int32", optional: true },
    { name: "contentUpdatedAt", type: "int64", optional: true },
    // Mark-and-sweep stamp: every sync run sets this to its start time on each
    // upserted doc; the sweep then deletes docs left with an older stamp (rows
    // that dropped out of the non-delisted set since the last run). Typesense
    // SKIPS docs missing a filtered field, so a doc without the stamp would be
    // permanently unsweepable — the sync stamps every doc unconditionally, and
    // any legacy doc indexed before this field existed self-heals on the next
    // full sync (upserts replace whole docs) as long as it's still live; a
    // dead unstamped doc would need a resetCollection to clear.
    { name: "syncedAt", type: "int64", optional: true },
  ];
  return {
    name,
    fields,
    // Collection-level (NOT field-level): this way the separators apply to both
    // indexing AND query tokenization, so a query like "vercel-compo" splits
    // into ["vercel", "compo"] and matches the split index tokens. Field-level
    // only splits the index, leaving the hyphenated query as one dead token.
    token_separators: NAME_TOKEN_SEPARATORS,
    // Used when a search specifies no sort_by. installs is required + numeric.
    default_sorting_field: "installs",
  };
}

/**
 * The document shape we push — SINGLE SOURCE for the doc type. The sync query's
 * `returns` validates against this validator, `TypesenseSkillDoc` derives from
 * it via `Infer`, and the frontend's `SkillHit` (lib/search/typesense.ts)
 * derives from the type — so the three can't drift. The field list must match
 * `skillsCollectionSchema` above (a manual mirror — Typesense's schema
 * language can't be derived from a Convex validator without giving up the
 * static doc type); `assertSchemaMirror` below makes any mismatch a loud
 * error at setup + every sync start instead of a silently unindexed field.
 */
export const typesenseSkillDocValidator = v.object({
  /** `${source}::${skillId}` */
  id: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  source: v.string(),
  /** Publisher slug — the part before "/" in source. Derived at sync. */
  owner: v.string(),
  skillId: v.string(),
  installs: v.number(),
  installRank: v.optional(v.number()),
  curatedOwner: v.optional(v.string()),
  isOfficial: v.boolean(),
  isGitHubOnly: v.boolean(),
  isDuplicate: v.boolean(),
  hasContentFetchError: v.boolean(),
  worstAuditStatus: v.optional(v.string()),
  worstAuditRiskLevel: v.optional(v.string()),
  copyCount: v.optional(v.number()),
  // Forward-declared sorts, populated in a later sync pass.
  momentum7d: v.optional(v.number()),
  momentum30d: v.optional(v.number()),
  contentUpdatedAt: v.optional(v.number()),
  syncedAt: v.optional(v.number()),
});

export type TypesenseSkillDoc = Infer<typeof typesenseSkillDocValidator>;

/**
 * Drift tripwire for the one remaining manual mirror. It guarantees two things
 * about the collection schema vs. the doc validator, and NOTHING beyond them —
 * don't over-trust it:
 *
 *  1. **Same field set.** A field in one but not the other is drift. The
 *     failure is SILENT in prod — Typesense stores unknown document fields
 *     unindexed, so a validator field missing from the schema "works" (it's in
 *     the docs) while every filter/sort on it quietly matches nothing.
 *  2. **No schema-required field is validator-optional.** That asymmetry lets
 *     the validator emit a doc omitting a field the schema requires, which
 *     Typesense rejects at import — the whole page fails. (The reverse —
 *     schema-optional, validator-required, e.g. `owner` — is SAFE: the
 *     validator forces the field present, so no doc ever omits it. Not
 *     flagged.) This does NOT compare field TYPES.
 *
 * Called from setupCollection and at each sync start, so drift is a loud
 * dashboard error the same day it ships. (`id` is Typesense's implicit document
 * id — never a schema field.)
 *
 * When the Tier 2 auto-embedding lands (docs/search-overhaul.md: a schema
 * `embedding` field with an `embed` config that Typesense computes — documents
 * never carry it), it will trip the field-set check by design. Add a small
 * schema-only allowlist here then (e.g. `SCHEMA_ONLY_FIELDS`), not before.
 */
export function assertSchemaMirror(): void {
  const schema = skillsCollectionSchema("_check").fields;
  const schemaFields = new Set(schema.map((f) => f.name));
  const schemaRequired = new Set(
    schema.filter((f) => f.optional !== true).map((f) => f.name),
  );
  const validatorFields = typesenseSkillDocValidator.fields as Record<
    string,
    { isOptional?: "optional" | "required" }
  >;
  const docFields = Object.keys(validatorFields).filter((k) => k !== "id");

  const missingInSchema = docFields.filter((f) => !schemaFields.has(f));
  const missingInDoc = [...schemaFields].filter((f) => !docFields.includes(f));
  // Schema-required fields the validator marks optional → a doc could omit
  // them → Typesense rejects the import page.
  const optionalityDrift = docFields.filter(
    (f) =>
      schemaRequired.has(f) && validatorFields[f]?.isOptional === "optional",
  );

  if (
    missingInSchema.length > 0 ||
    missingInDoc.length > 0 ||
    optionalityDrift.length > 0
  ) {
    throw new Error(
      "Typesense schema/validator drift (convex/lib/typesense.ts): " +
        (missingInSchema.length > 0
          ? `validator fields missing from skillsCollectionSchema: ${missingInSchema.join(", ")} ` +
            "(they'd be stored UNINDEXED — filters/sorts on them silently match nothing). "
          : "") +
        (missingInDoc.length > 0
          ? `schema fields missing from typesenseSkillDocValidator: ${missingInDoc.join(", ")}. `
          : "") +
        (optionalityDrift.length > 0
          ? `schema-required but validator-optional: ${optionalityDrift.join(", ")} ` +
            "(a doc omitting one fails the Typesense import). "
          : "") +
        "Update both together.",
    );
  }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

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
  const { json } = await tsRequest(
    `/collections/${encodeURIComponent(collection)}`,
  );
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
  if (await collectionExists(collection))
    return { created: false, name: collection };
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
export async function importDocuments(docs: TypesenseSkillDoc[]): Promise<{
  imported: number;
  failed: number;
  errors: string[];
  failedIds: string[];
}> {
  if (docs.length === 0)
    return { imported: 0, failed: 0, errors: [], failedIds: [] };
  const { collection } = getTypesenseConfig();
  const jsonl = docs.map((d) => JSON.stringify(d)).join("\n");
  const { text } = await tsRequest(
    `/collections/${encodeURIComponent(collection)}/documents/import`,
    {
      method: "POST",
      body: jsonl,
      contentType: "text/plain",
      query: "action=upsert",
    },
  );
  // The /import response is JSONL with one result line PER INPUT DOC, in input
  // order — so line i corresponds to docs[i]. That lets us recover the id of
  // each failed doc, which the sweep needs to protect live-but-failing docs
  // (they keep their old syncedAt stamp) from deletion.
  let failed = 0;
  const errors: string[] = [];
  const failedIds: string[] = [];
  const lines = text.split("\n").filter((l) => l);
  for (let i = 0; i < lines.length; i++) {
    const result = JSON.parse(lines[i]) as { success: boolean; error?: string };
    if (!result.success) {
      failed++;
      failedIds.push(docs[i].id);
      if (errors.length < 5 && result.error) errors.push(result.error);
    }
  }
  return { imported: docs.length - failed, failed, errors, failedIds };
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
