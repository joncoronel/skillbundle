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
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { maxIterForRows, CATALOG_MAX_ROWS } from "./lib/pagination";
import {
  assertSchemaMirror,
  ping,
  ensureCollection,
  dropCollection,
  importDocuments,
  deleteByFilter,
  getCollectionInfo,
  createSearchOnlyKey,
  getTypesenseConfig,
  typesenseSkillDocValidator,
  type TypesenseSkillDoc,
} from "./lib/typesense";

/**
 * Connectivity + schema check. Confirms Convex can reach Railway with the admin
 * key, then creates the `skills` collection if it's missing. Safe to re-run —
 * it's a no-op once the collection exists.
 */
export const setupCollection = internalAction({
  args: {},
  returns: v.object({
    host: v.string(),
    collection: v.string(),
    reachable: v.boolean(),
    collectionCreated: v.boolean(),
    message: v.string(),
  }),
  handler: async () => {
    assertSchemaMirror();
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
 * Create the browser-facing search-only key. Run once per environment:
 *   npx convex run typesense:createSearchKey
 * Copy the returned `value` into NEXT_PUBLIC_TYPESENSE_SEARCH_KEY. It's
 * search-only, so exposing it in the client is expected and safe.
 */
export const createSearchKey = internalAction({
  args: { description: v.optional(v.string()) },
  returns: v.object({
    id: v.number(),
    value: v.string(),
    note: v.string(),
  }),
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
  returns: v.object({ collection: v.string(), numDocuments: v.number() }),
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
  returns: v.object({
    collection: v.string(),
    dropped: v.boolean(),
    recreated: v.boolean(),
  }),
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
    docs: v.array(typesenseSkillDocValidator),
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
        // Publisher = the "owner" segment of "owner/repo" (whole string when
        // there's no "/", e.g. a well-known single-token source).
        owner: s.source.split("/")[0],
        skillId: s.skillId,
        installs: s.installs,
        isOfficial: Boolean(s.curatedOwner),
        isDuplicate: Boolean(s.isDuplicate),
        hasContentFetchError: Boolean(s.hasContentFetchError),
        // Defaulted (not omitted) so audit filters behave on unaudited rows:
        // Typesense skips docs MISSING a filtered field, which would wrongly
        // drop unaudited skills from "no failed audits" (:!=fail). "unknown"
        // matches skillAudits' no-audits-yet verdict.
        worstAuditStatus: s.worstAuditStatus ?? "unknown",
        syncedAt,
      };
      // Optional fields — omit when absent so JSON.stringify drops them.
      if (s.description) doc.description = s.description;
      if (s.installRank !== undefined) doc.installRank = s.installRank;
      if (s.curatedOwner) doc.curatedOwner = s.curatedOwner;
      if (s.worstAuditRiskLevel) doc.worstAuditRiskLevel = s.worstAuditRiskLevel;
      if (s.copyCount !== undefined) doc.copyCount = s.copyCount;
      return doc;
    });

    return { docs, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

// A full walk is minutes at most; a lock this old belongs to a crashed run
// (an action that died without rescheduling) and can be stolen.
const SYNC_LOCK_TTL_MS = 60 * 60 * 1000;

/**
 * Take the sync run lock. Returns the new run's start timestamp (which doubles
 * as its mark-and-sweep stamp), or null if an unfinished, non-stale run holds
 * the lock. Single mutation = serializable check-and-set, so two simultaneous
 * starts can't both win.
 */
export const acquireSyncLock = internalMutation({
  args: {},
  returns: v.union(v.number(), v.null()),
  handler: async (ctx) => {
    const now = Date.now();
    const lock = await ctx.db.query("typesenseSyncLock").first();
    if (
      lock &&
      lock.completedAt === undefined &&
      now - lock.startedAt < SYNC_LOCK_TTL_MS
    ) {
      return null;
    }
    if (lock) {
      await ctx.db.patch(lock._id, { startedAt: now, completedAt: undefined });
    } else {
      await ctx.db.insert("typesenseSyncLock", { startedAt: now });
    }
    return now;
  },
});

export const getSyncLock = internalQuery({
  args: {},
  returns: v.union(v.object({ startedAt: v.number() }), v.null()),
  handler: async (ctx) => {
    const lock = await ctx.db.query("typesenseSyncLock").first();
    return lock ? { startedAt: lock.startedAt } : null;
  },
});

export const releaseSyncLock = internalMutation({
  args: { startedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { startedAt }) => {
    const lock = await ctx.db.query("typesenseSyncLock").first();
    // Only the owning run releases — a newer run that stole a stale lock
    // keeps it (this release arriving late must not free the newer run's lock).
    if (lock && lock.startedAt === startedAt) {
      await ctx.db.patch(lock._id, { completedAt: Date.now() });
    }
    return null;
  },
});

const SYNC_PAGE_SIZE = 250;
const SYNC_MAX_PAGES_PER_RUN = 20; // ~5k docs/invocation before rescheduling
// Continuation cap (in pages), derived from the shared catalog budget like the
// other self-scheduling jobs — a backstop against a cursor that never advances.
// The cap is only checked between SYNC_MAX_PAGES_PER_RUN-page chunks, so keep
// it a multiple of that (240 % 20 === 0) or the backstop overshoots by up to
// one chunk — harmless for a backstop, but why be sloppy.
const SYNC_MAX_PAGES = maxIterForRows(CATALOG_MAX_ROWS, SYNC_PAGE_SIZE);

/**
 * Full catalog sync into Typesense — the daily job (and the manual full
 * reindex). Mark-and-sweep: every doc is upserted with `syncedAt` set to this
 * run's start time; when the walk completes, one delete-by-filter removes any
 * doc left with an older stamp — i.e. skills that dropped out of the
 * non-delisted set (delisted / renamed away) since the last run. This keeps
 * Typesense an exact mirror of the live catalog without tracking a changed-set,
 * and self-heals any drift each day.
 *
 * The sweep only runs on a fully clean walk: a doc whose import FAILED this run
 * still carries last run's older stamp, so sweeping after a partial import
 * would delete live-but-erroring skills from search. On failures we skip the
 * sweep (stale leftovers survive one extra day; the next clean run sweeps them)
 * and log loudly so the cron failure is visible in the Convex dashboard.
 *
 * Self-reschedules to stay under the action time limit: up to
 * SYNC_MAX_PAGES_PER_RUN pages per invocation, threading the cursor + running
 * totals + the shared `syncedAt` stamp forward.
 *
 * Run-locked: two overlapping walks would cross-stamp docs (the older run
 * re-stamps with an OLDER syncedAt after the newer run touched them) and the
 * newer run's sweep would then delete live documents. A fresh start that finds
 * an unfinished, non-stale run skips itself loudly; a continuation that finds
 * the lock taken over by a newer run abandons without sweeping. The lock's
 * startedAt doubles as the run's syncedAt stamp.
 *
 * Scheduled by chaining off reconcileUnseenSkills' completion (see
 * reconcile.ts / crons.ts), not a fixed-time cron — so it indexes settled
 * installs/delist flags. Run manually with: npx convex run typesense:syncCatalog
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
    sampleErrors: v.optional(v.array(v.string())),
  },
  returns: v.union(
    v.object({
      done: v.literal(true),
      imported: v.number(),
      failed: v.number(),
      swept: v.number(),
      sweepSkipped: v.boolean(),
      pagesDone: v.number(),
      sampleErrors: v.array(v.string()),
    }),
    v.object({
      done: v.literal(false),
      scheduledMore: v.literal(true),
      imported: v.number(),
      failed: v.number(),
      pagesDone: v.number(),
      sampleErrors: v.array(v.string()),
    }),
    v.object({
      done: v.literal(true),
      skipped: v.literal(true),
      reason: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    let syncedAt = args.syncedAt;
    if (syncedAt === undefined) {
      // Fresh start: fail loudly on schema/validator drift before touching the
      // index (a drifted field would sync "successfully" but be unsearchable).
      assertSchemaMirror();
      // Take the run lock (its timestamp is this run's stamp).
      const acquired = await ctx.runMutation(
        internal.typesense.acquireSyncLock,
        {},
      );
      if (acquired === null) {
        console.warn(
          "typesense syncCatalog: another sync is already running — skipping this start.",
        );
        return {
          done: true as const,
          skipped: true as const,
          reason: "another sync is in progress",
        };
      }
      syncedAt = acquired;
    } else {
      // Continuation: confirm this run still owns the lock. A newer run having
      // taken over means our stamps are stale — abandon without sweeping.
      const lock = await ctx.runQuery(internal.typesense.getSyncLock, {});
      if (!lock || lock.startedAt !== syncedAt) {
        console.warn(
          "typesense syncCatalog: run lock was taken over by a newer run — abandoning this continuation (no sweep).",
        );
        return {
          done: true as const,
          skipped: true as const,
          reason: "lock taken over by a newer run",
        };
      }
    }
    let cursor = args.cursor ?? null;
    let imported = args.imported ?? 0;
    let failed = args.failed ?? 0;
    let pagesDone = args.pagesDone ?? 0;
    const sampleErrors: string[] = args.sampleErrors ?? [];

    for (let i = 0; i < SYNC_MAX_PAGES_PER_RUN; i++) {
      const page = await ctx.runQuery(internal.typesense.pageSummariesForSync, {
        cursor,
        numItems: SYNC_PAGE_SIZE,
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
        if (failed > 0) {
          // Partial import — sweeping now would delete the failed (but live)
          // docs, which still carry the previous run's stamp. Skip it.
          console.error(
            `typesense syncCatalog: ${failed} of ${imported + failed} docs failed to import; ` +
              `sweep skipped so failed docs aren't dropped from search. ` +
              `Sample errors: ${JSON.stringify(sampleErrors)}`,
          );
          await ctx.runMutation(internal.typesense.releaseSyncLock, { startedAt: syncedAt });
          return { done: true as const, imported, failed, swept: 0, sweepSkipped: true, pagesDone, sampleErrors };
        }
        // Sweep: everything not touched this run left the catalog — remove it.
        const swept = await deleteByFilter(`syncedAt:<${syncedAt}`);
        await ctx.runMutation(internal.typesense.releaseSyncLock, { startedAt: syncedAt });
        return { done: true as const, imported, failed, swept, sweepSkipped: false, pagesDone, sampleErrors };
      }
    }

    if (pagesDone >= SYNC_MAX_PAGES) {
      // Backstop against a non-draining cursor. No sweep (the walk never
      // completed, so unvisited docs still carry old stamps) — just stop loudly.
      console.error(
        `typesense syncCatalog: hit continuation cap (${pagesDone} pages, ~${pagesDone * SYNC_PAGE_SIZE} rows) ` +
          `without draining — cursor bug or catalog exceeds CATALOG_MAX_ROWS. Sweep skipped.`,
      );
      await ctx.runMutation(internal.typesense.releaseSyncLock, { startedAt: syncedAt });
      return { done: true as const, imported, failed, swept: 0, sweepSkipped: true, pagesDone, sampleErrors };
    }

    // More to go — continue in a fresh action so we never hit the time limit.
    await ctx.scheduler.runAfter(0, internal.typesense.syncCatalog, {
      cursor,
      syncedAt,
      imported,
      failed,
      pagesDone,
      sampleErrors,
    });
    return { done: false as const, scheduledMore: true as const, imported, failed, pagesDone, sampleErrors };
  },
});
