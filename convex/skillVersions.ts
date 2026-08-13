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
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { appDay } from "./lib/appDay";
import { isGitHubSource } from "./lib/source";
import { getCurrentUser } from "./users";
import {
  CONDITION_RANK,
  isFault,
  resolveCondition,
  type ChangeKind,
} from "../lib/monitoring/conditions";

/**
 * Timeline page size. Generous because entries are small and the common skill
 * has a handful of versions a year (~27% of the catalog changes per month, so a
 * typical row moves a few times annually). Active skills accumulate faster, so
 * this caps rather than assumes.
 */
const DEFAULT_VERSION_LIMIT = 50;
const MAX_VERSION_LIMIT = 200;

/**
 * How many watched skills the dashboard feed will actually resolve per load.
 *
 * See the fan-out comment in `listRecentChangesForUser`. 500 is far above any
 * plausible personal setup (free accounts cap at 25 distinct skills) and well
 * inside the per-query read budget at 2-3 reads apiece.
 */
const MAX_FEED_CANDIDATES = 500;

/** Severity ordering for audit verdicts. Higher is worse. */
const AUDIT_RANK: Record<string, number> = {
  unknown: 0,
  pass: 1,
  warn: 2,
  fail: 3,
};

/**
 * Consequence ordering comes from `CONDITION_RANK` in lib/monitoring — the same
 * table the register sorts by. It used to be a second, shorter list here
 * (`FEED_RANK`, audit/description/content only), which is precisely how the
 * dashboard ended up unable to rank a delisted skill: the ordering it owned had
 * no row for one.
 *
 * Not chronological, per PRODUCT.md principle 4 — a verdict that went
 * `pass → fail` three weeks ago still matters more than a typo fix an hour ago.
 */
const CONDITION_VALIDATOR = v.union(
  v.literal("audit"),
  v.literal("delisted"),
  v.literal("fetch-error"),
  v.literal("description"),
  v.literal("content"),
);

const CHANGE_KIND_VALIDATOR = v.union(
  v.literal("audit"),
  v.literal("description"),
  v.literal("content"),
);

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
 * `isBaseline` means "this row is a starting point", not "this file changed" —
 * a copy taken so later rows have something to compare against. Nothing about
 * it is actionable, so it never reaches the feed. Because a baseline is always
 * the OLDEST row for a skill, checking the newest row is enough: if that one is
 * a baseline, it is the only one.
 *
 * What is deliberately NOT filtered here is a real change that happens to be a
 * skill's first archived row. That case is why `recordSkillVersion` sets the
 * flag from `previousSyncHash` rather than from "no predecessor row" — every
 * well-known source is in exactly that position, having been skipped by the
 * GitHub-only backfill. Such a row has no predecessor blob and so no body diff,
 * but it does carry `descriptionBefore` off the live skills row, which is the
 * high-severity half. Reporting "the description moved, here it is, no body
 * diff available" beats silence.
 */
