/**
 * Read API over the skill version archive.
 *
 * Public and unauthenticated on purpose. Version history is a CATALOG feature
 * first — it is one of the few things a skill's page here can show that
 * skills.sh's cannot — and only secondarily the substrate for a watchlist's
 * "what changed" view. Gating it behind sign-in would hide the differentiator
 * from exactly the people arriving via search.
 *
 * ## Why nothing here returns file contents
 *
 * `ctx.storage.get()` (which reads bytes) is action-only in Convex; queries get
 * `ctx.storage.getUrl()`, which hands back a URL. That constraint happens to
 * produce the architecture you would want anyway: content never passes through a
 * query, so the browser (or a cached server component) fetches each version
 * straight from storage and the function pays no egress for a 15 KB file.
 *
 * It also suits the renderer. `@pierre/diffs` computes diffs client-side from
 * two full contents via `parseDiffFromFile(old, new)`, so the caller's job is to
 * fetch two URLs and hand over the strings. Nothing needs a patch computed
 * server-side, which is why none is stored — see the schema comment on
 * `skillVersions`.
 */
import { internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { getCurrentUser } from "./users";

/**
 * Timeline page size. Generous because entries are small and the common skill
 * has a handful of versions a year (~27% of the catalog changes per month, so a
 * typical row moves a few times annually). Active skills accumulate faster, so
 * this caps rather than assumes.
 */
const DEFAULT_VERSION_LIMIT = 50;
const MAX_VERSION_LIMIT = 200;

/** Severity ordering for audit verdicts. Higher is worse. */
const AUDIT_RANK: Record<string, number> = {
  unknown: 0,
  pass: 1,
  warn: 2,
  fail: 3,
};

/**
 * Consequence ordering for the dashboard feed, per PRODUCT.md principle 4: a
 * security regression outranks a description change, which outranks a body
 * edit. Not chronological — a verdict that went `pass → fail` three weeks ago
 * still matters more than a typo fix an hour ago, and a monitoring panel that
 * buries it under fresher noise has failed at its one job.
 */
const FEED_RANK: Record<FeedKind, number> = {
  audit: 3,
  description: 2,
  content: 1,
};
type FeedKind = "audit" | "description" | "content";

/**
 * Mass-change circuit breaker.
 *
 * The failure this guards against is ours, not the ecosystem's: a pipeline
 * change that rewrites content hashes catalog-wide would otherwise present as
 * "43 of your skills changed today", which is both false and exactly the kind
 * of noise that kills a monitoring product (PRODUCT.md principle 4). Precedent
 * exists — roughly 60% of production shares a single `contentUpdatedAt` from
 * the launch backfill.
 *
 * THE THRESHOLD IS INTERIM. It cannot be measured yet: `changeRateHealth`
 * against prod (Aug 2026) reports 459 baselines and ZERO real changes, because
 * the archive is a day old and nothing has been seen twice. 750 is ~5x an
 * ESTIMATE — 15k skills at the measured 27.5%/month is ~140 real changes a day.
 * The previous 250 was ~10x an estimate built on a catalog of 3,000, a number
 * that was never true. Re-run the diagnostic once the backfill finishes (~33
 * days at the current rate) and set this from what it actually reports.
 *
 * Counting is exact rather than sampled: the seek takes at most THRESHOLD rows
 * and trips iff it fills them, so there is no scan limit to undercount against
 * and the read is bounded by the threshold itself.
 *
 * The check is deliberately not free, so it is gated behind `SUPPRESSION_MIN_
 * ROWS`: a user with three changed skills needs no circuit breaker regardless
 * of what the catalog did, so the common load never pays for the scan.
 * SUPPRESSION_MIN_ROWS is a cost gate, not a considered number — and 8 rows can
 * be one event (an author pushing one repo), which a per-event count would see
 * and a per-row count cannot.
 */
const SUPPRESSION_MIN_ROWS = 8;
/** Exported so the tests seed against the live value rather than a literal. */
export const MASS_CHANGE_THRESHOLD = 750;
const MASS_CHANGE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Metadata shape shared by the timeline and the dashboard feed. */
const versionEntry = v.object({
  versionId: v.id("skillVersions"),
  changedAt: v.number(),
  syncHash: v.string(),
  previousSyncHash: v.optional(v.string()),
  frontmatterVersion: v.optional(v.string()),
  previousFrontmatterVersion: v.optional(v.string()),
  descriptionBefore: v.optional(v.string()),
  descriptionAfter: v.optional(v.string()),
  descriptionChanged: v.boolean(),
  contentChanged: v.boolean(),
  isBaseline: v.boolean(),
  rawBytes: v.number(),
  /**
   * Direct storage URL for this version's raw SKILL.md, frontmatter included.
   * Null if the blob has been removed. Callers fetch it themselves; see the
   * module header for why it is a URL rather than a string of content.
   */
  contentUrl: v.union(v.string(), v.null()),
});

async function toEntry(ctx: QueryCtx, row: Doc<"skillVersions">) {
  return {
    versionId: row._id,
    changedAt: row.changedAt,
    syncHash: row.syncHash,
    previousSyncHash: row.previousSyncHash,
    frontmatterVersion: row.frontmatterVersion,
    previousFrontmatterVersion: row.previousFrontmatterVersion,
    descriptionBefore: row.descriptionBefore,
    descriptionAfter: row.descriptionAfter,
    descriptionChanged: row.descriptionChanged,
    contentChanged: row.contentChanged,
    isBaseline: row.isBaseline,
    rawBytes: row.rawBytes,
    contentUrl: await ctx.storage.getUrl(row.rawStorageId),
  };
}

/** Resolve source+skillId through the ~200 B summary, not the ~13 KB skills row. */
async function resolveSkillDocId(
  ctx: QueryCtx,
  source: string,
  skillId: string,
): Promise<Id<"skills"> | null> {
  const summary = await ctx.db
    .query("skillSummaries")
    .withIndex("by_source_skillId", (q) =>
      q.eq("source", source).eq("skillId", skillId),
    )
    .unique();
  return summary?.skillDocId ?? null;
}

/**
 * One skill's change timeline, newest first.
 *
 * An empty array is an ordinary, expected result, not an error: the archive only
 * began recording in Aug 2026, and a skill that has not changed since then has
 * no rows at all. The UI must read that as "no changes recorded yet" rather than
 * "no history exists", because the two look identical here and mean different
 * things to a reader.
 */
export const listForSkill = query({
  args: {
    source: v.string(),
    skillId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(versionEntry),
  handler: async (ctx, { source, skillId, limit }) => {
    const skillDocId = await resolveSkillDocId(ctx, source, skillId);
    if (!skillDocId) return [];

    const take = Math.min(limit ?? DEFAULT_VERSION_LIMIT, MAX_VERSION_LIMIT);
    const rows = await ctx.db
      .query("skillVersions")
      .withIndex("by_skill_changedAt", (q) => q.eq("skillDocId", skillDocId))
      .order("desc")
      .take(take);

    return await Promise.all(rows.map((row) => toEntry(ctx, row)));
  },
});

/**
 * Fetch specific versions by id, for the diff view.
 *
 * Takes a list rather than a pair so one round trip serves both the adjacent
 * case (v3 vs v4) and the cumulative one (v2 vs v5, "everything since I added
 * this"), which is the comparison that actually justifies the feature.
 *
 * Returns in the order requested, skipping ids that no longer resolve.
 */
export const getVersions = query({
  args: { versionIds: v.array(v.id("skillVersions")) },
  returns: v.array(versionEntry),
  handler: async (ctx, { versionIds }) => {
    // Bounded so a crafted client can't ask for the whole archive in one call.
    const ids = versionIds.slice(0, MAX_VERSION_LIMIT);
    const rows = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return await Promise.all(
      rows.filter((r): r is Doc<"skillVersions"> => r !== null).map((r) =>
        toEntry(ctx, r),
      ),
    );
  },
});

/**
 * Current security verdict plus the one it replaced, for the skill page.
 *
 * Kept separate from the version timeline rather than merged into it. Both are
 * "things that happened to this skill", but audits retain only current and
 * previous (no timeline), so interleaving them would imply a completeness the
 * data does not have. Presenting them together is a layout decision for the UI,
 * which can make it honestly; doing it here would bake in a false shape.
 */
export const getAuditChange = query({
  args: { source: v.string(), skillId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      worstStatus: v.string(),
      worstRiskLevel: v.optional(v.string()),
      previousWorstStatus: v.optional(v.string()),
      previousWorstRiskLevel: v.optional(v.string()),
      worstStatusChangedAt: v.optional(v.number()),
      fetchedAt: v.number(),
      /**
       * The verdict got worse, not merely different. `pass → warn` and
       * `warn → fail` are the cases worth surfacing prominently; `fail → pass`
       * is good news and should not wear the same treatment.
       */
      regressed: v.boolean(),
    }),
  ),
  handler: async (ctx, { source, skillId }) => {
    const row = await ctx.db
      .query("skillAudits")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", source).eq("skillId", skillId),
      )
      .unique();
    if (!row) return null;

    const previous = row.previousWorstStatus;
    const regressed =
      previous !== undefined &&
      (AUDIT_RANK[row.worstStatus] ?? 0) > (AUDIT_RANK[previous] ?? 0);

    return {
      worstStatus: row.worstStatus,
      worstRiskLevel: row.worstRiskLevel,
      previousWorstStatus: row.previousWorstStatus,
      previousWorstRiskLevel: row.previousWorstRiskLevel,
      worstStatusChangedAt: row.worstStatusChangedAt,
      fetchedAt: row.fetchedAt,
      regressed,
    };
  },
});

