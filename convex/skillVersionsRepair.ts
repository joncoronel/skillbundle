/**
 * One-shot repair tooling for the version archive's `isBaseline` rows.
 *
 * DELETE-ON-COMPLETION. Nothing in the application calls any of this. Every
 * function here is hand-run against production once, to correct rows the write
 * path used to produce wrongly:
 *
 *     npx convex run skillVersionsRepair:auditBaselineLabels --prod
 *     npx convex run skillVersionsRepair:repairBaselineLabels --prod
 *     npx convex run skillVersionsRepair:auditBaselineDescriptionClaims --prod
 *     npx convex run skillVersionsRepair:repairBaselineDescriptionClaims --prod
 *
 * Once each has run to `scanComplete` on prod and reported nothing left to
 * patch, this whole file can go. It is split out of `skillVersions.ts` for that
 * reason: that module is the archive's read and write API, and this is
 * archaeology about two specific past defects. Kept together it was a third of
 * the file, sitting between a reader and the thing they came for, with nothing
 * marking it as retirable.
 *
 * Both defects are two halves of one row. `repairBaselineLabels` fixes rows
 * flagged `isBaseline` that were real changes (they carry a `previousSyncHash`,
 * which proves an earlier copy existed). `repairBaselineDescriptionClaims`
 * fixes the opposite: genuine baselines that reported a description CHANGE,
 * because the content writers compared the file against a row the add had not
 * filled in yet. The predicates are deliberately disjoint on
 * `previousSyncHash` — a row is one or the other, never both — so neither
 * repair can undo the other's work.
 *
 * `runBaselineScan` is the shared driver; see its doc for why the pre-flight
 * audits are the same code with `dryRun` rather than a second implementation.
 */
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import type { FunctionReference } from "convex/server";
import { internal } from "./_generated/api";
import { appDay } from "./lib/appDay";
import { isGitHubSource } from "./lib/source";

// ---------------------------------------------------------------------------
// Baseline-label audit (read-only)
// ---------------------------------------------------------------------------

/**
 * Find rows flagged `isBaseline` that are provably NOT baselines.
 *
 * A baseline is a starting point: the first copy of a file we had no prior
 * record of. `previousSyncHash` is set exactly when a prior copy DID exist, so
 * `isBaseline && previousSyncHash !== undefined` is a contradiction — the row
 * is a real, detected change wearing a baseline's label. See the note on
 * `isBaseline` in `recordSkillVersion` for how that happened: the flag used to
 * mean "first row for this skill", which is a different thing.
 *
 * Why this matters more than a mislabel: the feed drops baselines
 * (`resolveSkillChange`), so every one of these is a change no watcher was ever
 * told about, even though the row carries both sides of the description.
 *
 * READ-ONLY. This is the pre-flight for a repair, not the repair. Run it first
 * and read `newestMislabeledAt`: if that is recent, rows are STILL being
 * written wrong and the fix is not live yet — repair before deploying and the
 * pipeline just makes more.
 *
 *     npx convex run skillVersionsRepair:auditBaselineLabels --prod
 */
const BASELINE_AUDIT_PAGE = 400;

