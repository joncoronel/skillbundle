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
import type { Doc } from "./_generated/dataModel";
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
 * documents. Mapping happens here so the action just forwards docs to the
 * import endpoint. momentum and contentUpdatedAt are deferred (later pass), so
 * they're omitted — the schema marks them optional.
 *
 * Walks `by_isDelisted` (NOT `by_isDelisted_installs`): the mark-and-sweep runs
 * across many rescheduled transactions spanning minutes, and `installs` is
 * mutated by the sync/reconcile/refresh paths. Convex cursor pagination is only
 * stable when the ordering key is immutable for the walk — an unvisited row
 * whose `installs` fell below the cursor would be skipped, left unstamped, and
 * then SWEPT from the index while still live. Within the `isDelisted=false`
 * partition `by_isDelisted` orders by `_creationTime` (immutable), so the walk
 * can't reorder under itself. Order is irrelevant to a full backfill anyway.
 */
/**
 * Map one `skillSummaries` row to its Typesense document. The SINGLE mapping —
 * shared by the full mark-and-sweep sync (`pageSummariesForSync`) and the
 * targeted single-doc upsert on add (`indexSkill`) — so the two can never index
 * a skill differently.
 */
export function buildSkillDoc(
  s: Doc<"skillSummaries">,
  syncedAt: number,
): TypesenseSkillDoc {
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
    isGitHubOnly: Boolean(s.isGitHubOnly),
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
}

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
      .withIndex("by_isDelisted", (q) => q.eq("isDelisted", false))
      .paginate({ cursor, numItems });

    const docs = page.page.map((s) => buildSkillDoc(s, syncedAt));

    return { docs, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

/**
 * Build one non-delisted skill's Typesense document for the targeted on-add
 * index. The doc is assembled HERE (not in the action) so the boundary is
 * covered by the real validator — an action-side annotation over `v.any()`
 * would let a future projection type-check while emitting wrong docs.
 */
export const getSkillDocForIndex = internalQuery({
  args: { source: v.string(), skillId: v.string(), syncedAt: v.number() },
  returns: v.union(v.null(), typesenseSkillDocValidator),
  handler: async (ctx, { source, skillId, syncedAt }) => {
    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", source).eq("skillId", skillId),
      )
      .unique();
    if (!summary || summary.isDelisted) return null;
    return buildSkillDoc(summary, syncedAt);
  },
});

/**
 * Index a single skill into Typesense immediately, instead of waiting for the
 * daily mark-and-sweep. Scheduled from the manual-add paths so a just-added
 * skill is searchable within seconds. Upsert-only — it never sweeps, so it
 * needs no run lock and can't race the full sync (which re-imports the same
 * doc with its own stamp on the next run). Best-effort: any failure (Typesense
 * unconfigured, transient error) is swallowed — the daily sync backfills it.
 */