/**
 * The dashboard feed: everything that happened to the skills in the signed-in
 * user's bundles since they last opened the bundle holding them.
 *
 * Runs the cheap direction — user → their bundles → those skills → what changed
 * — which is why no inverted skill-to-watcher index exists. An earlier design
 * built one; it turned out to be needed only for pushing email, and there is no
 * email.
 *
 * A skill filed in two bundles appears once, attributed to whichever bundle
 * makes it unread by the wider margin (the earliest baseline), so the feed
 * reflects the longest you have gone without seeing it.
 *
 * ## Two event sources, one row
 *
 * A skill can change in two independent ways, and the feed has to carry both or
 * it cannot honour PRODUCT.md's ranking. Content edits come from the version
 * archive; security regressions come from `skillAudits`, which records only
 * current-and-previous rather than a timeline. A skill that did both gets ONE
 * row headlined by the worse event, with the version attached so the diff link
 * still works.
 *
 * ## Why baselines never appear
 *
 * `isBaseline` means "this is the first time we archived this file", not "this
 * file changed". It carries no previous content, so there is nothing to diff
 * and nothing a reader could act on. Filtering it here matters more than it
 * sounds: the archive began in Aug 2026 and is still backfilling, so most
 * skills' first row is a baseline. Because a baseline is always the OLDEST row
 * for a skill, checking the newest row is enough — if that one is a baseline,
 * it is the only one.
 *
 * The trade-off is honest and temporary: a genuine change that happens to be a
 * skill's first archived row is hidden. Showing "something changed, but we
 * cannot tell you what" is worse than staying quiet, and the case disappears as
 * the archive fills.
 */