export const scanBaselineLabelsPage = internalQuery({
  args: { cursor: v.optional(v.string()), pageSize: v.optional(v.number()) },
  returns: v.object({
    scanned: v.number(),
    mislabeled: v.number(),
    mislabeledGitHub: v.number(),
    mislabeledWellKnown: v.number(),
    // Of the mislabeled, how many carry a description edit. These are the ones
    // whose suppression cost a reader something concrete and reportable — the
    // rest changed only in the body, which has no predecessor blob to diff.
    mislabeledWithDescriptionChange: v.number(),
    newestMislabeledAt: v.union(v.number(), v.null()),
    // Mislabeled rows per app-day, so "is this still happening" is answerable
    // without knowing when the deploy landed.
    byDay: v.record(v.string(), v.number()),
    nextCursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor, pageSize }) => {
    // Seeks only baseline rows. Real changes are the majority of the archive's
    // future and none of them can be mislabeled this way, so walking them would
    // be pure cost.
    const numItems = Math.min(
      Math.max(pageSize ?? BASELINE_AUDIT_PAGE, 1),
      BASELINE_AUDIT_PAGE,
    );
    const result = await ctx.db
      .query("skillVersions")
      .withIndex("by_isBaseline_changedAt", (q) => q.eq("isBaseline", true))
      .paginate({ numItems, cursor: cursor ?? null });

    let mislabeled = 0;
    let mislabeledGitHub = 0;
    let mislabeledWellKnown = 0;
    let mislabeledWithDescriptionChange = 0;
    let newestMislabeledAt: number | null = null;
    const byDay: Record<string, number> = {};

    for (const row of result.page) {
      if (row.previousSyncHash === undefined) continue;
      mislabeled++;
      if (isGitHubSource(row.source)) mislabeledGitHub++;
      else mislabeledWellKnown++;
      if (row.descriptionChanged) mislabeledWithDescriptionChange++;
      if (newestMislabeledAt === null || row.changedAt > newestMislabeledAt) {
        newestMislabeledAt = row.changedAt;
      }
      const day = appDay(row.changedAt);
      byDay[day] = (byDay[day] ?? 0) + 1;
    }

    return {
      scanned: result.page.length,
      mislabeled,
      mislabeledGitHub,
      mislabeledWellKnown,
      mislabeledWithDescriptionChange,
      newestMislabeledAt,
      byDay,
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const auditBaselineLabels = internalAction({
  args: { maxPages: v.optional(v.number()), pageSize: v.optional(v.number()) },
  returns: v.object({
    baselineRowsScanned: v.number(),
    mislabeled: v.number(),
    mislabeledGitHub: v.number(),
    mislabeledWellKnown: v.number(),
    mislabeledWithDescriptionChange: v.number(),
    newestMislabeledAt: v.union(v.number(), v.null()),
    newestMislabeledDay: v.union(v.string(), v.null()),
    byDay: v.record(v.string(), v.number()),
    pages: v.number(),
    // False means the page budget ran out before the scan drained, so every
    // count above is a FLOOR. Reported rather than inferred, because a floor
    // that looks like a total is how the backfill got called finished twice.
    complete: v.boolean(),
  }),
  handler: async (ctx, { maxPages, pageSize }) => {
    // Loops in one invocation rather than self-chaining. The whole point of a
    // pre-flight is one command with one answer, and a chained job reports
    // through logs that Convex may evict — which is exactly how the evidence for
    // the sweep failure was lost. ~13k baseline rows at 400/page is ~34 fast
    // indexed pages, comfortably inside an action's budget.
    const budget = Math.min(Math.max(maxPages ?? 200, 1), 500);

    let cursor: string | undefined;
    let pages = 0;
    let baselineRowsScanned = 0;
    let mislabeled = 0;
    let mislabeledGitHub = 0;
    let mislabeledWellKnown = 0;
    let mislabeledWithDescriptionChange = 0;
    let newestMislabeledAt: number | null = null;
    const byDay: Record<string, number> = {};
    let complete = false;

    while (pages < budget) {
      const page: {
        scanned: number;
        mislabeled: number;
        mislabeledGitHub: number;
        mislabeledWellKnown: number;
        mislabeledWithDescriptionChange: number;
        newestMislabeledAt: number | null;
        byDay: Record<string, number>;
        nextCursor: string | null;
        isDone: boolean;
      } = await ctx.runQuery(
        internal.skillVersionsRepair.scanBaselineLabelsPage,
        { cursor, pageSize },
      );
      pages++;
      baselineRowsScanned += page.scanned;
      mislabeled += page.mislabeled;
      mislabeledGitHub += page.mislabeledGitHub;
      mislabeledWellKnown += page.mislabeledWellKnown;
      mislabeledWithDescriptionChange += page.mislabeledWithDescriptionChange;
      if (
        page.newestMislabeledAt !== null &&
        (newestMislabeledAt === null ||
          page.newestMislabeledAt > newestMislabeledAt)
      ) {
        newestMislabeledAt = page.newestMislabeledAt;
      }
      for (const [day, n] of Object.entries(page.byDay)) {
        byDay[day] = (byDay[day] ?? 0) + n;
      }
      if (page.isDone) {
        complete = true;
        break;
      }
      cursor = page.nextCursor ?? undefined;
    }

    const summary = {
      baselineRowsScanned,
      mislabeled,
      mislabeledGitHub,
      mislabeledWellKnown,
      mislabeledWithDescriptionChange,
      newestMislabeledAt,
      newestMislabeledDay:
        newestMislabeledAt === null ? null : appDay(newestMislabeledAt),
      byDay,
      pages,
      complete,
    };
    console.log(
      `baseline-label audit: ${mislabeled} mislabeled of ${baselineRowsScanned} baseline rows` +
        ` (${mislabeledGitHub} github, ${mislabeledWellKnown} well-known,` +
        ` ${mislabeledWithDescriptionChange} with a description edit)` +
        `${complete ? "" : " — INCOMPLETE, counts are floors"}`,
    );
    return summary;
  },
});

/**
 * Clear the baseline flag on rows the audit above proves are real changes.
 *
 * Run `auditBaselineLabels` FIRST and read `newestMislabeledDay`. If rows are
 * still being written wrong, repairing now just leaves more behind tomorrow.
 *
 *     npx convex run skillVersionsRepair:repairBaselineLabels --prod
 *
 * Idempotent: a repaired row leaves the `isBaseline: true` index, so a second
 * run finds nothing. Safe to re-run after an abort.
 *
 * The consequence is entirely in the FEED. `resolveSkillChange` drops baselines,
 * so these changes were never reported to anyone watching those skills; clearing
 * the flag makes them visible with their descriptions intact. It does not change
 * the timeline UI, which anchors the oldest row on `isBaseline || !previous` and
 * so renders these identically either way.
 */
const REPAIR_PATCH_BATCH = 100;

/**
 * One page of a baseline scan. Shared by both repairs' scan queries so the
 * driver below can walk either of them — they differ ONLY in their predicate.
 *
 * `newestMatchAt` is what makes a dry run answer the question the ordering rule
 * asks ("is the pipeline still producing these?"). Without it an operator can
 * see a count but not whether the write-side fix is live yet.
 */
const baselineScanPage = v.object({
  ids: v.array(v.id("skillVersions")),
  scanned: v.number(),
  newestMatchAt: v.union(v.number(), v.null()),
  nextCursor: v.union(v.string(), v.null()),
  isDone: v.boolean(),
});

type BaselineScanPage = {
  ids: Id<"skillVersions">[];
  scanned: number;
  newestMatchAt: number | null;
  nextCursor: string | null;
  isDone: boolean;
};

const baselineScanResult = v.object({
  found: v.number(),
  patched: v.number(),
  baselineRowsScanned: v.number(),
  pages: v.number(),
  scanComplete: v.boolean(),
  aborted: v.union(v.string(), v.null()),
  /**
   * Where to resume when `scanComplete` is false. Pass it back as `cursor`.
   *
   * Not optional garnish: `clearBaselineDescriptionClaims` leaves `isBaseline`
   * set, so its repaired rows keep their positions in the scanned index and a
   * bare re-run would re-walk the identical first `maxPages × pageSize` rows
   * forever. (`clearBaselineFlags` does drop rows out of the index, so the
   * sibling was resumable by accident — this is what makes both of them
   * resumable on purpose.)
   *
   * EXCEPT on an abort, where it is where the run STARTED: that branch patches
   * nothing, so resuming from the scan position would skip everything it
   * matched. Read `aborted` before using this.
   */
  nextCursor: v.union(v.string(), v.null()),
  /**
   * Newest `changedAt` among matches — see `baselineScanPage`.
   *
   * Only meaningful when `scanComplete` is true. The index is walked oldest
   * first, so a scan that stopped early has only seen old rows and this will
   * understate how recently the pipeline last produced one.
   */
  newestMatchAt: v.union(v.number(), v.null()),
});

/** Clamp a caller's page size into the scan's budget. */
function scanPageSize(pageSize: number | undefined): number {
  return Math.min(
    Math.max(pageSize ?? BASELINE_AUDIT_PAGE, 1),
    BASELINE_AUDIT_PAGE,
  );
}

function newestChangedAt(rows: { changedAt: number }[]): number | null {
  return rows.length ? Math.max(...rows.map((r) => r.changedAt)) : null;
}

/**
 * The scan-then-patch driver both baseline repairs run on.
 *
 * Extracted after the second repair arrived as a near-verbatim copy of the
 * first and quietly lost one of its load-bearing details in the process (the
 * resumability note on `nextCursor` above). The two repairs differ in exactly
 * three things — which rows they match, how they patch one, and what they are
 * called — so those are the parameters and nothing else is.
 *
 * `dryRun` makes the pre-flight the same code as the repair rather than a third
 * copy of the loop: it walks and counts, and patches nothing. That is what
 * `audit*` should mean here — the same predicate the repair will use, not a
 * second implementation of it that can disagree.
 *
 * Two passes (collect all ids, then patch) rather than patching per page: for
 * the sibling, patching mid-pagination shifts the index under its own cursor
 * and skips rows. Kept for both so one driver serves both predicates.
 */
type BaselineScanResult = {
  found: number;
  patched: number;
  baselineRowsScanned: number;
  pages: number;
  scanComplete: boolean;
  aborted: string | null;
  nextCursor: string | null;
  newestMatchAt: number | null;
};

async function runBaselineScan(
  ctx: ActionCtx,
  opts: {
    label: string;
    listRef: FunctionReference<
      "query",
      "internal",
      { cursor?: string; pageSize?: number },
      BaselineScanPage
    >;
    patchRef: FunctionReference<
      "mutation",
      "internal",
      { ids: Id<"skillVersions">[] },
      number
    >;
    dryRun: boolean;
    cursor?: string;
    maxPages?: number;
    maxRows?: number;
    pageSize?: number;
  },
): Promise<BaselineScanResult> {
  const pageBudget = Math.min(Math.max(opts.maxPages ?? 200, 1), 500);
  // The abort valve. A match count near the cap means the predicate is wrong,
  // and stopping beats rewriting the archive on a bad one — which matters most
  // for the description repair, the only one that edits row CONTENT rather than
  // flipping a flag.
  //
  // Lifted entirely for a dry run, because there it protects nothing and breaks
  // the one job the dry run has. A pre-flight exists to report the true `found`
  // and a trustworthy `newestMatchAt`; aborting mid-scan reports the overshoot
  // instead of the count, and — since `by_isBaseline_changedAt` is walked
  // ascending — a `newestMatchAt` taken from the OLDEST rows, which reads as
  // "not happening any more" from a scan that never reached the recent end.
  // A large population is the premise of running the audit at all, so a valve
  // that trips on one is backwards.
  //
  // The dry-run callers accept no `maxRows` at all (see
  // `auditBaselineDescriptionClaims`), so this branch is the only definition of
  // a dry run's ceiling rather than an override of something the caller asked
  // for. Unbounded here does not mean unbounded in memory: `ids` can still only
  // reach `maxPages × pageSize`, i.e. at most 500 × BASELINE_AUDIT_PAGE.
  const rowCap = opts.dryRun
    ? Number.POSITIVE_INFINITY
    : Math.min(Math.max(opts.maxRows ?? 5_000, 1), 20_000);

  let cursor = opts.cursor;
  let pages = 0;
  let baselineRowsScanned = 0;
  let scanComplete = false;
  let newestMatchAt: number | null = null;
  const ids: Id<"skillVersions">[] = [];

  while (pages < pageBudget) {
    const page: BaselineScanPage = await ctx.runQuery(opts.listRef, {
      ...(cursor !== undefined && { cursor }),
      ...(opts.pageSize !== undefined && { pageSize: opts.pageSize }),
    });
    pages++;
    baselineRowsScanned += page.scanned;
    ids.push(...page.ids);
    if (page.newestMatchAt !== null) {
      newestMatchAt = Math.max(newestMatchAt ?? 0, page.newestMatchAt);
    }
    cursor = page.nextCursor ?? undefined;
    if (ids.length > rowCap) {
      const aborted =
        `match count ${ids.length} exceeded maxRows ${rowCap} — nothing patched.` +
        ` Re-run from the START with a larger maxRows, not from nextCursor`;
      console.error(`${opts.label} aborted: ${aborted}`);
      return {
        found: ids.length,
        patched: 0,
        baselineRowsScanned,
        pages,
        scanComplete: false,
        aborted,
        // Where this run STARTED, not where the scan got to. `nextCursor` is
        // documented as a resume point, and on this branch nothing was patched
        // — resuming from the scan position would skip every match found so
        // far and report a quietly incomplete repair as a complete one.
        nextCursor: opts.cursor ?? null,
        newestMatchAt,
      };
    }
    if (page.isDone) {
      scanComplete = true;
      cursor = undefined;
      break;
    }
  }

  let patched = 0;
  if (!opts.dryRun) {
    for (let i = 0; i < ids.length; i += REPAIR_PATCH_BATCH) {
      patched += await ctx.runMutation(opts.patchRef, {
        ids: ids.slice(i, i + REPAIR_PATCH_BATCH),
      });
    }
  }

  console.log(
    `${opts.label}: ${opts.dryRun ? "would patch" : "patched"} ${opts.dryRun ? ids.length : patched}` +
      ` of ${ids.length} matched across ${baselineRowsScanned} baseline rows` +
      `${scanComplete ? "" : ` — SCAN INCOMPLETE, re-run with cursor: "${cursor}"`}`,
  );
  return {
    found: ids.length,
    patched,
    baselineRowsScanned,
    pages,
    scanComplete,
    aborted: null,
    nextCursor: cursor ?? null,
    newestMatchAt,
  };
}

/**
 * Collect ids to repair, WITHOUT writing. Reading and writing are two passes on
 * purpose: patching a row clears the flag this scan filters on, so mutating
 * mid-pagination would shift the index under its own cursor and skip rows. The
 * mislabeled set is small enough (hundreds) to hold in one list.
 */
export const listMislabeledBaselineIds = internalQuery({
  args: { cursor: v.optional(v.string()), pageSize: v.optional(v.number()) },
  returns: baselineScanPage,
  handler: async (ctx, { cursor, pageSize }) => {
    const result = await ctx.db
      .query("skillVersions")
      .withIndex("by_isBaseline_changedAt", (q) => q.eq("isBaseline", true))
      .paginate({ numItems: scanPageSize(pageSize), cursor: cursor ?? null });

    const matches = result.page.filter(
      (row) => row.previousSyncHash !== undefined,
    );
    return {
      ids: matches.map((row) => row._id),
      scanned: result.page.length,
      newestMatchAt: newestChangedAt(matches),
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const clearBaselineFlags = internalMutation({
  args: { ids: v.array(v.id("skillVersions")) },
  returns: v.number(),
  handler: async (ctx, { ids }) => {
    let patched = 0;
    for (const id of ids) {
      const row = await ctx.db.get(id);
      // Re-checked here rather than trusted from the scan. The ids were
      // gathered in an earlier pass, and this mutation must not be able to
      // invent a change on a row that is a genuine baseline — that is the one
      // failure mode worse than the silence being fixed.
      if (!row || !row.isBaseline || row.previousSyncHash === undefined) {
        continue;
      }
      await ctx.db.patch(id, { isBaseline: false });
      patched++;
    }
    return patched;
  },
});

export const repairBaselineLabels = internalAction({
  args: {
    cursor: v.optional(v.string()),
    maxPages: v.optional(v.number()),
    maxRows: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  returns: baselineScanResult,
  // Explicit return type: the handler passes this file's own `internal.*`
  // references to `runBaselineScan`, which is the inference cycle the same
  // annotation breaks elsewhere in the codebase (see skills.ts addSkillManually).
  handler: async (ctx, args): Promise<BaselineScanResult> =>
    runBaselineScan(ctx, {
      label: "repairBaselineLabels",
      listRef: internal.skillVersionsRepair.listMislabeledBaselineIds,
      patchRef: internal.skillVersionsRepair.clearBaselineFlags,
      dryRun: false,
      ...args,
    }),
});

// ---------------------------------------------------------------------------
// Baseline description-claim repair
//
// The sibling of the repair above, for the opposite half of the same row. A
// baseline is a starting point, so it cannot carry a description CHANGE — but
// until `recordSkillVersion` derived those fields from the flag, a first content
// write reported one, because the writers compare the file against a skills row
// that was still empty. Those rows render on the skill page as a
// "Description changed" badge over a before-value of None, on the earliest entry
// in the timeline, for a skill nothing had ever edited.
//
//     npx convex run skillVersionsRepair:auditBaselineDescriptionClaims --prod
//     npx convex run skillVersionsRepair:repairBaselineDescriptionClaims --prod
//
// Write-side fixed first, then the audit, then this — same ordering rule as
// above, for the same reason: repair before the fix is live and the pipeline
// just makes more. `auditBaselineDescriptionClaims` is what makes that rule
// checkable rather than merely stated; it runs the same predicate through the
// same driver with `dryRun`, and reports `newestMatchAt` and `found`.
//
// Idempotent: a repaired row no longer matches the predicate, so a second run
// patches nothing. Note it does NOT drop out of the scanned index (the flag
// stays set, deliberately), so a run that stops short must be resumed with the
// `nextCursor` it returns rather than re-run bare — see `baselineScanResult`.
// ---------------------------------------------------------------------------

/**
 * Baseline rows claiming a description change, WITHOUT writing (two passes, for
 * the reason `listMislabeledBaselineIds` gives).
 *
 * `previousSyncHash === undefined` is required, not incidental. A row flagged
 * baseline that HAS a previous hash is the other defect — a real change that was
 * mislabeled — and its description change is genuine. Clearing that would erase
 * a change instead of an artefact, so the two repairs must not overlap.
 */
export const listBaselineDescriptionClaimIds = internalQuery({
  args: { cursor: v.optional(v.string()), pageSize: v.optional(v.number()) },
  returns: baselineScanPage,
  handler: async (ctx, { cursor, pageSize }) => {
    const result = await ctx.db
      .query("skillVersions")
      .withIndex("by_isBaseline_changedAt", (q) => q.eq("isBaseline", true))
      .paginate({ numItems: scanPageSize(pageSize), cursor: cursor ?? null });

    const matches = result.page.filter(
      (row) =>
        row.previousSyncHash === undefined &&
        (row.descriptionChanged || row.descriptionBefore !== undefined),
    );
    return {
      ids: matches.map((row) => row._id),
      scanned: result.page.length,
      newestMatchAt: newestChangedAt(matches),
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const clearBaselineDescriptionClaims = internalMutation({
  args: { ids: v.array(v.id("skillVersions")) },
  returns: v.number(),
  handler: async (ctx, { ids }) => {
    let patched = 0;
    for (const id of ids) {
      const row = await ctx.db.get(id);
      // Re-checked rather than trusted from the scan, matching
      // `clearBaselineFlags`: the ids were gathered in an earlier pass, and the
      // one failure worse than the artefact is erasing a real change.
      if (!row || !row.isBaseline || row.previousSyncHash !== undefined) {
        continue;
      }
      if (!row.descriptionChanged && row.descriptionBefore === undefined) {
        continue;
      }
      // `descriptionAfter` stays: it is what the file said when we first copied
      // it, which is true. No read path currently reaches it on a baseline —
      // `DescriptionChange` early-returns unless `descriptionChanged`
      // (components/skill-history-row.tsx) and the feed drops baselines — so it
      // is kept as archival record, not because something renders it.
      await ctx.db.patch(id, {
        descriptionChanged: false,
        descriptionBefore: undefined,
      });
      patched++;
    }
    return patched;
  },
});

/**
 * Read-only pre-flight for the repair below. Same predicate, same driver,
 * patches nothing.
 *
 *     npx convex run skillVersionsRepair:auditBaselineDescriptionClaims --prod
 *
 * Check `scanComplete` FIRST — neither number below means anything until the
 * scan reached the end (see `baselineScanResult`).
 *
 * If it is false, re-run **from the start** with a bigger `maxPages`. NOT from
 * `nextCursor`, even though the field is there: `found` counts what THIS
 * invocation matched, so a resumed run reports only the segment after the
 * cursor. Reading that partial number and passing it as the repair's `maxRows`
 * below would under-size the valve and trip an abort on a legitimate run — the
 * exact misreading this pre-flight exists to prevent. Resuming is for the
 * REPAIR, which keeps the rows it already patched; a dry run has nothing to
 * lose by starting over, and no `maxRows` ceiling to hit on the way (below).
 *
 * Then read `newestMatchAt`: if it is recent, rows are STILL being written this
 * way and the write-side fix is not live yet — repair now and the pipeline just
 * makes more. Then read `found`, and pass it with headroom as the repair's
 * `maxRows` so a legitimately large population doesn't trip the repair's abort
 * valve and read as a bad predicate.
 *
 * Takes no `maxRows` of its own, deliberately: `runBaselineScan` lifts the cap
 * for any dry run, so accepting the arg would only let an operator pass a
 * ceiling that is silently ignored.
 */
export const auditBaselineDescriptionClaims = internalAction({
  args: {
    cursor: v.optional(v.string()),
    maxPages: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  returns: baselineScanResult,
  // Explicit return type: the handler passes this file's own `internal.*`
  // references to `runBaselineScan`, which is the inference cycle the same
  // annotation breaks elsewhere in the codebase (see skills.ts addSkillManually).
  handler: async (ctx, args): Promise<BaselineScanResult> =>
    runBaselineScan(ctx, {
      label: "auditBaselineDescriptionClaims",
      listRef: internal.skillVersionsRepair.listBaselineDescriptionClaimIds,
      patchRef: internal.skillVersionsRepair.clearBaselineDescriptionClaims,
      dryRun: true,
      ...args,
    }),
});

export const repairBaselineDescriptionClaims = internalAction({
  args: {
    cursor: v.optional(v.string()),
    maxPages: v.optional(v.number()),
    maxRows: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  returns: baselineScanResult,
  // Explicit return type: the handler passes this file's own `internal.*`
  // references to `runBaselineScan`, which is the inference cycle the same
  // annotation breaks elsewhere in the codebase (see skills.ts addSkillManually).
  handler: async (ctx, args): Promise<BaselineScanResult> =>
    runBaselineScan(ctx, {
      label: "repairBaselineDescriptionClaims",
      listRef: internal.skillVersionsRepair.listBaselineDescriptionClaimIds,
      patchRef: internal.skillVersionsRepair.clearBaselineDescriptionClaims,
      dryRun: false,
      ...args,
    }),
});