const feedItem = v.object({
  source: v.string(),
  skillId: v.string(),
  name: v.string(),
  bundleId: v.id("bundles"),
  bundleName: v.string(),
  bundleUrlId: v.string(),
  /**
   * The row's condition, already ranked by consequence. Includes the two FAULT
   * states (`delisted`, `fetch-error`), which are conditions of the skill
   * rather than events in the archive — see `isFault` in lib/monitoring.
   */
  condition: CONDITION_VALIDATOR,
  /** The archive event, absent on a fault row (nothing happened; it IS wrong). */
  kind: v.optional(CHANGE_KIND_VALIDATOR),
  /**
   * Most recent of the events present on this row. NULL on a fault: nothing
   * records when a skill was delisted, and the UI must render no time rather
   * than a confident wrong one.
   */
  changedAt: v.union(v.number(), v.null()),
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
    /**
     * How many of `watchedSkillCount` this load actually resolved. Lower than
     * the total when the fan-out truncated — see `MAX_FEED_CANDIDATES`.
     *
     * A COUNT rather than a `truncated` boolean, because the flag version was
     * returned, validated, documented and then read by nothing: the all-clear
     * went on saying "watching N skills, all as you last left them" over the
     * full N while having checked only the first 500. That is the same
     * false-reassurance defect as the delisted-skill blocker, one layer along.
     */
    checkedSkillCount: v.number(),
  }),
  handler: async (ctx, { limit }) => {
    const user = await getCurrentUser(ctx);
    if (!user)
      return {
        items: [],
        suppressed: false,
        watchedSkillCount: 0,
        checkedSkillCount: 0,
      };

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

    // BOUNDED FAN-OUT. `resolveSkillChange` costs 2-3 indexed reads per
    // candidate, and the `limit` arg trims the RESPONSE, not the work — so this
    // query's cost scaled with everything the user watches, on every dashboard
    // load and on every re-emit of any bundle mutation. Unbounded, a large
    // enough account hits Convex's per-query read ceiling and the dashboard
    // fails outright rather than degrading.
    //
    // Oldest baseline first, so the unchecked tail is the part the reader has
    // seen most recently. The count of what was actually scanned is returned
    // rather than swallowed, and the all-clear reads it: a monitoring product
    // silently checking only part of your list is the same class of lie as a
    // false all-clear.
    const ordered = Array.from(candidates.values()).sort(
      (a, b) => a.baseline - b.baseline,
    );
    const scanned = ordered.slice(0, MAX_FEED_CANDIDATES);

    const results = await Promise.all(
      scanned.map(async (c) => {
        const change = await resolveSkillChange(ctx, c);
        if (!change) return null;
        const { summary, condition, kind, changedAt, audit, version } = change;

        return {
          source: c.source,
          skillId: c.skillId,
          name: summary.name,
          bundleId: c.bundle._id,
          bundleName: c.bundle.name,
          bundleUrlId: c.bundle.urlId,
          condition,
          kind,
          changedAt,
          audit,
          version: version ? await toEntry(ctx, version) : null,
        };
      }),
    );

    const items = results
      .filter((r): r is NonNullable<typeof r> => r !== null)
      // Consequence, then recency, then name. Faults sort by name inside their
      // rank because they have no date — falling back to 0 would order them
      // arbitrarily and re-order them on unrelated writes.
      .sort(
        (a, b) =>
          CONDITION_RANK[b.condition] - CONDITION_RANK[a.condition] ||
          (b.changedAt ?? 0) - (a.changedAt ?? 0) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, Math.min(limit ?? DEFAULT_VERSION_LIMIT, MAX_VERSION_LIMIT));

    return {
      items,
      // Counted over CHANGES only. A fault is not something the breaker can
      // disbelieve — a delisted skill is delisted whatever the pipeline did —
      // so faults neither trip suppression nor get held back by it.
      suppressed: await resolveSuppression(
        ctx,
        items.filter((i) => !isFault(i.condition)).length,
      ),
      watchedSkillCount,
      checkedSkillCount: scanned.length,
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
 * The gate in front of the breaker, shared by both surfaces.
 *
 * The scan is not free, so it only runs once a reader has enough changed rows
 * for a wall of them to be a problem. Lifted out of the dashboard query because
 * the register needs the identical answer: the breaker exists so the product
 * does not assert changes it disbelieves, and it was only wired to the
 * dashboard — so a catalog-wide reprocess produced "holding these back" on the
 * home page and a flat "Changed" on forty rows one click away.
 */
async function resolveSuppression(
  ctx: QueryCtx,
  changeCount: number,
): Promise<boolean> {
  if (changeCount < SUPPRESSION_MIN_ROWS) return false;
  return await isCatalogWideChangeEvent(ctx);
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

  const kind: ChangeKind | undefined = audit
    ? "audit"
    : version
      ? version.descriptionChanged
        ? "description"
        : "content"
      : undefined;

  const condition = resolveCondition(summary, kind);

  // Steady means nothing happened AND nothing is wrong — the only case with
  // nothing to report. Faults reach here with no `kind`, which is exactly why
  // the earlier `if (!version && !audit) return null` hid them: a delisted
  // dependency produced no event, so the dashboard rendered a green all-clear
  // over it while the register called it Needs attention.
  if (condition === "steady") return null;

  return {
    summary,
    condition,
    kind,
    // Null for faults. Nothing records when a skill was delisted, and inventing
    // a timestamp would put a confident "2 hours ago" on a fact we cannot date.
    changedAt: kind
      ? Math.max(audit?.changedAt ?? 0, version?.changedAt ?? 0)
      : null,
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
  returns: v.object({
    items: v.array(
      v.object({
        key: v.string(),
        condition: CONDITION_VALIDATOR,
        kind: v.optional(CHANGE_KIND_VALIDATOR),
        changedAt: v.union(v.number(), v.null()),
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
    /** Same meaning as on the dashboard feed — see `resolveSuppression`. */
    suppressed: v.boolean(),
  }),
  handler: async (ctx, { urlId }) => {
    const [bundle, currentUser] = await Promise.all([
      ctx.db
        .query("bundles")
        .withIndex("by_urlId", (q) => q.eq("urlId", urlId))
        .unique(),
      getCurrentUser(ctx),
    ]);
    if (!bundle) return { items: [], suppressed: false };

    const isOwner = currentUser !== null && currentUser._id === bundle.userId;
    if (!bundle.isPublic && !isOwner) return { items: [], suppressed: false };

    const rows = await Promise.all(
      bundle.skills.map(async (s) => {
        const change = await resolveSkillChange(ctx, {
          source: s.source,
          skillId: s.skillId,
          // `bundle.createdAt`, not 0, for entries predating `addedAt`. Epoch 0
          // would replay every version and every audit regression ever recorded
          // for that skill, and because this surface never clears on view the
          // row would sit in Needs attention forever, dated from before the
          // user owned the bundle. The bundle's own creation is the earliest
          // moment they could plausibly be accountable for it.
          baseline: s.addedAt ?? bundle.createdAt,
        });
        if (!change) return null;
        return {
          key: `${s.source}::${s.skillId}`,
          condition: change.condition,
          kind: change.kind,
          changedAt: change.changedAt,
          audit: change.audit,
          version: change.version
            ? await toEntry(ctx, change.version)
            : null,
        };
      }),
    );

    const items = rows.filter((r): r is NonNullable<typeof r> => r !== null);

    return {
      items,
      suppressed: await resolveSuppression(
        ctx,
        items.filter((i) => !isFault(i.condition)).length,
      ),
    };
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
 *     npx convex run skillVersions:auditBaselineLabels --prod
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
        internal.skillVersions.scanBaselineLabelsPage,
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
 *     npx convex run skillVersions:repairBaselineLabels --prod
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
 * Collect ids to repair, WITHOUT writing. Reading and writing are two passes on
 * purpose: patching a row clears the flag this scan filters on, so mutating
 * mid-pagination would shift the index under its own cursor and skip rows. The
 * mislabeled set is small enough (hundreds) to hold in one list.
 */
export const listMislabeledBaselineIds = internalQuery({
  args: { cursor: v.optional(v.string()), pageSize: v.optional(v.number()) },
  returns: v.object({
    ids: v.array(v.id("skillVersions")),
    scanned: v.number(),
    nextCursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor, pageSize }) => {
    const numItems = Math.min(
      Math.max(pageSize ?? BASELINE_AUDIT_PAGE, 1),
      BASELINE_AUDIT_PAGE,
    );
    const result = await ctx.db
      .query("skillVersions")
      .withIndex("by_isBaseline_changedAt", (q) => q.eq("isBaseline", true))
      .paginate({ numItems, cursor: cursor ?? null });

    return {
      ids: result.page
        .filter((row) => row.previousSyncHash !== undefined)
        .map((row) => row._id),
      scanned: result.page.length,
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
  args: { maxPages: v.optional(v.number()), maxRows: v.optional(v.number()) },
  returns: v.object({
    found: v.number(),
    patched: v.number(),
    baselineRowsScanned: v.number(),
    pages: v.number(),
    scanComplete: v.boolean(),
    aborted: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { maxPages, maxRows }) => {
    const pageBudget = Math.min(Math.max(maxPages ?? 200, 1), 500);
    // A ceiling on how much this is allowed to touch. The audit reported 605;
    // anything near this cap means the match condition is wrong, and stopping
    // beats patching the archive on a bad predicate.
    const rowCap = Math.min(Math.max(maxRows ?? 5_000, 1), 20_000);

    let cursor: string | undefined;
    let pages = 0;
    let baselineRowsScanned = 0;
    let scanComplete = false;
    let aborted: string | null = null;
    const ids: Id<"skillVersions">[] = [];

    while (pages < pageBudget) {
      const page: {
        ids: Id<"skillVersions">[];
        scanned: number;
        nextCursor: string | null;
        isDone: boolean;
      } = await ctx.runQuery(internal.skillVersions.listMislabeledBaselineIds, {
        cursor,
      });
      pages++;
      baselineRowsScanned += page.scanned;
      ids.push(...page.ids);
      if (ids.length > rowCap) {
        aborted = `match count ${ids.length} exceeded maxRows ${rowCap} — nothing patched`;
        console.error(`repairBaselineLabels aborted: ${aborted}`);
        return {
          found: ids.length,
          patched: 0,
          baselineRowsScanned,
          pages,
          scanComplete: false,
          aborted,
        };
      }
      if (page.isDone) {
        scanComplete = true;
        break;
      }
      cursor = page.nextCursor ?? undefined;
    }

    let patched = 0;
    for (let i = 0; i < ids.length; i += REPAIR_PATCH_BATCH) {
      patched += await ctx.runMutation(
        internal.skillVersions.clearBaselineFlags,
        { ids: ids.slice(i, i + REPAIR_PATCH_BATCH) },
      );
    }

    console.log(
      `repairBaselineLabels: patched ${patched} of ${ids.length} matched` +
        ` across ${baselineRowsScanned} baseline rows` +
        `${scanComplete ? "" : " — SCAN INCOMPLETE, re-run to finish"}`,
    );
    return {
      found: ids.length,
      patched,
      baselineRowsScanned,
      pages,
      scanComplete,
      aborted,
    };
  },
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
//     npx convex run skillVersions:repairBaselineDescriptionClaims --prod
//
// Write-side fixed first, then this — same ordering rule as above, for the same
// reason: repair before the fix is live and the pipeline just makes more.
//
// Idempotent: a repaired row no longer matches the filter, so a second run finds
// nothing.
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
  returns: v.object({
    ids: v.array(v.id("skillVersions")),
    scanned: v.number(),
    nextCursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor, pageSize }) => {
    const numItems = Math.min(
      Math.max(pageSize ?? BASELINE_AUDIT_PAGE, 1),
      BASELINE_AUDIT_PAGE,
    );
    const result = await ctx.db
      .query("skillVersions")
      .withIndex("by_isBaseline_changedAt", (q) => q.eq("isBaseline", true))
      .paginate({ numItems, cursor: cursor ?? null });

    return {
      ids: result.page
        .filter(
          (row) =>
            row.previousSyncHash === undefined &&
            (row.descriptionChanged || row.descriptionBefore !== undefined),
        )
        .map((row) => row._id),
      scanned: result.page.length,
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
      // `descriptionAfter` stays. It is what the file said when we first copied
      // it, which is true and is what the timeline reads for the anchor row.
      await ctx.db.patch(id, {
        descriptionChanged: false,
        descriptionBefore: undefined,
      });
      patched++;
    }
    return patched;
  },
});

export const repairBaselineDescriptionClaims = internalAction({
  args: { maxPages: v.optional(v.number()), maxRows: v.optional(v.number()) },
  returns: v.object({
    found: v.number(),
    patched: v.number(),
    baselineRowsScanned: v.number(),
    pages: v.number(),
    scanComplete: v.boolean(),
    aborted: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { maxPages, maxRows }) => {
    const pageBudget = Math.min(Math.max(maxPages ?? 200, 1), 500);
    // Same abort valve as `repairBaselineLabels`, and it matters more here
    // because this one edits the CONTENT of a row rather than a flag. A match
    // count near the cap means the predicate is wrong; stop rather than rewrite
    // the archive on it.
    const rowCap = Math.min(Math.max(maxRows ?? 5_000, 1), 20_000);

    let cursor: string | undefined;
    let pages = 0;
    let baselineRowsScanned = 0;
    let scanComplete = false;
    let aborted: string | null = null;
    const ids: Id<"skillVersions">[] = [];

    while (pages < pageBudget) {
      const page: {
        ids: Id<"skillVersions">[];
        scanned: number;
        nextCursor: string | null;
        isDone: boolean;
      } = await ctx.runQuery(
        internal.skillVersions.listBaselineDescriptionClaimIds,
        { cursor },
      );
      pages++;
      baselineRowsScanned += page.scanned;
      ids.push(...page.ids);
      if (ids.length > rowCap) {
        aborted = `match count ${ids.length} exceeded maxRows ${rowCap} — nothing patched`;
        console.error(`repairBaselineDescriptionClaims aborted: ${aborted}`);
        return {
          found: ids.length,
          patched: 0,
          baselineRowsScanned,
          pages,
          scanComplete: false,
          aborted,
        };
      }
      if (page.isDone) {
        scanComplete = true;
        break;
      }
      cursor = page.nextCursor ?? undefined;
    }

    let patched = 0;
    for (let i = 0; i < ids.length; i += REPAIR_PATCH_BATCH) {
      patched += await ctx.runMutation(
        internal.skillVersions.clearBaselineDescriptionClaims,
        { ids: ids.slice(i, i + REPAIR_PATCH_BATCH) },
      );
    }

    console.log(
      `repairBaselineDescriptionClaims: patched ${patched} of ${ids.length} matched` +
        ` across ${baselineRowsScanned} baseline rows` +
        `${scanComplete ? "" : " — SCAN INCOMPLETE, re-run to finish"}`,
    );
    return {
      found: ids.length,
      patched,
      baselineRowsScanned,
      pages,
      scanComplete,
      aborted,
    };
  },
});

// ---------------------------------------------------------------------------
// WRITE PATH
//
// Moved here from skills.ts, which is 4.2k lines of sync pipeline. Nothing in
// either function needs pipeline context — they touch `skillVersions` and
// `_storage` and nothing else — so splitting the archive by CRUD verb meant a
// reader looking for "how does a version get written" had to find it inside the
// sync module. The action-side `archiveSkillVersion` stays in skills.ts,
// because storing a blob is action-only and that IS pipeline work.
// ---------------------------------------------------------------------------

/**
 * Pull `version` out of SKILL.md frontmatter, for the version archive's
 * timeline ("4.0.3 → 4.0.4" reads far better than a hash delta, and a major
 * bump is a real severity signal).
 *
 * Deliberately STRICT where `extractFrontmatterDescription` above is forgiving.
 * A description is prose that authors wrap, quote, and fold across lines, so its
 * parser has to cope with block scalars. A version is a short scalar on one line
 * or it is not a version. Matching anything looser would turn a malformed field
 * into a fake "version changed" event, and the entire value of this field is
 * that when it does report a bump, the bump is real.
 *
 * Returns null when absent, which is the common case — most skills declare no
 * version, so this enriches the timeline rather than carrying it.
 */
export function extractFrontmatterVersion(content: string): string | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  const single = match[1].match(
    /^version:[ \t]*["']?([A-Za-z0-9][A-Za-z0-9.+_-]*)["']?[ \t]*$/m,
  );
  return single ? single[1].trim() : null;
}

/**
 * Append one row to the version archive, taking ownership of an already-stored
 * raw blob.
 *
 * Split from the content write on purpose: `ctx.storage.store` is action-only in
 * Convex, so the blob has to exist before this mutation runs, which means this
 * function is responsible for deleting it again on every path that decides not
 * to keep it. Every early return below does that.
 */
export const recordSkillVersion = internalMutation({
  args: {
    skillDocId: v.id("skills"),
    rawStorageId: v.id("_storage"),
    rawBytes: v.number(),
    syncHash: v.string(),
    previousSyncHash: v.optional(v.string()),
    frontmatterVersion: v.optional(v.string()),
    descriptionBefore: v.optional(v.string()),
    descriptionAfter: v.optional(v.string()),
    descriptionChanged: v.boolean(),
    contentChanged: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const skill = await ctx.db.get(args.skillDocId);
    if (!skill) {
      // Row deleted between the content write and this call. Drop the blob
      // rather than orphan it — nothing would ever reference it again, and file
      // storage has no reaper of its own.
      await ctx.storage.delete(args.rawStorageId);
      return null;
    }

    const latest = await ctx.db
      .query("skillVersions")
      .withIndex("by_skill_changedAt", (q) =>
        q.eq("skillDocId", args.skillDocId),
      )
      .order("desc")
      .first();

    // Idempotency. `fetchSkillContent` retries up to three times, and the whole
    // content chain can be re-triggered by hand from /dev, so the same hash can
    // legitimately arrive twice. Without this guard a retry writes a duplicate
    // row and a phantom "changed" event — precisely the noise that PRODUCT.md's
    // "earn every alert" principle exists to prevent.
    if (latest && latest.syncHash === args.syncHash) {
      await ctx.storage.delete(args.rawStorageId);
      return null;
    }

    // A baseline is a STARTING POINT, not an event, so it cannot carry a
    // description CHANGE either — there is no earlier description for the
    // description to have moved from.
    //
    // The two content writers infer `descriptionChanged` by comparing the file
    // against the live skills row (`updateDescription`, `updateSkillFromDetail`).
    // For a row whose first content is only now arriving that comparison is
    // `undefined !== "..."`, which is true, so the archive got a first row
    // badged "Description changed" with a before-value of None. That is our own
    // two-step ingest showing through: the add writes the row, the content chain
    // fills it in later. Nothing upstream changed.
    //
    // The one-time baseline backfill (skills.ts) already got this right by
    // hardcoding `descriptionChanged: false` with no `descriptionBefore`, which
    // is why a skill it covered shows a bare "Earliest recorded version" while a
    // skill added after it showed the None-to-something block. Deriving both
    // fields from the flag here is what stops those two paths from disagreeing.
    //
    // Only the two REAL baselines are affected. A first archived row that is a
    // genuine detected change (every well-known source — see the flag comment
    // below) has a `previousSyncHash`, so it keeps its description change.
    const isBaseline = latest === null && args.previousSyncHash === undefined;

    await ctx.db.insert("skillVersions", {
      skillDocId: args.skillDocId,
      source: skill.source,
      skillId: skill.skillId,
      changedAt: Date.now(),
      syncHash: args.syncHash,
      previousSyncHash: args.previousSyncHash,
      rawStorageId: args.rawStorageId,
      rawBytes: args.rawBytes,
      frontmatterVersion: args.frontmatterVersion,
      // Read off the predecessor row rather than passed in by the caller: the
      // caller knows what the file says now, only the archive knows what it said
      // last time.
      previousFrontmatterVersion: latest?.frontmatterVersion,
      descriptionBefore: isBaseline ? undefined : args.descriptionBefore,
      descriptionAfter: args.descriptionAfter,
      descriptionChanged: isBaseline ? false : args.descriptionChanged,
      contentChanged: args.contentChanged,
      // A baseline is a STARTING POINT, not an event: the first copy we ever
      // took of a file we had no prior record of. Both halves of that matter.
      //
      // `latest === null` alone was wrong, and it cost every well-known source
      // one change. The one-time backfill covered GitHub skills only
      // (`listSkillsNeedingBaseline` filters on `isGitHubSource && skillMdUrl`),
      // so a well-known skill still has an empty archive while its skills row
      // has carried a `syncHash` since long before the archive existed. Its
      // first archived row is therefore a genuine detected change — and calling
      // that a baseline hid it, because the feed drops baselines.
      //
      // `previousSyncHash` is the discriminator, and the callers already supply
      // it: both content writers pass the hash the skills row held before this
      // write, so it is set exactly when a previous copy existed. The backfill
      // passes none, and neither does a skill's genuine first content fetch.
      // Those two are the real baselines.
      //
      // This deliberately decouples the flag from "has a predecessor blob": a
      // first-row real change now reports as a change while still having no
      // blob to diff against. Both readers already cope. `descriptionBefore`
      // comes off the live skills row rather than the archive, and the timeline
      // anchors on `isBaseline || !previous` (skill-history.tsx) rather than on
      // the flag alone.
      isBaseline,
    });

    return null;
  },
});