const feedItem = v.object({
  source: v.string(),
  skillId: v.string(),
  name: v.string(),
  bundleId: v.id("bundles"),
  bundleName: v.string(),
  bundleUrlId: v.string(),
  /** The headline event, already ranked by consequence. */
  kind: v.union(
    v.literal("audit"),
    v.literal("description"),
    v.literal("content"),
  ),
  /** Most recent of the events present on this row. */
  changedAt: v.number(),
  /** Present only when the verdict got worse since the baseline. */
  audit: v.optional(
    v.object({
      from: v.string(),
      to: v.string(),
      riskLevel: v.optional(v.string()),
      changedAt: v.number(),
    }),
  ),
  /** Present unless this is an audit-only row. */
  version: v.union(v.null(), versionEntry),
});

export const listRecentChangesForUser = query({
  args: { limit: v.optional(v.number()) },
  returns: v.object({
    items: v.array(feedItem),
    /**
     * The circuit breaker tripped: an implausible number of skills changed
     * catalog-wide in the last day, which in practice means our pipeline
     * reprocessed content rather than the ecosystem moving. `items` is still
     * populated — the reads are already paid for, and the caller should offer
     * them behind a disclosure rather than a second round trip — but the UI
     * must not present them as ordinary news.
     */
    suppressed: v.boolean(),
    /** Skills the user watches, for the all-clear readout's denominator. */
    watchedSkillCount: v.number(),
  }),
  handler: async (ctx, { limit }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { items: [], suppressed: false, watchedSkillCount: 0 };

    const bundles = await ctx.db
      .query("bundles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();

    // key -> the bundle context with the EARLIEST baseline, so a skill in two
    // bundles is reported against the one it has been unread in longest.
    const candidates = new Map<
      string,
      { bundle: Doc<"bundles">; source: string; skillId: string; baseline: number }
    >();

    for (const bundle of bundles) {
      for (const s of bundle.skills) {
        const baseline = Math.max(bundle.lastViewedAt ?? 0, s.addedAt ?? 0);
        const key = `${s.source}::${s.skillId}`;
        const existing = candidates.get(key);
        if (!existing || baseline < existing.baseline) {
          candidates.set(key, {
            bundle,
            source: s.source,
            skillId: s.skillId,
            baseline,
          });
        }
      }
    }

    const watchedSkillCount = candidates.size;

    const results = await Promise.all(
      Array.from(candidates.values()).map(async (c) => {
        const change = await resolveSkillChange(ctx, c);
        if (!change) return null;
        const { summary, kind, changedAt, audit, version } = change;

        return {
          source: c.source,
          skillId: c.skillId,
          name: summary.name,
          bundleId: c.bundle._id,
          bundleName: c.bundle.name,
          bundleUrlId: c.bundle.urlId,
          kind,
          changedAt,
          audit,
          version: version ? await toEntry(ctx, version) : null,
        };
      }),
    );

    const items = results
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort(
        (a, b) =>
          FEED_RANK[b.kind] - FEED_RANK[a.kind] || b.changedAt - a.changedAt,
      )
      .slice(0, Math.min(limit ?? DEFAULT_VERSION_LIMIT, MAX_VERSION_LIMIT));

    return {
      items,
      suppressed:
        items.length >= SUPPRESSION_MIN_ROWS
          ? await isCatalogWideChangeEvent(ctx)
          : false,
      watchedSkillCount,
    };
  },
});

/**
 * Did the whole catalog move at once? See `MASS_CHANGE_THRESHOLD`.
 *
 * Baselines are excluded IN THE INDEX, not after the read. They outnumber real
 * changes by orders of magnitude during backfill (459 to 0 on the day this was
 * written), so a capped read that filters afterwards spends its whole budget on
 * baselines and reports zero — a breaker that fails silent. Seeking on the flag
 * makes the read bounded by real changes alone.
 *
 * `take(THRESHOLD)` rather than a larger scan: the only question is whether the
 * count reaches the threshold, so filling the take IS the answer. Exact, and it
 * reads no more rows than the number it is looking for.
 */
async function isCatalogWideChangeEvent(ctx: QueryCtx): Promise<boolean> {
  const since = Date.now() - MASS_CHANGE_WINDOW_MS;
  const realChanges = await ctx.db
    .query("skillVersions")
    .withIndex("by_isBaseline_changedAt", (q) =>
      q.eq("isBaseline", false).gte("changedAt", since),
    )
    .take(MASS_CHANGE_THRESHOLD);

  return realChanges.length >= MASS_CHANGE_THRESHOLD;
}

/**
 * "What happened to this skill since `baseline`?" — the one place that answers
 * it, shared by the dashboard panel and the bundle register.
 *
 * Both surfaces ask the same question of different sets, and an earlier draft
 * had the logic twice. The parts that are easy to get subtly wrong — audits not
 * being gated on the content timestamp, baselines being excluded, the
 * consequence ranking — are exactly the parts that must not drift between two
 * views the user reads minutes apart.
 */
async function resolveSkillChange(
  ctx: QueryCtx,
  target: { source: string; skillId: string; baseline: number },
) {
  const summary = await ctx.db
    .query("skillSummaries")
    .withIndex("by_source_skillId", (q) =>
      q.eq("source", target.source).eq("skillId", target.skillId),
    )
    .unique();
  if (!summary) return null;

  // The mirrored timestamp answers "did the content move?" from a ~200 B row,
  // so only genuinely-unread skills go on to touch the archive. The audit
  // lookup is NOT gated on it: a verdict can regress on a re-audit of
  // byte-identical content, and that is the highest-severity event there is.
  const contentMoved =
    summary.contentUpdatedAt !== undefined &&
    summary.contentUpdatedAt > target.baseline;

  const [latest, auditRow] = await Promise.all([
    contentMoved
      ? ctx.db
          .query("skillVersions")
          .withIndex("by_skill_changedAt", (q) =>
            q.eq("skillDocId", summary.skillDocId),
          )
          .order("desc")
          .first()
      : Promise.resolve(null),
    ctx.db
      .query("skillAudits")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", target.source).eq("skillId", target.skillId),
      )
      .unique(),
  ]);

  // See the module header: a baseline has no previous content to diff against.
  const version = latest && !latest.isBaseline ? latest : null;

  const previousStatus = auditRow?.previousWorstStatus;
  const auditChangedAt = auditRow?.worstStatusChangedAt;
  const audit =
    auditRow &&
    previousStatus !== undefined &&
    auditChangedAt !== undefined &&
    auditChangedAt > target.baseline &&
    (AUDIT_RANK[auditRow.worstStatus] ?? 0) > (AUDIT_RANK[previousStatus] ?? 0)
      ? {
          from: previousStatus,
          to: auditRow.worstStatus,
          riskLevel: auditRow.worstRiskLevel,
          changedAt: auditChangedAt,
        }
      : undefined;

  if (!version && !audit) return null;

  const kind: FeedKind = audit
    ? "audit"
    : version?.descriptionChanged
      ? "description"
      : "content";

  return {
    summary,
    kind,
    changedAt: Math.max(audit?.changedAt ?? 0, version?.changedAt ?? 0),
    audit,
    version,
  };
}

