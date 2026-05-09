/**
 * Security-audit sync.
 *
 * Pulls /api/v1/skills/audit/{source}/{skill} for skills flagged with
 * needsAudit=true, stores the per-provider verdicts in the `skillAudits`
 * table, and denormalizes the worst status onto `skills` + `skillSummaries`
 * so cards can render a badge without a join.
 *
 * Per-skill freshness model (mirrors needsContentFetch):
 *   - upsertSkillsBatch sets needsAudit=true on new + relisted skills
 *   - markStaleContent re-flags rows whose auditFetchedAt > 7 days ago
 *   - fetchAuditBatch drains the queue daily as part of the sync chain
 *   - 404 from API = "no audit yet" → record worstStatus:"unknown",
 *     set auditFetchedAt=now → won't retry for 7 days (natural backoff)
 */

import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  getSkillAudits,
  SkillsApiNotFoundError,
  SkillsApiRateLimitError,
  withTransientRetry,
  type V1AuditEntry,
  type AuditStatus,
  type AuditRiskLevel,
} from "./lib/skillsApi";
import type { Id } from "./_generated/dataModel";

const AUDIT_BATCH_SIZE = 10;
const AUDIT_CHAIN_DELAY_MS = 5_000;

// ---------------------------------------------------------------------------
// Worst-status reduction
// ---------------------------------------------------------------------------

const STATUS_RANK: Record<AuditStatus | "unknown", number> = {
  unknown: 0,
  pass: 1,
  warn: 2,
  fail: 3,
};
const RISK_RANK: Record<AuditRiskLevel, number> = {
  NONE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

function reduceWorst(audits: V1AuditEntry[]): {
  worstStatus: string;
  worstRiskLevel?: string;
} {
  if (audits.length === 0) {
    return { worstStatus: "unknown" };
  }
  let worstStatus: AuditStatus | "unknown" = "pass";
  let worstRisk: AuditRiskLevel | undefined;
  for (const a of audits) {
    if (STATUS_RANK[a.status] > STATUS_RANK[worstStatus]) {
      worstStatus = a.status;
    }
    if (a.riskLevel) {
      if (!worstRisk || RISK_RANK[a.riskLevel] > RISK_RANK[worstRisk]) {
        worstRisk = a.riskLevel;
      }
    }
  }
  return { worstStatus, worstRiskLevel: worstRisk };
}

// ---------------------------------------------------------------------------
// Audit-fetch queue (per-skill, drained by the daily chain)
// ---------------------------------------------------------------------------

export const listSkillsNeedingAudit = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { cursor, limit }) => {
    const result = await ctx.db
      .query("skillSummaries")
      .withIndex("by_needsAudit", (q) => q.eq("needsAudit", true))
      .paginate({ numItems: limit, cursor: cursor ?? null });

    const skills = result.page
      .filter((s) => !s.isDelisted)
      .filter((s) => !s.isDuplicate)
      .map((s) => ({
        skillDocId: s.skillDocId,
        source: s.source,
        skillId: s.skillId,
      }));

    return {
      skills,
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const writeAuditResult = internalMutation({
  args: {
    skillDocId: v.id("skills"),
    source: v.string(),
    skillId: v.string(),
    audits: v.array(
      v.object({
        provider: v.string(),
        slug: v.string(),
        status: v.string(),
        summary: v.string(),
        auditedAt: v.string(),
        riskLevel: v.optional(v.string()),
        categories: v.optional(v.array(v.string())),
      }),
    ),
    worstStatus: v.string(),
    worstRiskLevel: v.optional(v.string()),
  },
  /**
   * Compare-and-skip pattern (mirrors updateDescription's hash-skip):
   *   - audits payload unchanged → just touch fetchedAt on skillAudits and
   *     auditFetchedAt on skill/summary. Skip the heavier rewrite.
   *   - worst-status denormalization unchanged → skip patching the skill +
   *     summary's worstAuditStatus / worstAuditRiskLevel fields. Avoids
   *     spurious reactivity on subscribed components.
   *   - needsAudit and auditFetchedAt always update (they drive the refresh
   *     cycle, must stamp on every successful poll).
   */
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("skillAudits")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", args.source).eq("skillId", args.skillId),
      )
      .unique();

    // Deep-compare via JSON. Convex/V8 serialize objects in stable key order,
    // and skills.sh's API also returns a consistent shape, so structural
    // equality maps to string equality here. This catches "audit unchanged"
    // including cases where partners re-stamped auditedAt without changing
    // the verdict (we treat re-stamps as real change events worth recording).
    const auditsChanged =
      !existing || JSON.stringify(existing.audits) !== JSON.stringify(args.audits);
    const worstStatusChanged =
      !existing || existing.worstStatus !== args.worstStatus;
    const worstRiskChanged =
      !existing || existing.worstRiskLevel !== args.worstRiskLevel;
    const skillAuditsRowChanged =
      auditsChanged || worstStatusChanged || worstRiskChanged;

    if (existing) {
      if (skillAuditsRowChanged) {
        await ctx.db.patch(existing._id, {
          audits: args.audits,
          worstStatus: args.worstStatus,
          worstRiskLevel: args.worstRiskLevel,
          fetchedAt: now,
        });
      } else {
        // Nothing moved — just stamp the poll time so we know we checked.
        await ctx.db.patch(existing._id, { fetchedAt: now });
      }
    } else {
      await ctx.db.insert("skillAudits", {
        skillDocId: args.skillDocId,
        source: args.source,
        skillId: args.skillId,
        audits: args.audits,
        worstStatus: args.worstStatus,
        worstRiskLevel: args.worstRiskLevel,
        fetchedAt: now,
      });
    }

    // Denormalized worst-status on skill/summary drives the audit badge.
    // Patch only if the rolled-up signals changed; otherwise the badge
    // would re-render on every weekly poll for no reason.
    const denormChanged = worstStatusChanged || worstRiskChanged;
    if (denormChanged) {
      await ctx.db.patch(args.skillDocId, {
        worstAuditStatus: args.worstStatus,
        worstAuditRiskLevel: args.worstRiskLevel,
      });
    }

    // Refresh-cycle bookkeeping always updates — needsAudit clears the
    // queue entry and auditFetchedAt stamps the 7-day refresh window.
    await ctx.db.patch(args.skillDocId, {
      needsAudit: false,
      auditFetchedAt: now,
    });

    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", args.source).eq("skillId", args.skillId),
      )
      .unique();
    if (summary) {
      if (denormChanged) {
        await ctx.db.patch(summary._id, {
          worstAuditStatus: args.worstStatus,
          worstAuditRiskLevel: args.worstRiskLevel,
        });
      }
      await ctx.db.patch(summary._id, {
        needsAudit: false,
        auditFetchedAt: now,
      });
    }
  },
});

