/**
 * Typesense integration — collection lifecycle + (later) the sync pipeline.
 *
 * These are internal actions; run them from the CLI while building:
 *   npx convex run typesense:setupCollection
 *   npx convex run typesense:resetCollection   # drop + recreate (dev only)
 *
 * Env is read inside lib/typesense.ts (TYPESENSE_HOST / _ADMIN_API_KEY /
 * _COLLECTION). See docs/search-overhaul.md for the plan.
 */

import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  ping,
  ensureCollection,
  dropCollection,
  importDocuments,
  deleteByFilter,
  getCollectionInfo,
  createSearchOnlyKey,
  search,
  getTypesenseConfig,
  type TypesenseSkillDoc,
} from "./lib/typesense";

/**
 * Connectivity + schema check. Confirms Convex can reach Railway with the admin
 * key, then creates the `skills` collection if it's missing. Safe to re-run —
 * it's a no-op once the collection exists.
 */
export const setupCollection = internalAction({
  args: {},
  handler: async () => {
    const { host, collection } = getTypesenseConfig();
    const reachable = await ping();
    if (!reachable) {
      throw new Error(`Typesense at ${host} is not reachable (/health failed).`);
    }
    const { created } = await ensureCollection();
    return {
      host,
      collection,
      reachable,
      collectionCreated: created,
      message: created
        ? `Created collection "${collection}".`
        : `Collection "${collection}" already exists.`,
    };
  },
});

/**
 * One-off search probe for validating the index from the CLI, e.g.:
 *   npx convex run typesense:testSearch '{"q":"postgress"}'
 * Demonstrates typo tolerance + multi-field (name,description) + facet counts.
 */
export const testSearch = internalAction({
  args: {
    q: v.string(),
    filterBy: v.optional(v.string()),
    sortBy: v.optional(v.string()),
  },
  handler: async (_ctx, { q, filterBy, sortBy }) => {
    const res = await search({
      q,
      queryBy: "name,description",
      filterBy,
      sortBy,
      facetBy: "isOfficial,worstAuditStatus,isDuplicate",
      perPage: 5,
    });
    return {
      query: q,
      found: res.found,
      topHits: res.hits.map((h) => ({
        name: h.document.name,
        source: h.document.source,
        installs: h.document.installs,
      })),
      facets: res.facet_counts?.map((f) => ({
        field: f.field_name,
        counts: f.counts.map((c) => `${c.value}: ${c.count}`),
      })),
    };
  },
});

/**
 * Create the browser-facing search-only key. Run once per environment:
 *   npx convex run typesense:createSearchKey
 * Copy the returned `value` into NEXT_PUBLIC_TYPESENSE_SEARCH_KEY. It's
 * search-only, so exposing it in the client is expected and safe.
 */
export const createSearchKey = internalAction({
  args: { description: v.optional(v.string()) },
  handler: async (_ctx, { description }) => {
    const key = await createSearchOnlyKey(
      description ?? "browser search-only key",
    );
    return {
      id: key.id,
      value: key.value,
      note: "Search-only. Set as NEXT_PUBLIC_TYPESENSE_SEARCH_KEY (safe to expose).",
    };
  },
});

/** Report the live indexed document count. Handy for watching the backfill. */
export const stats = internalAction({
  args: {},
  handler: async () => {
    const { name, numDocuments } = await getCollectionInfo();
    return { collection: name, numDocuments };
  },
});

/**
 * Drop and recreate the collection from scratch. Destructive — clears all
 * indexed documents. Meant for iterating on the schema during development.
 */
export const resetCollection = internalAction({
  args: {},
  handler: async () => {
    const { collection } = getTypesenseConfig();
    await dropCollection();
    const { created } = await ensureCollection();
    return { collection, dropped: true, recreated: created };
  },
});

// ---------------------------------------------------------------------------
// Sync: skillSummaries → Typesense
// ---------------------------------------------------------------------------

const typesenseDocValidator = v.object({
  id: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  source: v.string(),
  skillId: v.string(),
  installs: v.number(),
  installRank: v.optional(v.number()),
  curatedOwner: v.optional(v.string()),
  isOfficial: v.boolean(),
  isDuplicate: v.boolean(),
  hasContentFetchError: v.boolean(),
  worstAuditStatus: v.optional(v.string()),
  worstAuditRiskLevel: v.optional(v.string()),
  copyCount: v.optional(v.number()),
  syncedAt: v.optional(v.number()),
});