/**
 * Changes to the skills in ONE bundle, keyed by `source::skillId`.
 *
 * A map rather than a list because the caller already has the bundle's skills
 * and needs to decorate them in place — the register renders every skill, in
 * consequence order, with the changed ones carrying their payload. A separate
 * list would have to be re-joined against the roster on the client.
 *
 * Access mirrors `bundles.getByUrlId` exactly: a closed bundle answers only to
 * its owner. Divergence here would be a leak, so the check is deliberately the
 * same two lines rather than anything cleverer.
 *
 * The baseline is `addedAt` alone, NOT `max(lastViewedAt, addedAt)`. This page
 * answers "what has changed since I added this", which does not clear when you
 * look — the dashboard panel owns the read-state question, and giving the two
 * surfaces the same baseline would make opening the bundle erase its own
 * contents.
 */
export const listChangesForBundle = query({
  args: { urlId: v.string() },
  returns: v.array(
    v.object({
      key: v.string(),
      kind: v.union(
        v.literal("audit"),
        v.literal("description"),
        v.literal("content"),
      ),
      changedAt: v.number(),
      audit: v.optional(
        v.object({
          from: v.string(),
          to: v.string(),
          riskLevel: v.optional(v.string()),
          changedAt: v.number(),
        }),
      ),
      version: v.union(v.null(), versionEntry),
    }),
  ),
  handler: async (ctx, { urlId }) => {
    const [bundle, currentUser] = await Promise.all([
      ctx.db
        .query("bundles")
        .withIndex("by_urlId", (q) => q.eq("urlId", urlId))
        .unique(),
      getCurrentUser(ctx),
    ]);
    if (!bundle) return [];

    const isOwner = currentUser !== null && currentUser._id === bundle.userId;
    if (!bundle.isPublic && !isOwner) return [];

    const rows = await Promise.all(
      bundle.skills.map(async (s) => {
        const change = await resolveSkillChange(ctx, {
          source: s.source,
          skillId: s.skillId,
          baseline: s.addedAt ?? 0,
        });
        if (!change) return null;
        return {
          key: `${s.source}::${s.skillId}`,
          kind: change.kind,
          changedAt: change.changedAt,
          audit: change.audit,
          version: change.version
            ? await toEntry(ctx, change.version)
            : null,
        };
      }),
    );

    return rows.filter((r): r is NonNullable<typeof r> => r !== null);
  },
});