export const fetchAuditBatch = internalAction({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }): Promise<void> => {
    const result: {
      skills: Array<{
        skillDocId: Id<"skills">;
        source: string;
        skillId: string;
      }>;
      nextCursor: string;
      isDone: boolean;
    } = await ctx.runQuery(internal.audits.listSkillsNeedingAudit, {
      cursor: cursor ?? undefined,
      limit: AUDIT_BATCH_SIZE,
    });

    if (result.skills.length > 0) {
      let rateLimited: SkillsApiRateLimitError | null = null;
      // Per-batch counters for the summary log at the end. Gives at-a-glance
      // visibility into whether class-3 errors (non-429, non-404) are a
      // recurring problem at scale; no per-skill log spam needed.
      let okCount = 0;
      let unknownCount = 0;
      let errorCount = 0;

      await Promise.all(
        result.skills.map(async (s) => {
          if (rateLimited) return;
          const id = `${s.source}/${s.skillId}`;
          try {
            // Inline retry absorbs flaky 5xx / network blips so a single
            // upstream hiccup doesn't shove the row into 7-day refresh
            // limbo. Rate-limit and 404 still bubble up unchanged.
            const response = await withTransientRetry(() =>
              getSkillAudits(s.source, s.skillId),
            );
            const audits = response.audits ?? [];
            const { worstStatus, worstRiskLevel } = reduceWorst(audits);
            await ctx.runMutation(internal.audits.writeAuditResult, {
              skillDocId: s.skillDocId,
              source: s.source,
              skillId: s.skillId,
              audits,
              worstStatus,
              worstRiskLevel,
            });
            okCount++;
          } catch (e) {
            if (e instanceof SkillsApiRateLimitError) {
              rateLimited = e;
              return;
            }
            if (e instanceof SkillsApiNotFoundError) {
              // No audit yet — record empty + unknown. auditFetchedAt gets
              // set inside writeAuditResult, so the 7-day refresh window
              // applies and we won't immediately re-fetch.
              await ctx.runMutation(internal.audits.writeAuditResult, {
                skillDocId: s.skillDocId,
                source: s.source,
                skillId: s.skillId,
                audits: [],
                worstStatus: "unknown",
              });
              unknownCount++;
              return;
            }
            console.error(`Audit fetch failed for ${id}:`, e);
            errorCount++;
          }
        }),
      );

      if (errorCount > 0) {
        console.warn(
          `Audit batch summary: ${okCount} ok, ${unknownCount} unknown, ${errorCount} error`,
        );
      }

      if (rateLimited) {
        const retryAfter = (rateLimited as SkillsApiRateLimitError)
          .retryAfterSeconds;
        console.warn(`Audits rate limited; resuming in ${retryAfter}s`);
        await ctx.scheduler.runAfter(
          retryAfter * 1000,
          internal.audits.fetchAuditBatch,
          { cursor },
        );
        return;
      }
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        AUDIT_CHAIN_DELAY_MS,
        internal.audits.fetchAuditBatch,
        { cursor: result.nextCursor },
      );
    } else {
      console.log("Audit fetch chain drained");
    }
  },
});