export const indexSkill = internalAction({
  args: {
    source: v.string(),
    skillId: v.string(),
    // The SKILL.md description the caller already resolved during the add. The
    // content pipeline writes the summary's description asynchronously (a few
    // seconds after insert), so on a fresh add the summary has none yet — this
    // fills it so the very first indexed doc is complete, not name-only.
    description: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { source, skillId, description }) => {
    try {
      // Date.now() in an action is fine (non-deterministic context). A fresh
      // stamp keeps a concurrent/next sweep from deleting this doc.
      const doc: TypesenseSkillDoc | null = await ctx.runQuery(
        internal.typesense.getSkillDocForIndex,
        { source, skillId, syncedAt: Date.now() },
      );
      if (!doc) return null;
      // Prefer a real stored description; fall back to the caller's freshly
      // parsed one on the add path (guard against overwriting with empty).
      if (!doc.description && description) doc.description = description;
      await importDocuments([doc]);
    } catch (err) {
      console.warn(
        `typesense indexSkill: couldn't index ${source}/${skillId} (daily sync will backfill):`,
        err,
      );
    }
    return null;
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
// The sweep protects docs that failed to import this run (they keep last run's
// older stamp) by excluding their ids from the delete filter — so one poison
// doc no longer blocks the sweep forever. Above this many failures the run is
// treated as systemic (Typesense down / schema mismatch): skip the sweep
// entirely rather than build a giant exclusion filter, and let the next clean
// run clear the backlog.
const SWEEP_EXCLUDE_CAP = 100;

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
    // Ids of docs that failed to import so far this run — threaded forward so
    // the terminal sweep can exclude them (they still carry last run's stamp).
    // Capped at SWEEP_EXCLUDE_CAP; past that the run is treated as systemic.
    failedIds: v.optional(v.array(v.string())),
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
    const failedIds: string[] = args.failedIds ?? [];

    // From here we OWN the lock (fresh acquire, or verified on a continuation).
    // Any throw below must release it — otherwise a transport blip (Typesense
    // 5xx / network) strands the lock for the full TTL. A plain `finally` won't
    // work: the reschedule path returns NORMALLY and must KEEP the lock for the
    // next invocation. So the lock is released in exactly two places — a
    // terminal outcome (done/cap), and the catch (throw) — never on reschedule.
    const release = () =>
      ctx.runMutation(internal.typesense.releaseSyncLock, { startedAt: syncedAt });
    try {
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
          for (const id of res.failedIds)
            if (failedIds.length < SWEEP_EXCLUDE_CAP) failedIds.push(id);
        }
        pagesDone++;
        cursor = page.continueCursor;
        if (page.isDone) {
          let swept = 0;
          let sweepSkipped = false;
          if (failed === 0) {
            // Clean walk — sweep everything not touched this run (left the
            // non-delisted set: delisted / renamed away).
            swept = await deleteByFilter(`syncedAt:<${syncedAt}`);
          } else if (failed <= SWEEP_EXCLUDE_CAP) {
            // Some docs failed to import — they still carry last run's older
            // stamp, so a bare `syncedAt:<X` sweep would delete them while
            // live. Exclude their ids: genuinely-gone docs are still removed,
            // but the failed-but-live ones survive. This is what stops a single
            // persistently-failing doc from blocking the sweep forever (which
            // would leak delisted rows into search unbounded).
            const exclude = failedIds.map((id) => `\`${id}\``).join(",");
            swept = await deleteByFilter(
              `syncedAt:<${syncedAt} && id:!=[${exclude}]`,
            );
            console.error(
              `typesense syncCatalog: ${failed} docs failed to import; swept ${swept} stale docs ` +
                `excluding the ${failedIds.length} failed ids. Sample errors: ${JSON.stringify(sampleErrors)}`,
            );
          } else {
            // Too many failures to enumerate safely — treat as systemic and
            // skip the sweep; the next clean run clears the backlog.
            sweepSkipped = true;
            console.error(
              `typesense syncCatalog: ${failed} docs failed (> ${SWEEP_EXCLUDE_CAP} cap) — ` +
                `sweep skipped this run (systemic failure?). Sample errors: ${JSON.stringify(sampleErrors)}`,
            );
          }
          await release();
          return { done: true as const, imported, failed, swept, sweepSkipped, pagesDone, sampleErrors };
        }
      }

      if (pagesDone >= SYNC_MAX_PAGES) {
        // Backstop against a non-draining cursor. No sweep (the walk never
        // completed, so unvisited docs still carry old stamps) — just stop loudly.
        console.error(
          `typesense syncCatalog: hit continuation cap (${pagesDone} pages, ~${pagesDone * SYNC_PAGE_SIZE} rows) ` +
            `without draining — cursor bug or catalog exceeds CATALOG_MAX_ROWS. Sweep skipped.`,
        );
        await release();
        return { done: true as const, imported, failed, swept: 0, sweepSkipped: true, pagesDone, sampleErrors };
      }

      // More to go — continue in a fresh action so we never hit the time limit.
      // Deliberately NO release here: the lock stays held across the whole run.
      await ctx.scheduler.runAfter(0, internal.typesense.syncCatalog, {
        cursor,
        syncedAt,
        imported,
        failed,
        pagesDone,
        sampleErrors,
        failedIds,
      });
      return { done: false as const, scheduledMore: true as const, imported, failed, pagesDone, sampleErrors };
    } catch (e) {
      // Release the lock on any throw so it isn't stranded for the TTL. (The
      // release is a no-op if a newer run already stole the lock.)
      await release();
      throw e;
    }
  },
});