/**
 * Diagnostic: what does a normal day of change actually look like?
 *
 * `MASS_CHANGE_THRESHOLD` is only meaningful as a multiple of the ordinary
 * daily rate, and the ordinary daily rate had been INFERRED from catalog size
 * rather than measured. That inference was wrong twice (this file said 3,000
 * skills; `schema.ts` said 9.5k; prod is ~15k), which is reason enough to stop
 * inferring it. Read-only, no auth, safe to run against prod:
 *
 *   npx convex run skillVersions:changeRateHealth --prod
 *
 * `realChanges` is the number the breaker actually counts. Set the threshold to
 * roughly 5x a busy day: under that it is a tripwire that fires on ordinary
 * Tuesdays, far over it and it never fires at all.
 *
 * `baselines` reads the backfill's progress, not the change rate. All-baselines
 * with zero real changes means the archive has not seen anything twice yet and
 * this diagnostic cannot answer the question — wait, do not tune on it.
 */
export const changeRateHealth = internalQuery({
  args: { days: v.optional(v.number()) },
  returns: v.object({
    windows: v.array(
      v.object({
        endingDaysAgo: v.number(),
        rows: v.number(),
        realChanges: v.number(),
        baselines: v.number(),
        capped: v.boolean(),
      }),
    ),
    threshold: v.number(),
  }),
  handler: async (ctx, { days }) => {
    // Deliberately bounded per window. Rows carry descriptions inline, so an
    // unbounded scan across a week would hit Convex's per-query byte ceiling
    // and fail rather than report.
    const PER_WINDOW_CAP = 4000;
    const windowCount = Math.min(Math.max(days ?? 7, 1), 14);
    const now = Date.now();
    const windows = [];

    for (let i = 0; i < windowCount; i++) {
      const end = now - i * MASS_CHANGE_WINDOW_MS;
      const start = end - MASS_CHANGE_WINDOW_MS;
      const rows = await ctx.db
        .query("skillVersions")
        .withIndex("by_changedAt", (q) =>
          q.gte("changedAt", start).lt("changedAt", end),
        )
        .take(PER_WINDOW_CAP);

      const baselines = rows.filter((r) => r.isBaseline).length;
      windows.push({
        endingDaysAgo: i,
        rows: rows.length,
        realChanges: rows.length - baselines,
        baselines,
        capped: rows.length === PER_WINDOW_CAP,
      });
    }

    return { windows, threshold: MASS_CHANGE_THRESHOLD };
  },
});