// Manual entry point for the cron / one-shot runs.
export const syncAudits = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.audits.fetchAuditBatch, {});
  },
});

// ---------------------------------------------------------------------------
// One-shot backfill — flag every active skill for audit
// ---------------------------------------------------------------------------
//
// After switching to per-skill audit refresh, existing skills don't have
// `needsAudit` set. This walks every active row and flags it so the
// fetchAuditBatch chain picks them up. Run once after the schema migration.
// Idempotent — already-flagged rows are skipped.
//
// Run via: npx convex run audits:flagAllForAudit

export const flagAllForAuditBatch = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db
      .query("skillSummaries")
      .paginate({ numItems: 200, cursor: cursor ?? null });

    let flagged = 0;
    for (const summary of result.page) {
      if (summary.isDelisted) continue;
      if (summary.isDuplicate) continue;
      if (summary.needsAudit === true) continue;

      await ctx.db.patch(summary._id, { needsAudit: true });
      await ctx.db.patch(summary.skillDocId, { needsAudit: true });
      flagged++;
    }

    return {
      nextCursor: result.continueCursor,
      isDone: result.isDone,
      flagged,
    };
  },
});

export const flagAllForAudit = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | undefined;
    let isDone = false;
    let total = 0;

    while (!isDone) {
      const result: {
        nextCursor: string;
        isDone: boolean;
        flagged: number;
      } = await ctx.runMutation(internal.audits.flagAllForAuditBatch, {
        cursor,
      });
      total += result.flagged;
      cursor = result.nextCursor;
      isDone = result.isDone;
    }

    console.log(`Flagged ${total} skills for audit fetch`);

    if (total > 0) {
      await ctx.scheduler.runAfter(0, internal.audits.fetchAuditBatch, {});
    }

    return { flagged: total };
  },
});

// ---------------------------------------------------------------------------
// One-shot: re-flag rows that came back as "unknown" the first time
// ---------------------------------------------------------------------------
//
// skills.sh's audit pipeline is async — when we fetched audits during the
// initial backfill, some skills hadn't been audited yet (API returned 404,
// stored as worstStatus="unknown"). Their audits trickle in over hours/days.
// This action re-flags every row currently marked "unknown" so we re-fetch
// and pick up audits that have since landed. Run via:
//   npx convex run audits:reflagUnknownAudits

export const reflagUnknownAuditsBatch = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db
      .query("skillSummaries")
      .paginate({ numItems: 200, cursor: cursor ?? null });

    let flagged = 0;
    for (const summary of result.page) {
      if (summary.isDelisted) continue;
      if (summary.isDuplicate) continue;
      if (summary.needsAudit === true) continue;
      // Only re-flag rows whose audit came back as "unknown" — leave already-
      // populated pass/warn/fail rows alone (their data is current).
      if (summary.worstAuditStatus !== "unknown") continue;

      await ctx.db.patch(summary._id, { needsAudit: true });
      await ctx.db.patch(summary.skillDocId, { needsAudit: true });
      flagged++;
    }

    return {
      nextCursor: result.continueCursor,
      isDone: result.isDone,
      flagged,
    };
  },
});

export const reflagUnknownAudits = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | undefined;
    let isDone = false;
    let total = 0;

    while (!isDone) {
      const result: {
        nextCursor: string;
        isDone: boolean;
        flagged: number;
      } = await ctx.runMutation(internal.audits.reflagUnknownAuditsBatch, {
        cursor,
      });
      total += result.flagged;
      cursor = result.nextCursor;
      isDone = result.isDone;
    }

    console.log(`Re-flagged ${total} unknown-audit skills for re-fetch`);

    if (total > 0) {
      await ctx.scheduler.runAfter(0, internal.audits.fetchAuditBatch, {});
    }

    return { flagged: total };
  },
});


// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

/** Per-provider audit breakdown for a single skill, used on the detail page. */
export const getBySourceAndSkillId = query({
  args: { source: v.string(), skillId: v.string() },
  handler: async (ctx, { source, skillId }) => {
    return await ctx.db
      .query("skillAudits")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", source).eq("skillId", skillId),
      )
      .unique();
  },
});