/**
 * Read one page of non-delisted summaries and shape them into Typesense
 * documents. Walks the `by_isDelisted_installs` index (order irrelevant for a
 * full backfill). Mapping happens here so the action just forwards docs to the
 * import endpoint. momentum and contentUpdatedAt are deferred (later pass), so
 * they're omitted — the schema marks them optional.
 */
export const pageSummariesForSync = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
    syncedAt: v.number(),
  },
  returns: v.object({
    docs: v.array(typesenseDocValidator),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor, numItems, syncedAt }) => {
    const page = await ctx.db
      .query("skillSummaries")
      .withIndex("by_isDelisted_installs", (q) => q.eq("isDelisted", false))
      .paginate({ cursor, numItems });

    const docs = page.page.map((s) => {
      const doc: TypesenseSkillDoc = {
        id: `${s.source}::${s.skillId}`,
        name: s.name,
        source: s.source,
        skillId: s.skillId,
        installs: s.installs,
        isOfficial: Boolean(s.curatedOwner),
        isDuplicate: Boolean(s.isDuplicate),
        hasContentFetchError: Boolean(s.hasContentFetchError),
        syncedAt,
      };
      // Optional fields — omit when absent so JSON.stringify drops them.
      if (s.description) doc.description = s.description;
      if (s.installRank !== undefined) doc.installRank = s.installRank;
      if (s.curatedOwner) doc.curatedOwner = s.curatedOwner;
      if (s.worstAuditStatus) doc.worstAuditStatus = s.worstAuditStatus;
      if (s.worstAuditRiskLevel) doc.worstAuditRiskLevel = s.worstAuditRiskLevel;
      if (s.copyCount !== undefined) doc.copyCount = s.copyCount;
      return doc;
    });

    return { docs, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

/**
 * Full catalog sync into Typesense — the daily job (and the manual full
 * reindex). Mark-and-sweep: every doc is upserted with `syncedAt` set to this
 * run's start time; when the walk completes, one delete-by-filter removes any
 * doc left with an older stamp — i.e. skills that dropped out of the
 * non-delisted set (delisted / renamed away) since the last run. This keeps
 * Typesense an exact mirror of the live catalog without tracking a changed-set,
 * and self-heals any drift each day.
 *
 * Self-reschedules to stay under the action time limit: up to MAX_PAGES_PER_RUN
 * pages per invocation, threading the cursor + running totals + the shared
 * `syncedAt` stamp forward. Run manually with: npx convex run typesense:syncCatalog
 */
export const syncCatalog = internalAction({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    // The run's start time, threaded through every rescheduled invocation so
    // all pages in one daily run share a single stamp. Set on first call.
    syncedAt: v.optional(v.number()),
    imported: v.optional(v.number()),
    failed: v.optional(v.number()),
    pagesDone: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const PAGE_SIZE = 250;
    const MAX_PAGES_PER_RUN = 20; // ~5k docs/invocation before rescheduling

    const syncedAt = args.syncedAt ?? Date.now();
    let cursor = args.cursor ?? null;
    let imported = args.imported ?? 0;
    let failed = args.failed ?? 0;
    let pagesDone = args.pagesDone ?? 0;
    const sampleErrors: string[] = [];

    for (let i = 0; i < MAX_PAGES_PER_RUN; i++) {
      const page = await ctx.runQuery(internal.typesense.pageSummariesForSync, {
        cursor,
        numItems: PAGE_SIZE,
        syncedAt,
      });
      if (page.docs.length > 0) {
        const res = await importDocuments(page.docs);
        imported += res.imported;
        failed += res.failed;
        for (const e of res.errors) if (sampleErrors.length < 5) sampleErrors.push(e);
      }
      pagesDone++;
      cursor = page.continueCursor;
      if (page.isDone) {
        // Sweep: everything not touched this run left the catalog — remove it.
        const swept = await deleteByFilter(`syncedAt:<${syncedAt}`);
        return { done: true, imported, failed, swept, pagesDone, sampleErrors };
      }
    }

    // More to go — continue in a fresh action so we never hit the time limit.
    await ctx.scheduler.runAfter(0, internal.typesense.syncCatalog, {
      cursor,
      syncedAt,
      imported,
      failed,
      pagesDone,
    });
    return { done: false, scheduledMore: true, imported, failed, pagesDone, sampleErrors };
  },
});
