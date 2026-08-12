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
import { dequal } from "dequal";
import { revalidateSiteTag } from "./lib/revalidate";
import {
  getSkillAudits,
  SkillsApiNotFoundError,
  SkillsApiRateLimitError,
  withTransientRetry,
  type V1AuditEntry,
  type AuditStatus,
  type AuditRiskLevel,
} from "./lib/skillsApi";
import { loadSkillsAuth } from "./lib/skillsAuth";
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
  returns: v.object({
    denormChanged: v.boolean(),
    auditRowChanged: v.boolean(),
    isFirstRecord: v.boolean(),
  }),
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

    // Deep compare via dequal. Catches "audit unchanged" including cases
    // where partners re-stamped auditedAt without changing the verdict (we
    // treat re-stamps as real change events worth recording). Immune to
    // upstream key-order changes and forward-compatible: any new field
    // skills.sh adds is automatically part of the comparison without us
    // needing to update a typed schema. Was previously JSON.stringify which
    // relied on V8's de-facto stable key ordering, not a language-level
    // guarantee.
    const auditsChanged = !existing || !dequal(existing.audits, args.audits);
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
          // Preserve the verdict we are about to overwrite, but only when the
          // verdict itself moved. `skillAuditsRowChanged` is also true for a
          // provider re-stamping `auditedAt` with an identical verdict, and
          // capturing on that would leave previousWorstStatus === worstStatus,
          // which reads as a change to anything downstream and would fire an
          // alert for nothing happening.
          ...(worstStatusChanged && {
            previousWorstStatus: existing.worstStatus,
            previousWorstRiskLevel: existing.worstRiskLevel,
            worstStatusChangedAt: now,
          }),
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

    // Reported so the chain terminal can publish. `worstAuditStatus` /
    // `worstAuditRiskLevel` live on the skill row, which `loadSkill` reads under
    // the long-lived "skill-content" tag (lib/skill-cache.ts) — the OG card's
    // audit badge comes off exactly these. Nothing else in the app pings that
    // tag for audits, so without this the badge on every social card would go
    // stale for a full cacheLife("weeks") window.
    //
    // `isFirstRecord` distinguishes "this verdict moved" from "we had never
    // recorded one". Every *Changed flag above is `!existing || ...`, so a first
    // write reports denormChanged: true even when nothing a reader can see
    // differs. The 404 caller uses this to avoid publishing an invisible
    // absent -> "unknown" transition; the success caller deliberately does not,
    // because a first audit coming back fail/warn makes a badge APPEAR.
    // Two flags, because two cache entries move on different conditions:
    //   denormChanged   — the rolled-up verdict on the SKILL row moved. Drives
    //                     the OG card's badge, read through "skill-content".
    //   auditRowChanged — the skillAudits row moved at all, which includes a
    //                     provider re-writing a summary with the same verdict.
    //                     Drives the page's audit section, read through
    //                     "skill-audit". Strict superset of the above.
    return {
      denormChanged,
      auditRowChanged: skillAuditsRowChanged,
      isFirstRecord: !existing,
    };
  },
});

export const fetchAuditBatch = internalAction({
  // `denormChanges` accumulates across the self-chaining recursion so the
  // terminal knows whether any audit verdict actually moved this run.
  args: {
    cursor: v.optional(v.string()),
    denormChanges: v.optional(v.number()),
    auditRowChanges: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { cursor, denormChanges = 0, auditRowChanges = 0 },
  ): Promise<void> => {
    let denormChangeCount = denormChanges;
    let auditRowChangeCount = auditRowChanges;
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
      const auth = await loadSkillsAuth(ctx);
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
              getSkillAudits(auth, s.source, s.skillId),
            );
            const audits = response.audits ?? [];
            const { worstStatus, worstRiskLevel } = reduceWorst(audits);
            const { denormChanged, auditRowChanged } = await ctx.runMutation(
              internal.audits.writeAuditResult,
              {
                skillDocId: s.skillDocId,
                source: s.source,
                skillId: s.skillId,
                audits,
                worstStatus,
                worstRiskLevel,
              },
            );
            if (denormChanged) denormChangeCount++;
            if (auditRowChanged) auditRowChangeCount++;
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
              //
              // Counts toward the publish, with one exclusion the success arm
              // doesn't need (below). A row going fail/warn -> unknown IS a
              // denorm move (writeAuditResult patches it), and it is the only
              // transition that makes a badge DISAPPEAR — so without this the
              // OG card keeps a stale "Risk · HIGH" for a cacheLife("weeks")
              // window after the verdict was withdrawn upstream.
              const { denormChanged, auditRowChanged, isFirstRecord } =
                await ctx.runMutation(
                internal.audits.writeAuditResult,
                {
                  skillDocId: s.skillDocId,
                  source: s.source,
                  skillId: s.skillId,
                  audits: [],
                  worstStatus: "unknown",
                },
              );
              // Not `isFirstRecord`, for both tags. A never-audited row 404ing
              // writes "unknown" over an absent field and an empty audits array
              // over no row: `auditTag` renders nothing for either status, and
              // the page's audit section renders nothing for both null and [].
              // So neither surface changes. New skills arrive daily, so counting
              // those would pass the terminal's gates on most days for no
              // visible reason.
              if (denormChanged && !isFirstRecord) denormChangeCount++;
              if (auditRowChanged && !isFirstRecord) auditRowChangeCount++;
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
          {
            cursor,
            denormChanges: denormChangeCount,
            auditRowChanges: auditRowChangeCount,
          },
        );
        return;
      }
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        AUDIT_CHAIN_DELAY_MS,
        internal.audits.fetchAuditBatch,
        {
          cursor: result.nextCursor,
          denormChanges: denormChangeCount,
          auditRowChanges: auditRowChangeCount,
        },
      );
    } else {
      console.log(
        `Audit fetch chain drained (${denormChangeCount} verdict change(s), ` +
          `${auditRowChangeCount} row change(s))`,
      );
      // Publish, on two tags with two different gates, because two entries read
      // this data on two different conditions:
      //
      //   "skill-content" — the denormalized worst-status on the SKILL row,
      //                     which the OG card's badge reads. Only moves when the
      //                     rolled-up verdict moves. This chain is its only
      //                     writer, and it drains well after the content chain's
      //                     own publish (+10s vs +15s in syncSkills, then spread
      //                     over AUDIT_CHAIN_DELAY_MS-spaced batches), so riding
      //                     on that ping was never an option.
      //   "skill-audit"   — the full audit list the detail page renders. Moves
      //                     on any skillAudits row write, including a provider
      //                     re-stating a summary under an unchanged verdict.
      //                     Nothing else pings it, and loadAudits now lives a
      //                     week, so a missed ping here is a week of staleness.
      //
      // Both gated: on a weekly poll the unchanged case is the common one, and
      // an ungated ping would expire every skill's entry catalog-wide for
      // nothing. Issued in parallel — revalidateSiteTag swallows its own errors,
      // so Promise.all cannot reject.
      const pings = [];
      if (denormChangeCount > 0) pings.push(revalidateSiteTag("skill-content"));
      if (auditRowChangeCount > 0) pings.push(revalidateSiteTag("skill-audit"));
      if (pings.length > 0) await Promise.all(pings);
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
