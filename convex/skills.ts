import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import type { MutationCtx, ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import {
  embedTexts,
  truncateForEmbedding,
  EmbeddingInputTooLongError,
} from "./lib/embeddings";
import {
  listSkills as v1ListSkills,
  getSkillDetail as v1GetSkillDetail,
  getSkillSyncData as v1GetSkillSyncData,
  SkillsApiNotFoundError,
  SkillsApiRateLimitError,
  withTransientRetry,
  type V1SkillDetail,
} from "./lib/skillsApi";
import {
  resolveDefaultBranch,
  fetchRepoTree,
  NOT_MODIFIED,
} from "./lib/github";
import { revalidateHomeTag } from "./lib/revalidate";
import { appDay } from "./lib/appDay";
import { isGitHubSource } from "./lib/source";
import {
  fetchRawText,
  indexSkillMds,
  parseSkillMdName,
  rawGitHubUrl,
} from "./lib/github";
import type { Placement } from "./lib/discoveryPlacement";
import {
  planDirPlacements,
  planNamePlacements,
  planProbePlacements,
} from "./lib/discoveryPlacement";
import { MAX_DISCOVERY_FAILURES, assertAdmin } from "./devStats";
import { parseSkillInput } from "../lib/parse-skill-input";
import { getCurrentUser } from "./users";
import {
  gitHubQuotaValidator,
  countGitHubOnlyAdds,
  computeGitHubAddQuota,
  quotaExceededError,
} from "./lib/githubQuota";
import { kickPostAddChain } from "./lib/postAdd";
import { toPublicError } from "./lib/publicError";

// ---------------------------------------------------------------------------
// Sync actions
// ---------------------------------------------------------------------------

const BATCH_SIZE = 20;
// Largest perPage the v1 listing endpoint supports. Picking the max cuts our
// listing-call count by 5x compared to the previous 100/page default.
const LIST_PER_PAGE = 500;

export const syncSkills = internalAction({
  args: {},
  handler: async (ctx) => {
    let page = 0;
    let hasMore = true;
    let totalSynced = 0;

    // Pin the snapshot day once, up front, so every batch this run writes lands
    // in the same day-bucket even if the run crosses the day boundary (LA
    // midnight, only ~1–2h after the 06:00 UTC cron — so this genuinely matters,
    // not just belt-and-suspenders). See the `day` arg on upsertSkillsBatch.
    const day = appDay(Date.now());

    while (hasMore) {
      let response;
      try {
        response = await v1ListSkills({
          view: "all-time",
          page,
          perPage: LIST_PER_PAGE,
        });
      } catch (e) {
        if (e instanceof SkillsApiRateLimitError) {
          // Re-schedule the whole sync after the API tells us it's safe.
          // Whole-sync re-schedule (vs. resuming at this page) is fine — the
          // upsert path is idempotent and most rows hash-skip quickly.
          console.warn(
            `Rate-limited at page ${page}; rescheduling syncSkills in ${e.retryAfterSeconds}s`,
          );
          await ctx.scheduler.runAfter(
            e.retryAfterSeconds * 1000,
            internal.skills.syncSkills,
            {},
          );
          return;
        }
        console.error(`syncSkills failed at page ${page}:`, e);
        break;
      }

      const { data, pagination } = response;

      // Filter the long tail (matches pre-v1 behavior). Map slug → skillId so
      // existing tables/indexes don't change name. `isDuplicate` is preserved
      // so the upsert path can persist it for default-filtering. `rank` is the
      // global all-time install rank (1..N), derived from the row's position in
      // this leaderboard-ordered response (computed BEFORE the filter so the
      // dropped long tail doesn't shift positions). Powers the rank/percentile
      // stat on the skill page.
      // No install-floor filter: we ingest the full leaderboard. The old
      // MIN_INSTALLS=50 cutoff barely filtered anything (9,536 of 9,589 rows are
      // 500+) and it stranded existing rows that dropped below it — e.g. a
      // renamed repo whose installs collapsed to ~12 would freeze at its old
      // inflated count because the sync skipped it. Walking to the end keeps
      // every listed skill's count current and lets such rows sink correctly.
      const normalized = data.map((s, idx) => ({
        source: s.source,
        skillId: s.slug,
        name: s.name,
        installs: s.installs,
        isDuplicate: s.isDuplicate ?? false,
        rank: page * LIST_PER_PAGE + idx + 1,
      }));

      if (normalized.length === 0) {
        break; // empty page — end of the leaderboard
      }

      for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
        const batch = normalized.slice(i, i + BATCH_SIZE);
        await ctx.runMutation(internal.skills.upsertSkillsBatch, {
          skills: batch,
          leaderboard: "all-time",
          day,
        });
      }

      totalSynced += normalized.length;
      hasMore = pagination.hasMore;
      page++;
    }

    console.log(`Synced ${totalSynced} skills (full leaderboard)`);

    // Lifetime installs + installRank just changed, so refresh the home "Popular"
    // tab (cached under this tag) in lockstep with the daily data instead of
    // letting it drift on its own 24h time-based window. Best-effort no-op in dev
    // (see revalidateHomeTag); trending/hot ping their own tags from their crons.
    await revalidateHomeTag("home-popular");

    // Same idea for skill detail pages: their install count (loadSkill) and chart
    // (loadInsights) are both tagged "skill-sync" and cached on a 24h ISR window.
    // Ping the tag so every visited skill page refreshes its number and snapshot
    // series in lockstep with this sync rather than drifting up to a day behind.
    await revalidateHomeTag("skill-sync");

    // Delist skills not seen for 30+ days.
    await ctx.scheduler.runAfter(5_000, internal.skills.markDelistedSkills, {});

    // Refresh stale content. markStaleContent re-flags rows older than 7 days
    // for re-fetch, then chains into the discovery → raw fetch → v1 detail
    // sequence. New rows from this sync (already flagged in upsertSkillsBatch)
    // also get picked up.
    await ctx.scheduler.runAfter(8_000, internal.skills.markStaleContent, {});
  },
});

/**
 * GitHub heartbeat patch fragment — see the isGitHubOnly note in schema.ts.
 * No skills.sh feed will ever stamp a GitHub-only row, so a successful raw
 * SKILL.md fetch is what keeps it out of the 30-day delist; every content-
 * pipeline success terminal spreads this into BOTH the skills-row and summary
 * patches (lockstep matters: backfillSkillSummariesBatch copies the skills-row
 * value onto summaries, so a one-sided stamp would let that tool regress live
 * rows into delisting). Deliberately scoped to GitHub-only rows — for
 * everything else `lastSeenInApi` must keep meaning "skills.sh still lists
 * this". (No discoveryFailCount reset here — it would be dead code: a row only
 * reaches a content fetch with a discovered URL, and updateSkillMdUrl zeroes
 * the counter whenever it sets one, so "URL present ⇒ counter 0" already
 * holds. Discovery-exhaustion recovery lives in markStaleContentBatch's cap
 * exemption instead.)
 */
function gitHubOnlyHeartbeat(
  skill: { isGitHubOnly?: boolean } | null | undefined,
  now: number,
): { lastSeenInApi?: number } {
  return skill?.isGitHubOnly ? { lastSeenInApi: now } : {};
}

/**
 * The isGitHubOnly set/clear transition for upsertSkillsBatch's three row
 * patch sites (fast path skill row + summary, orphan path). SET when the
 * GitHub-only add path is (re)claiming the row — including relisting a row
 * that had delisted as an ordinary skill, which must gain the marker or
 * reconcile would keep 404ing it back out. CLEAR ("adoption") when any
 * skills.sh feed reports a row that carried the marker: ordinary lifecycle
 * rules resume. Mutually exclusive by construction.
 */
function gitHubOnlyMarkerPatch(
  current: boolean | undefined,
  incoming: boolean,
): { isGitHubOnly?: boolean } {
  if (incoming) return { isGitHubOnly: true };
  if (current ?? false) return { isGitHubOnly: false };
  return {};
}

async function upsertSkillSummary(
  ctx: MutationCtx,
  fields: {
    source: string;
    skillId: string;
    name: string;
    description?: string;
    installs: number;
    installRank?: number;
    syncHash?: string;
    lastSeenInApi?: number;
    isDelisted?: boolean;
    isDuplicate?: boolean;
    isGitHubOnly?: boolean;
    curatedOwner?: string;
    trendingRank?: number;
    trendingInstalls?: number;
    hotRank?: number;
    hotChange?: number;
    hotInstallsYesterday?: number;
    worstAuditStatus?: string;
    worstAuditRiskLevel?: string;
    needsAudit?: boolean;
    auditFetchedAt?: number;
    skillDocId: Id<"skills">;
    contentFetchedAt?: number;
    skillMdUrl?: string;
    needsContentFetch?: boolean;
    needsDiscovery?: boolean;
    hasContentFetchError?: boolean;
    hasSkillMdUrl?: boolean;
    discoveryFailCount?: number;
    hasEmbedding?: boolean;
    embeddingMode?: string;
    embeddingSkipReason?: string;
    needsEmbedding?: boolean;
  },
) {
  const existing = await ctx.db
    .query("skillSummaries")
    .withIndex("by_source_skillId", (q) =>
      q.eq("source", fields.source).eq("skillId", fields.skillId),
    )
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      name: fields.name,
      description: fields.description,
      installs: fields.installs,
      ...(fields.installRank !== undefined && {
        installRank: fields.installRank,
      }),
      ...(fields.syncHash !== undefined && { syncHash: fields.syncHash }),
      ...(fields.lastSeenInApi !== undefined && {
        lastSeenInApi: fields.lastSeenInApi,
      }),
      ...(fields.isDelisted !== undefined && { isDelisted: fields.isDelisted }),
      ...(fields.isDuplicate !== undefined && {
        isDuplicate: fields.isDuplicate,
      }),
      ...(fields.isGitHubOnly !== undefined && {
        isGitHubOnly: fields.isGitHubOnly,
      }),
      ...(fields.curatedOwner !== undefined && {
        curatedOwner: fields.curatedOwner,
      }),
      ...(fields.trendingRank !== undefined && {
        trendingRank: fields.trendingRank,
      }),
      ...(fields.trendingInstalls !== undefined && {
        trendingInstalls: fields.trendingInstalls,
      }),
      ...(fields.hotRank !== undefined && { hotRank: fields.hotRank }),
      ...(fields.hotChange !== undefined && { hotChange: fields.hotChange }),
      ...(fields.hotInstallsYesterday !== undefined && {
        hotInstallsYesterday: fields.hotInstallsYesterday,
      }),
      ...(fields.worstAuditStatus !== undefined && {
        worstAuditStatus: fields.worstAuditStatus,
      }),
      ...(fields.worstAuditRiskLevel !== undefined && {
        worstAuditRiskLevel: fields.worstAuditRiskLevel,
      }),
      ...(fields.needsAudit !== undefined && { needsAudit: fields.needsAudit }),
      ...(fields.auditFetchedAt !== undefined && {
        auditFetchedAt: fields.auditFetchedAt,
      }),
      skillDocId: fields.skillDocId,
      ...(fields.contentFetchedAt !== undefined && {
        contentFetchedAt: fields.contentFetchedAt,
      }),
      ...(fields.skillMdUrl !== undefined && {
        skillMdUrl: fields.skillMdUrl,
      }),
      ...(fields.needsContentFetch !== undefined && {
        needsContentFetch: fields.needsContentFetch,
      }),
      ...(fields.needsDiscovery !== undefined && {
        needsDiscovery: fields.needsDiscovery,
      }),
      ...(fields.hasContentFetchError !== undefined && {
        hasContentFetchError: fields.hasContentFetchError,
      }),
      ...(fields.discoveryFailCount !== undefined && {
        discoveryFailCount: fields.discoveryFailCount,
      }),
      ...(fields.hasSkillMdUrl !== undefined && {
        hasSkillMdUrl: fields.hasSkillMdUrl,
      }),
      ...(fields.hasEmbedding !== undefined && {
        hasEmbedding: fields.hasEmbedding,
      }),
      ...(fields.embeddingMode !== undefined && {
        embeddingMode: fields.embeddingMode,
      }),
      ...(fields.embeddingSkipReason !== undefined && {
        embeddingSkipReason: fields.embeddingSkipReason,
      }),
      ...(fields.needsEmbedding !== undefined && {
        needsEmbedding: fields.needsEmbedding,
      }),
    });
  } else {
    await ctx.db.insert("skillSummaries", {
      source: fields.source,
      skillId: fields.skillId,
      name: fields.name,
      description: fields.description,
      installs: fields.installs,
      installRank: fields.installRank,
      syncHash: fields.syncHash,
      // Required field: a new row is always being upserted from a feed, so
      // default to now if a caller didn't pass an explicit timestamp.
      lastSeenInApi: fields.lastSeenInApi ?? Date.now(),
      // Default to false on insert so the by_isDelisted index is selective
      // and indexed equality filters (`q.eq("isDelisted", false)`) match.
      isDelisted: fields.isDelisted ?? false,
      isDuplicate: fields.isDuplicate ?? false,
      isGitHubOnly: fields.isGitHubOnly,
      curatedOwner: fields.curatedOwner,
      trendingRank: fields.trendingRank,
      trendingInstalls: fields.trendingInstalls,
      hotRank: fields.hotRank,
      hotChange: fields.hotChange,
      hotInstallsYesterday: fields.hotInstallsYesterday,
      worstAuditStatus: fields.worstAuditStatus,
      worstAuditRiskLevel: fields.worstAuditRiskLevel,
      needsAudit: fields.needsAudit,
      auditFetchedAt: fields.auditFetchedAt,
      skillDocId: fields.skillDocId,
      contentFetchedAt: fields.contentFetchedAt,
      skillMdUrl: fields.skillMdUrl,
      needsContentFetch: fields.needsContentFetch,
      needsDiscovery: fields.needsDiscovery,
      hasContentFetchError: fields.hasContentFetchError,
      hasSkillMdUrl: fields.hasSkillMdUrl,
      discoveryFailCount: fields.discoveryFailCount,
      hasEmbedding: fields.hasEmbedding,
      embeddingMode: fields.embeddingMode,
      embeddingSkipReason: fields.embeddingSkipReason,
      needsEmbedding: fields.needsEmbedding,
      // GitHub rows enter the duplicate-resolution work-set; well-known sources
      // never resolve. resolveRepoIdentities clears this when it stamps the row.
      needsRepoResolution: isGitHubSource(fields.source),
    });
  }
}


// Append (or refresh) today's install count for a skill. Idempotent on
// (skillDocId, day): the daily sync runs once, but rate-limit reschedules and
// manual re-runs can replay it — so we patch an existing same-day row rather
// than inserting a duplicate. Called for every skill on an install-owning sync
// (syncSkills / manual, ownsInstalls=true), including ones whose installs didn't
// move, so the time series has a point per day.
//
// Deliberately NOT called by syncCurated (ownsInstalls=false): the curated
// endpoint's `installs` is unreliable (it's what was clobbering real counts), so
// curated-only skills — ones on the curated feed but absent from the all-time
// leaderboard — get no snapshots and won't appear in the install charts. That's
// the intended trade-off: the time series is owned by the trustworthy all-time
// source. If such a skill ever appears on the leaderboard, syncSkills picks it
// up and starts snapshotting it from reliable data.
async function recordDailySnapshot(
  ctx: MutationCtx,
  skillDocId: Id<"skills">,
  installs: number,
  day: string,
) {
  const existing = await ctx.db
    .query("skillSnapshots")
    .withIndex("by_skill_day", (q) =>
      q.eq("skillDocId", skillDocId).eq("day", day),
    )
    .unique();
  if (existing) {
    if (existing.installs !== installs) {
      await ctx.db.patch(existing._id, { installs });
    }
  } else {
    await ctx.db.insert("skillSnapshots", { skillDocId, day, installs });
  }
}

export const upsertSkillsBatch = internalMutation({
  args: {
    skills: v.array(
      v.object({
        source: v.string(),
        skillId: v.string(),
        name: v.string(),
        installs: v.number(),
        isDuplicate: v.boolean(),
        // All-time install rank from the leaderboard order. Only the all-time
        // syncSkills path supplies it; curated/manual paths omit it (no
        // meaningful rank there) and leave any existing installRank untouched.
        rank: v.optional(v.number()),
      }),
    ),
    leaderboard: v.string(),
    // Whether this caller's `installs` is the authoritative source. True for
    // syncSkills (all-time listing) and the manual paths (v1 detail) — both
    // reliable. False for syncCurated: the /skills/curated endpoint's `installs`
    // field is unreliable (it has returned values off by orders of magnitude),
    // so the curated pass must NOT overwrite installs or write a daily snapshot
    // on rows that already exist — it would clobber what syncSkills wrote 30
    // minutes earlier. Curated still inserts genuinely-new rows (its only job
    // beyond stamping curatedOwner) using the curated installs as a seed.
    ownsInstalls: v.optional(v.boolean()),
    // Snapshot day ("YYYY-MM-DD" in the app timezone), pinned by the caller.
    // syncSkills computes it ONCE at the start of the run and passes it to every
    // batch, so a long run that crosses the day boundary (LA midnight) still
    // attributes all snapshots to the day it started — instead of splitting
    // across two buckets as each batch reads its own clock. Omitted by
    // single-skill callers (manual upserts), which fall back to the current day.
    day: v.optional(v.string()),
    // Only the GitHub-only add path passes true. Every other caller is a
    // skills.sh feed, and a feed reporting the skill is exactly what "adoption"
    // means — so leaving this false is what clears the marker off a row that
    // was previously GitHub-only. See the `adopting` note in the fast path.
    isGitHubOnly: v.optional(v.boolean()),
    // The user who added this skill via the public add flow. Stamped only on
    // the genuine-new-insert path (never on relist/orphan/adoption) so original
    // attribution is preserved, and used to count a free user's GitHub-only-add
    // quota. Omitted by every sync caller.
    addedBy: v.optional(v.id("users")),
    // Enforce the free-tier GitHub-only-add quota atomically inside this
    // mutation — same transaction as the insert — so two concurrent submits
    // can't both slip past a client-side check. Only the public GitHub-only add
    // path passes it (and only for free users); every sync caller omits it.
    enforceGitHubQuotaFor: v.optional(
      v.object({ userId: v.id("users"), limit: v.number() }),
    ),
  },
  /**
   * Listing-call upsert. Two paths:
   *
   * 1. **Fast path** (~99% of rows): summary exists. We have everything we
   *    need from the ~200B summary read — name, installs, isDelisted,
   *    skillDocId — so we patch the skill row BY ID (no 30KB read) and
   *    patch the summary directly. Patches are idempotent in Convex; we
   *    don't need to compare fields beforehand.
   *
   * 2. **Slow path** (truly new skills, ~50/day max): no summary exists.
   *    We have to insert a fresh skill row + fresh summary. This is the
   *    only branch that pays the cost of a real index probe into `skills`
   *    (to defend against the rare case of an orphaned skill row with no
   *    summary; if found, we patch it instead of inserting a duplicate).
   *
   * Source-aware routing: GitHub sources go through the Tree-API discovery
   * + raw-fetch pipeline; well-known sources go through the v1 detail
   * endpoint. Set on insert and on relist (where content may have moved
   * while the skill was off our radar).
   */
  handler: async (
    ctx,
    {
      skills,
      leaderboard,
      ownsInstalls = true,
      day: pinnedDay,
      isGitHubOnly = false,
      addedBy,
      enforceGitHubQuotaFor,
    },
  ) => {
    const now = Date.now();
    // Prefer the caller's pinned day (see the `day` arg doc); fall back to the
    // current app-timezone day for callers that don't pin.
    const day = pinnedDay ?? appDay(now);

    for (const skill of skills) {
      const isGitHub = isGitHubSource(skill.source);

      // ALWAYS read summary first (~200B). Mirrors every field upsert
      // decisions need, so we don't need to read the heavy skill row.
      const summary = await ctx.db
        .query("skillSummaries")
        .withIndex("by_source_skillId", (q) =>
          q.eq("source", skill.source).eq("skillId", skill.skillId),
        )
        .unique();

      // -----------------------------------------------------------------
      // Fast path: summary exists. Two sub-cases.
      // -----------------------------------------------------------------
      if (summary) {
        const wasRelisted = summary.isDelisted ?? false;
        // Curated (ownsInstalls=false) must not react to its unreliable installs
        // value: treat it as never-changed so it neither patches installs nor
        // triggers a snapshot below.
        const installsChanged =
          ownsInstalls && summary.installs !== skill.installs;
        const nameChanged = summary.name !== skill.name;
        const duplicateChanged =
          (summary.isDuplicate ?? false) !== skill.isDuplicate;
        // Adoption: a row added straight from GitHub is now being reported by a
        // skills.sh feed, so it stops being GitHub-only and rejoins the ordinary
        // lifecycle (reconcile refreshes it, the 30-day delist applies, installs
        // get a real owner). Counts as a change so it can't fall into sub-case A,
        // which patches `lastSeenInApi` alone and would leave the marker set —
        // and with it reconcile's skip, permanently.
        const adopting = (summary.isGitHubOnly ?? false) && !isGitHubOnly;
        const nothingChanged =
          !wasRelisted &&
          !installsChanged &&
          !nameChanged &&
          !duplicateChanged &&
          !adopting;

        // Sub-case A: literally nothing moved since last sync. Minimum work
        // per the delisting invariant: just touch summary.lastSeenInApi so
        // markDelistedSkills' 30-day window keeps moving. Skip the skill-row
        // patch entirely — its values are already correct.
        if (nothingChanged) {
          await ctx.db.patch(summary._id, {
            lastSeenInApi: now,
            // Rank can shift even when this skill's own installs didn't, as
            // other skills move around it. Cheap (~200B summary patch) and the
            // heavy skills row is left untouched. Skipped when no rank was
            // supplied (curated/manual paths).
            ...(skill.rank !== undefined &&
              summary.installRank !== skill.rank && {
                installRank: skill.rank,
              }),
          });
          if (ownsInstalls) {
            await recordDailySnapshot(
              ctx,
              summary.skillDocId,
              skill.installs,
              day,
            );
          }
          continue;
        }

        // Sub-case B: at least one field moved (installs, name, isDuplicate,
        // or relist). Patch both rows.
        // Active installs reset discoveryFailCount — a skill that previously
        // exhausted MAX_DISCOVERY_FAILURES gets unstuck once new installs
        // signal the upstream repo is alive again.
        // Relist forces re-fetch + re-audit (upstream may have moved while
        // the skill was off our radar).
        const relistPatchSkill = wasRelisted
          ? {
              isDelisted: false as const,
              needsEmbedding: true as const,
              needsAudit: true as const,
              ...(isGitHub
                ? { needsDiscovery: true as const, needsContentFetch: false as const }
                : { needsContentFetch: true as const, needsDiscovery: false as const }),
            }
          : {};
        const relistPatchSummary = wasRelisted
          ? {
              isDelisted: false as const,
              needsEmbedding: true as const,
              hasEmbedding: false as const,
              needsAudit: true as const,
              // Put GitHub rows back in the resolve work-set on relist. Essential
              // for a never-resolved row that delisted (its flag was cleared): it
              // must rejoin or it'd stay unresolved forever. For an already-
              // resolved repo it's a cheap no-op re-stamp from the resolution
              // cache — a rename during the absence is caught by
              // reresolveStaleRepoIdentities' TTL pass, not here.
              needsRepoResolution: isGitHub,
              ...(isGitHub
                ? { needsDiscovery: true as const, needsContentFetch: false as const }
                : { needsContentFetch: true as const, needsDiscovery: false as const }),
            }
          : {};

        // `leaderboard` is deliberately NOT patched on the existing-row path.
        // It's an origin tag — "which sync flow first surfaced this row" —
        // and overwriting it on every delta makes the field nondeterministic
        // (last-writer-wins between syncSkills at 06:00 and syncCurated at
        // 06:30 for any row that changed in between). Set on insert only.
        await ctx.db.patch(summary.skillDocId, {
          name: skill.name,
          ...(ownsInstalls && { installs: skill.installs }),
          lastSynced: now,
          lastSeenInApi: now,
          isDuplicate: skill.isDuplicate,
          ...(installsChanged && { discoveryFailCount: 0 }),
          ...gitHubOnlyMarkerPatch(summary.isGitHubOnly, isGitHubOnly),
          ...relistPatchSkill,
        });
        await ctx.db.patch(summary._id, {
          name: skill.name,
          ...(ownsInstalls && { installs: skill.installs }),
          ...(skill.rank !== undefined && { installRank: skill.rank }),
          lastSeenInApi: now,
          isDuplicate: skill.isDuplicate,
          ...(installsChanged && { discoveryFailCount: 0 }),
          ...gitHubOnlyMarkerPatch(summary.isGitHubOnly, isGitHubOnly),
          ...relistPatchSummary,
        });
        if (ownsInstalls) {
          await recordDailySnapshot(ctx, summary.skillDocId, skill.installs, day);
        }
        continue;
      }

      // -----------------------------------------------------------------
      // Slow path: no summary. Could be a brand-new skill OR an orphaned
      // skill row (rare data-integrity case). Defensive index probe to
      // avoid inserting a duplicate skill row.
      // -----------------------------------------------------------------
      const existing = await ctx.db
        .query("skills")
        .withIndex("by_source_skillId", (q) =>
          q.eq("source", skill.source).eq("skillId", skill.skillId),
        )
        .unique();

      let skillDocId: Id<"skills">;

      if (existing) {
        // Orphaned skill row — patch it like the fast path.
        // `leaderboard` is NOT patched here for the same reason as the fast
        // path above: it's an origin tag, set on insert only.
        skillDocId = existing._id;
        const wasRelisted = existing.isDelisted ?? false;
        const installsChanged =
          ownsInstalls && existing.installs !== skill.installs;
        await ctx.db.patch(existing._id, {
          name: skill.name,
          ...(ownsInstalls && { installs: skill.installs }),
          lastSynced: now,
          lastSeenInApi: now,
          isDuplicate: skill.isDuplicate,
          ...(installsChanged && { discoveryFailCount: 0 }),
          // Same transition as the fast path, for the rare orphaned-row case.
          // The SET arm matters: the recreated summary below gets the marker,
          // and if the skills row didn't too, the heartbeat (which reads the
          // skills row) would never stamp and the row would silently delist.
          ...gitHubOnlyMarkerPatch(existing.isGitHubOnly, isGitHubOnly),
          ...(wasRelisted && {
            isDelisted: false,
            needsEmbedding: true,
            needsAudit: true,
            ...(isGitHub
              ? { needsDiscovery: true, needsContentFetch: false }
              : { needsContentFetch: true, needsDiscovery: false }),
          }),
        });
      } else {
        // Genuinely new skill.
        //
        // Atomic free-tier quota gate for the public GitHub-only add path.
        // Counting + insert share this one transaction, so a double-submit
        // can't race two rows past the cap. Deliberately scoped to THIS branch
        // only: relist/orphan paths never stamp `addedBy` (no quota consumed),
        // so an at-limit user relisting a delisted row must not be rejected.
        if (enforceGitHubQuotaFor) {
          const counted = await countGitHubOnlyAdds(
            ctx,
            enforceGitHubQuotaFor.userId,
            enforceGitHubQuotaFor.limit,
          );
          if (counted >= enforceGitHubQuotaFor.limit) {
            throw quotaExceededError();
          }
        }
        skillDocId = await ctx.db.insert("skills", {
          source: skill.source,
          skillId: skill.skillId,
          name: skill.name,
          installs: skill.installs,
          leaderboard,
          lastSynced: now,
          // GitHub → discoverSkillMdUrls finds the path, then queues raw fetch.
          // Well-known → goes straight to v1 detail.
          needsDiscovery: isGitHub,
          needsContentFetch: !isGitHub,
          lastSeenInApi: now,
          // Set explicitly so indexed equality filters match new rows.
          isDelisted: false,
          isDuplicate: skill.isDuplicate,
          needsEmbedding: true,
          // By the time we sync a leaderboard skill, skills.sh's audit
          // pipeline has almost certainly run for it.
          needsAudit: true,
          // Only set when true, so ordinary rows stay lean. The audit flag above
          // is deliberately still set for a GitHub-only row: the audit endpoint
          // 404s and audits.ts records "unknown", which is the honest verdict and
          // self-corrects if the skill is ever adopted.
          ...(isGitHubOnly && { isGitHubOnly: true }),
          // Attribution for the public add flow. Genuine-insert only — relist
          // and orphan paths above never touch it, preserving the original
          // adder. Undefined for sync-pipeline rows.
          ...(addedBy && { addedBy }),
        });
      }

      // Mirror to summary (insert path of upsertSkillSummary). For a fresh
      // summary the installs is just a seed — use skill.installs. But when this
      // is an orphan (skill row already existed) AND the caller doesn't own
      // installs (curated), seed from the existing row's value so curated's
      // unreliable number can't land on the user-visible summary field even for
      // one cycle.
      await upsertSkillSummary(ctx, {
        source: skill.source,
        skillId: skill.skillId,
        name: skill.name,
        description: existing?.description,
        installs:
          ownsInstalls || !existing ? skill.installs : existing.installs,
        installRank: skill.rank,
        ...(existing?.syncHash !== undefined && { syncHash: existing.syncHash }),
        lastSeenInApi: now,
        isDuplicate: skill.isDuplicate,
        ...(isGitHubOnly && { isGitHubOnly: true }),
        skillDocId,
        ...(existing && {
          contentFetchedAt: existing.contentFetchedAt,
          skillMdUrl: existing.skillMdUrl,
          needsDiscovery: existing.isDelisted
            ? isGitHub
            : existing.needsDiscovery,
          needsContentFetch: existing.isDelisted
            ? !isGitHub
            : existing.needsContentFetch,
          hasSkillMdUrl: !!existing.skillMdUrl && existing.skillMdUrl !== "",
        }),
        ...(!existing && {
          needsDiscovery: isGitHub,
          needsContentFetch: !isGitHub,
          needsEmbedding: true,
          needsAudit: true,
        }),
        ...(existing?.isDelisted && {
          isDelisted: false,
          needsEmbedding: true,
          hasEmbedding: false,
          needsAudit: true,
        }),
      });

      if (ownsInstalls) {
        await recordDailySnapshot(ctx, skillDocId, skill.installs, day);
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Source-type helper
// ---------------------------------------------------------------------------
// Content helpers
// ---------------------------------------------------------------------------

export function extractFrontmatterDescription(content: string): string | null {
  // YAML frontmatter is between --- markers
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;

  const frontmatter = match[1];

  // Single-line: `description: text` or `description: "text"`.
  // Use [ \t]* (not \s*) so the match can't accidentally span newlines and
  // truncate an implicit multi-line value at the first wrapped line.
  const singleLine = frontmatter.match(
    /^description:[ \t]*["']?([^\s|>"'].*?)["']?[ \t]*$/m,
  );
  if (singleLine) return singleLine[1].trim();

  // Block scalar: `description: |` or `description: >` followed by indented lines.
  const blockScalar = frontmatter.match(
    /^description:[ \t]*[|>]-?[ \t]*\n((?:[ \t]+.*(?:\n|$))*)/m,
  );
  if (blockScalar) {
    const folded = blockScalar[1]
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    if (folded) return folded;
  }

  // Implicit multi-line plain scalar — value starts on the next line, indented,
  // with no `|`/`>` indicator. YAML folds such lines into a single space-joined string.
  const plainMultiline = frontmatter.match(
    /^description:[ \t]*\n((?:[ \t]+.+(?:\n|$))+)/m,
  );
  if (plainMultiline) {
    const folded = plainMultiline[1]
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    if (folded) return folded;
  }

  return null;
}

function extractBodyContent(raw: string): string | null {
  // Strip YAML frontmatter (between --- markers), return remaining markdown body
  const match = raw.match(/^---\s*\n[\s\S]*?\n---\s*\n?([\s\S]*)/);
  if (match) {
    const body = match[1].trim();
    return body || null;
  }
  // No frontmatter — treat the whole content as the body
  const trimmed = raw.trim();
  return trimmed || null;
}

// ---------------------------------------------------------------------------
// Phase 1 — URL Discovery (GitHub Tree API)
// ---------------------------------------------------------------------------
//
// Restored from the pre-v1 pipeline. The v1 detail endpoint's snapshot
// pipeline misses cases ours used to catch: deeply-nested SKILL.md paths,
// uppercase filenames (SKILL.MD), unconventional paths. So for GitHub
// sources we walk the repo tree ourselves with case-insensitive matching
// and find SKILL.md no matter where it lives. Well-known sources skip
// this entirely — they go through the v1 detail endpoint.

export const listSourcesNeedingDiscovery = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const paginationOpts = cursor
      ? { numItems: 500, cursor }
      : { numItems: 500, cursor: null };
    const result = await ctx.db
      .query("skillSummaries")
      .withIndex("by_needsDiscovery", (q) => q.eq("needsDiscovery", true))
      .paginate(paginationOpts);

    // Group skills by source repo so we hit each repo's Tree API once.
    const bySource = new Map<
      string,
      Array<{ docId: string; skillId: string }>
    >();
    for (const s of result.page) {
      const list = bySource.get(s.source) ?? [];
      list.push({ docId: s.skillDocId, skillId: s.skillId });
      bySource.set(s.source, list);
    }

    const sources = Array.from(bySource.entries()).map(([source, skills]) => ({
      source,
      skills,
    }));

    return {
      sources,
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const discoverSkillMdUrls = internalAction({
  args: {
    source: v.string(),
    skills: v.array(v.object({ docId: v.string(), skillId: v.string() })),
  },
  handler: async (ctx, { source, skills }) => {
    // Well-known sources (mintlify.com, bun.sh, etc.) shouldn't be in this
    // queue — they're routed straight to v1 detail by upsertSkillsBatch. Belt-
    // and-suspenders: if one slips in, just clear its needsDiscovery flag
    // without marking as failed (it'll get picked up by v1 detail next sync).
    if (!isGitHubSource(source)) {
      for (const s of skills) {
        await ctx.runMutation(internal.skills.clearDiscoveryForWellKnown, {
          docId: s.docId as ReturnType<typeof v.id<"skills">>["type"],
        });
      }
      return;
    }

    const [owner, repo] = source.split("/");
    const defaultBranch = await resolveDefaultBranch(owner, repo);

    const branches = [defaultBranch];
    if (!branches.includes("main")) branches.push("main");
    if (!branches.includes("master")) branches.push("master");

    const treeResult = await fetchRepoTree(owner, repo, branches);
    const tree = treeResult === NOT_MODIFIED ? null : treeResult;
    const resolvedBranch = tree?.branch ?? defaultBranch;

    const matchedSkillIds = new Set<string>();
    const matchedPaths = new Set<string>();
    const rawUrlFor = (path: string) =>
      rawGitHubUrl(source, resolvedBranch, path);

    /** Apply one decision from lib/discoveryPlacement.ts. The only writer. */
    const applyPlacement = async ({ skill, path }: Placement) => {
      await ctx.runMutation(internal.skills.updateSkillMdUrl, {
        docId: skill.docId as ReturnType<typeof v.id<"skills">>["type"],
        skillMdUrl: rawUrlFor(path),
      });
      matchedSkillIds.add(skill.skillId);
      matchedPaths.add(path);
    };

    /** Whatever neither branch could place is recorded as "no file found". */
    const markRestNotFound = async () => {
      const unmatched = skills.filter((s) => !matchedSkillIds.has(s.skillId));
      for (const s of unmatched) {
        await ctx.runMutation(internal.skills.updateSkillMdUrl, {
          docId: s.docId as ReturnType<typeof v.id<"skills">>["type"],
          skillMdUrl: "",
        });
      }
      return unmatched.length;
    };

    // Fallback: tree fetch failed (404 / 409 too large / rate limited). Guess the
    // conventional paths per skill; `planProbePlacements` owns the priority order
    // and the first-hit rule.
    if (!tree) {
      console.log(
        `Could not fetch tree for ${source} — trying direct path guessing`,
      );
      const placements = await planProbePlacements({
        skills,
        // HEAD, not GET: this only needs to know the file exists. It briefly
        // fetched bodies to run the same name check pass 1 did; that check is
        // gone (see pass 1) and with it the reason to transfer a body here.
        probe: async (path) => {
          try {
            const res = await fetch(rawUrlFor(path), { method: "HEAD" });
            return res.ok;
          } catch {
            return false;
          }
        },
      });
      for (const placement of placements) await applyPlacement(placement);
      await markRestNotFound();
      return;
    }

    // Collect every SKILL.md (case-insensitive) in the tree, indexed by the
    // immediate parent directory name. Shared with the GitHub-only resolver
    // (lib/github.ts) so the two cannot key it differently.
    const { candidates: allSkillMdPaths, byDir: skillMdByDir } = indexSkillMds(
      tree.entries,
    );

    // Pass 1: directory name matches the skillId, bound from the tree without
    // opening the file. Do NOT add a name check here — one was tried and reverted
    // in Jul 2026 after production measurement, and the reasoning plus the numbers
    // are in docs/skill-lifecycle.md, "Discovery: which SKILL.md a row gets".
    // The one-line version: a SKILL.md's `name` does not reliably identify its
    // owner, so disagreement with the slug is normal rather than evidence.
    for (const placement of planDirPlacements(skills, skillMdByDir)) {
      await applyPlacement(placement);
    }

    // Pass 2: for unmatched skills, fetch unmatched SKILL.md files and check
    // the frontmatter `name` field (skills.sh sometimes derives skillIds from
    // names in non-obvious ways, or SKILL.md is at the repo root).
    const unmatchedSkills = skills.filter(
      (s) => !matchedSkillIds.has(s.skillId),
    );
    const unmatchedMdPaths = allSkillMdPaths.filter(
      (path) => !matchedPaths.has(path),
    );

    // The whole decision — exact across every candidate before any loose one,
    // each path and each row spent at most once, and how many bodies to read —
    // lives in `planNamePlacements` (lib/discoveryPlacement.ts), where it is
    // unit-tested. All that is left here is the read itself.
    //
    // Cost: a row matching only loosely does not stop the walk, because every
    // candidate must be read before the loose phase can start; exact matches do
    // still cut it short. Bounded either way — 500 rows of one source per
    // invocation, `unmatchedMdPaths` is repo-bounded, and reads go 10-wide.
    const namePlacements = await planNamePlacements({
      remaining: unmatchedSkills,
      candidates: unmatchedMdPaths,
      usedPaths: matchedPaths,
      readNames: async (paths) => {
        const bodies = await Promise.all(
          paths.map((path) => fetchRawText(rawUrlFor(path))),
        );
        return paths.map((path, j) => {
          const body = bodies[j];
          if (body === null) return null;
          const name = parseSkillMdName(body);
          return name ? { path, name } : null;
        });
      },
    });
    for (const placement of namePlacements) {
      await applyPlacement(placement);
    }

    const notFound = await markRestNotFound();
    console.log(
      `${source}: ${matchedSkillIds.size} matched, ${notFound} not found`,
    );
  },
});

/** Helper for the rare case a well-known source ends up in the discovery
 *  queue (shouldn't normally happen). Just clears the flag without marking
 *  as failed — the v1-detail path will pick it up. */
export const clearDiscoveryForWellKnown = internalMutation({
  args: { docId: v.id("skills") },
  handler: async (ctx, { docId }) => {
    const skill = await ctx.db.get(docId);
    if (!skill) return;
    await ctx.db.patch(docId, {
      needsDiscovery: false,
      needsContentFetch: true,
    });
    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", skill.source).eq("skillId", skill.skillId),
      )
      .unique();
    if (summary) {
      await ctx.db.patch(summary._id, {
        needsDiscovery: false,
        needsContentFetch: true,
      });
    }
  },
});

export const updateSkillMdUrl = internalMutation({
  args: {
    docId: v.id("skills"),
    skillMdUrl: v.string(),
  },
  handler: async (ctx, { docId, skillMdUrl }) => {
    const hasUrl = skillMdUrl !== "";
    const now = Date.now();
    const skill = await ctx.db.get(docId);
    const newFailCount = hasUrl ? 0 : (skill?.discoveryFailCount ?? 0) + 1;
    // Discovery failure surfaces the same "Install may fail" badge as
    // content-fetch failure: the user-facing reality is identical (we have
    // no SKILL.md, so `npx skills add` may install nothing useful), and the
    // existing badge logic in components/skill-status-badge.tsx already
    // keys off hasContentFetchError. Without this, low-install curated
    // skills whose SKILL.md was deleted upstream (or never existed) render
    // a bare skill page with no warning — see the Bitwarden case.
    await ctx.db.patch(docId, {
      skillMdUrl,
      needsDiscovery: false,
      needsContentFetch: hasUrl,
      discoveryFailCount: newFailCount,
      hasContentFetchError: !hasUrl,
      ...(!hasUrl && { contentFetchedAt: now }),
    });
    if (skill) {
      const summary = await ctx.db
        .query("skillSummaries")
        .withIndex("by_source_skillId", (q) =>
          q.eq("source", skill.source).eq("skillId", skill.skillId),
        )
        .unique();
      if (summary) {
        await ctx.db.patch(summary._id, {
          skillMdUrl,
          hasSkillMdUrl: hasUrl,
          needsDiscovery: false,
          needsContentFetch: hasUrl,
          discoveryFailCount: newFailCount,
          hasContentFetchError: !hasUrl,
          ...(!hasUrl && { contentFetchedAt: now }),
        });
      }
    }
  },
});

export const backfillDiscoverUrls = internalAction({
  args: {
    cursor: v.optional(v.string()),
    scheduledSources: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { cursor, scheduledSources }) => {
    const REPOS_PER_BATCH = 25;
    const hasToken = !!process.env.GITHUB_TOKEN;
    const stagger = hasToken ? 500 : 30_000;
    const alreadyScheduled = new Set(scheduledSources ?? []);

    const result = await ctx.runQuery(
      internal.skills.listSourcesNeedingDiscovery,
      { cursor: cursor ?? undefined },
    );

    const newSources = result.sources.filter(
      (s) => !alreadyScheduled.has(s.source),
    );
    const batch = newSources.slice(0, REPOS_PER_BATCH);
    if (batch.length > 0) {
      console.log(`Scheduling Tree API discovery for ${batch.length} repos`);
      for (let i = 0; i < batch.length; i++) {
        await ctx.scheduler.runAfter(
          i * stagger,
          internal.skills.discoverSkillMdUrls,
          { source: batch[i].source, skills: batch[i].skills },
        );
        alreadyScheduled.add(batch[i].source);
      }
    }

    const remaining = newSources.length - batch.length;
    if (remaining > 0 || !result.isDone) {
      const nextCursor =
        remaining > 0 ? (cursor ?? undefined) : result.nextCursor;
      const delay = batch.length * stagger + 5_000;
      await ctx.scheduler.runAfter(
        delay,
        internal.skills.backfillDiscoverUrls,
        { cursor: nextCursor, scheduledSources: [...alreadyScheduled] },
      );
    } else {
      console.log("URL discovery complete — starting content fetch");
      // Chain into both content-fetch paths. Raw fetch for GitHub (queued by
      // discovery), v1 detail for well-known.
      await ctx.scheduler.runAfter(
        batch.length * stagger + 10_000,
        internal.skills.backfillFetchContent,
        {},
      );
      await ctx.scheduler.runAfter(
        batch.length * stagger + 12_000,
        internal.skills.fetchSkillDetailBatch,
        {},
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Phase 2a — Content fetch via raw.githubusercontent.com (GitHub sources)
// ---------------------------------------------------------------------------

const CONTENT_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REDISCOVERY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const AUDIT_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** SHA-256 over UTF-8 contents. Used to detect upstream changes for raw
 *  GitHub fetches (where we don't have skills.sh's bundle hash). The hash
 *  format is the same shape as the v1 hash, so the hash-skip path in
 *  updateDescription works uniformly. */
async function sha256Hex(text: string): Promise<string> {
  const buffer = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const listSkillsNeedingContentFetch = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const paginationOpts = cursor
      ? { numItems: 200, cursor }
      : { numItems: 200, cursor: null };
    const result = await ctx.db
      .query("skillSummaries")
      .withIndex("by_needsContentFetch", (q) => q.eq("needsContentFetch", true))
      .paginate(paginationOpts);

    // Filter to GitHub-source skills with a discovered URL. Well-known sources
    // skip this queue and go through fetchSkillDetailBatch instead.
    const skills = result.page
      .filter((s) => !s.isDelisted)
      .filter((s) => isGitHubSource(s.source))
      .filter((s) => s.skillMdUrl && s.skillMdUrl !== "")
      .map((s) => ({
        id: s.skillDocId,
        skillMdUrl: s.skillMdUrl!,
        skillName: s.skillId,
      }));

    return {
      skills,
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const fetchSkillContent = internalAction({
  args: {
    skillId: v.id("skills"),
    skillMdUrl: v.string(),
    skillName: v.optional(v.string()),
  },
  handler: async (ctx, { skillId, skillMdUrl, skillName }) => {
    const label = skillName ?? skillId;
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(skillMdUrl);
        if (!res.ok) {
          console.error(
            `Failed to fetch content for ${label}: ${res.status}`,
          );
          await ctx.runMutation(internal.skills.markContentFetchFailed, {
            skillId,
          });
          return;
        }

        const raw = await res.text();
        const description = extractFrontmatterDescription(raw);
        const body = extractBodyContent(raw);
        const hash = await sha256Hex(raw);

        if (description !== null || body) {
          await ctx.runMutation(internal.skills.updateDescription, {
            skillId,
            description: description ?? undefined,
            content: body ?? undefined,
            skillMdUrl,
            syncHash: hash,
          });
        } else {
          await ctx.runMutation(internal.skills.markContentFetched, {
            skillId,
          });
        }
        return;
      } catch (e) {
        if (attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        } else {
          console.error(
            `Error fetching content for ${label} after ${MAX_RETRIES} attempts:`,
            e,
          );
          await ctx.runMutation(internal.skills.markContentFetchFailed, {
            skillId,
          });
        }
      }
    }
  },
});

/**
 * Schedulable wrapper around `revalidateHomeTag("skill-sync")`, fired at the
 * terminal of each content chain — i.e. the first moment the content this
 * chain wrote is actually readable.
 *
 * Every *other* caller pings the tag before the content it means to publish
 * exists: `syncSkills` pings at its own terminal and only then schedules
 * `markStaleContent` (+8s), which is what *starts* discovery → fetch; and
 * `addSkillManually` pings immediately after scheduling its backfill. Since
 * `loadSkill` reads through `'use cache'` on `cacheLife("days")`, a page
 * rendered in that gap caches a row whose `content` is still empty.
 *
 * On the daily path this was masked: `reconcileUnseenSkills` pings the same
 * tag at 07:00 (reconcile.ts), after the 06:00 content pipeline has settled,
 * so the day's content did get published. But that ping is incidental — it's
 * semantically "install counts changed", it's gated on `refreshed > 0`, and it
 * lands at a fixed hour rather than when content is ready. It silently fails
 * to publish when reconcile refreshes nothing, or when the content pipeline
 * runs past 07:00. Manual adds had no such backstop at all: the row could sit
 * contentless until the next reconcile that happened to refresh something.
 *
 * Pinging here makes the publish explicit and unconditional instead of a side
 * effect of an unrelated job. Best-effort and idempotent (`revalidateHomeTag`
 * swallows errors and no-ops when the env vars are unset, i.e. everywhere but
 * prod), so the extra ping costs nothing when there was no content to write.
 */
export const revalidateSkillSyncTag = internalAction({
  args: {},
  returns: v.null(),
  handler: async () => {
    await revalidateHomeTag("skill-sync");
    return null;
  },
});

export const backfillFetchContent = internalAction({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const STAGGER_MS = 500;

    const result = await ctx.runQuery(
      internal.skills.listSkillsNeedingContentFetch,
      { cursor: cursor ?? undefined },
    );

    if (result.skills.length > 0) {
      console.log(
        `Scheduling raw content fetch for ${result.skills.length} skills`,
      );
      for (let i = 0; i < result.skills.length; i++) {
        await ctx.scheduler.runAfter(
          i * STAGGER_MS,
          internal.skills.fetchSkillContent,
          {
            skillId: result.skills[i].id,
            skillMdUrl: result.skills[i].skillMdUrl,
            skillName: result.skills[i].skillName,
          },
        );
      }
    }

    if (!result.isDone) {
      const delay = result.skills.length * STAGGER_MS + 5_000;
      await ctx.scheduler.runAfter(
        delay,
        internal.skills.backfillFetchContent,
        { cursor: result.nextCursor },
      );
    } else {
      const finalDelay = result.skills.length * STAGGER_MS + 30_000;
      console.log(
        `Raw content backfill complete — recalculating stats in ${Math.round(finalDelay / 1000)}s`,
      );
      await ctx.scheduler.runAfter(
        finalDelay,
        internal.devStats.recalculateStats,
        {},
      );
      await ctx.scheduler.runAfter(
        finalDelay + 5_000,
        internal.skills.embedSkillsBatch,
        {},
      );
      // Drain the audit queue alongside embeddings — independent chains, both
      // fire after content has stabilized for the day.
      await ctx.scheduler.runAfter(
        finalDelay + 10_000,
        internal.audits.fetchAuditBatch,
        {},
      );
      // Publish the content this chain just wrote. `finalDelay` already covers
      // the staggered per-skill `fetchSkillContent` calls, so by now the rows
      // carry their new SKILL.md — this is the first moment a ping is useful.
      await ctx.scheduler.runAfter(
        finalDelay + 15_000,
        internal.skills.revalidateSkillSyncTag,
        {},
      );
    }
  },
});

export const updateDescription = internalMutation({
  args: {
    skillId: v.id("skills"),
    description: v.optional(v.string()),
    content: v.optional(v.string()),
    skillMdUrl: v.string(),
    syncHash: v.string(),
  },
  handler: async (ctx, { skillId, description, content, skillMdUrl, syncHash }) => {
    const skill = await ctx.db.get(skillId);
    if (!skill) return;

    const now = Date.now();
    const hashUnchanged = skill.syncHash === syncHash;

    if (hashUnchanged) {
      // Content didn't change since last fetch. Touch contentFetchedAt and
      // skip parse/embed work.
      await ctx.db.patch(skillId, {
        contentFetchedAt: now,
        needsContentFetch: false,
        contentFetchFailCount: 0,
        hasContentFetchError: false,
        ...gitHubOnlyHeartbeat(skill, now),
      });
      const summary = await ctx.db
        .query("skillSummaries")
        .withIndex("by_source_skillId", (q) =>
          q.eq("source", skill.source).eq("skillId", skill.skillId),
        )
        .unique();
      if (summary) {
        await ctx.db.patch(summary._id, {
          contentFetchedAt: now,
          needsContentFetch: false,
          hasContentFetchError: false,
          // Stamped on the unchanged-hash path too: identical content still
          // proves the repo is serving the file — the whole liveness signal.
          ...gitHubOnlyHeartbeat(skill, now),
        });
      }
      return;
    }

    // Clear broken legacy descriptions ("|" or ">") when no valid one parsed.
    const isBrokenDesc =
      skill.description === "|" || skill.description === ">";
    const effectiveDescription =
      description ?? (isBrokenDesc ? "" : undefined);

    const newDescription = effectiveDescription ?? skill.description;
    const descriptionChanged =
      effectiveDescription !== undefined &&
      effectiveDescription !== skill.description;
    const contentChanged = content !== undefined && content !== skill.content;
    const hasActualChange = descriptionChanged || contentChanged;

    await ctx.db.patch(skillId, {
      ...(effectiveDescription !== undefined && {
        description: effectiveDescription,
      }),
      ...(content !== undefined && { content }),
      skillMdUrl,
      syncHash,
      contentFetchedAt: now,
      ...(hasActualChange && { contentUpdatedAt: now, needsEmbedding: true }),
      needsContentFetch: false,
      contentFetchFailCount: 0,
      hasContentFetchError: false,
      ...gitHubOnlyHeartbeat(skill, now),
    });

    await upsertSkillSummary(ctx, {
      source: skill.source,
      skillId: skill.skillId,
      name: skill.name,
      description: newDescription,
      installs: skill.installs,
      syncHash,
      skillDocId: skillId,
      contentFetchedAt: now,
      needsContentFetch: false,
      hasContentFetchError: false,
      skillMdUrl,
      hasSkillMdUrl: !!skillMdUrl && skillMdUrl !== "",
      // Mirror the marker through summary recreation: this call can INSERT a
      // missing summary (orphaned-row case), and without the flag the new
      // summary would drift from the skills row — reconcile would stop
      // skipping the row, and feed-driven adoption (keyed on the summary
      // flag) could never fire.
      isGitHubOnly: skill.isGitHubOnly,
      ...gitHubOnlyHeartbeat(skill, now),
    });
  },
});

export const markContentFetched = internalMutation({
  args: { skillId: v.id("skills") },
  handler: async (ctx, { skillId }) => {
    const now = Date.now();
    const skill = await ctx.db.get(skillId);
    await ctx.db.patch(skillId, {
      contentFetchedAt: now,
      needsContentFetch: false,
      // This path handles a frontmatter-only / empty-body SKILL.md — still a
      // SUCCESSFUL fetch proving the repo alive, so it heartbeats too.
      ...gitHubOnlyHeartbeat(skill, now),
    });
    if (skill) {
      const summary = await ctx.db
        .query("skillSummaries")
        .withIndex("by_source_skillId", (q) =>
          q.eq("source", skill.source).eq("skillId", skill.skillId),
        )
        .unique();
      if (summary) {
        await ctx.db.patch(summary._id, {
          contentFetchedAt: now,
          needsContentFetch: false,
          ...gitHubOnlyHeartbeat(skill, now),
        });
      }
    }
  },
});

export const markContentFetchFailed = internalMutation({
  args: { skillId: v.id("skills") },
  handler: async (ctx, { skillId }) => {
    const skill = await ctx.db.get(skillId);
    if (!skill) return;

    const now = Date.now();
    const failCount = (skill.contentFetchFailCount ?? 0) + 1;

    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", skill.source).eq("skillId", skill.skillId),
      )
      .unique();

    if (failCount >= 2) {
      // After 2 consecutive failures, clear the URL and re-discover. Maybe
      // SKILL.md moved/renamed in the upstream repo.
      await ctx.db.patch(skillId, {
        contentFetchedAt: now,
        needsContentFetch: false,
        contentFetchFailCount: 0,
        hasContentFetchError: false,
        skillMdUrl: "",
        needsDiscovery: true,
      });
      if (summary) {
        await ctx.db.patch(summary._id, {
          contentFetchedAt: now,
          needsContentFetch: false,
          hasContentFetchError: false,
          skillMdUrl: "",
          hasSkillMdUrl: false,
          needsDiscovery: true,
        });
      }
    } else {
      await ctx.db.patch(skillId, {
        contentFetchedAt: now,
        needsContentFetch: false,
        contentFetchFailCount: failCount,
        hasContentFetchError: true,
      });
      if (summary) {
        await ctx.db.patch(summary._id, {
          contentFetchedAt: now,
          hasContentFetchError: true,
          needsContentFetch: false,
        });
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Phase 2b — Periodic refresh (markStaleContent)
// ---------------------------------------------------------------------------
//
// Walks every active skill summary and re-flags the ones whose content is
// stale (>7 days since last fetch). Routes them per source type:
//   - GitHub with empty URL: re-flag for discovery (needsDiscovery=true)
//   - GitHub with URL: re-flag for raw fetch (needsContentFetch=true)
//   - Well-known: re-flag for v1 detail (needsContentFetch=true)
// Then chains into the discover/fetch chain to drain.

export const markStaleContentBatch = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const paginationOpts = cursor
      ? { numItems: 200, cursor }
      : { numItems: 200, cursor: null };
    const result = await ctx.db
      .query("skillSummaries")
      .paginate(paginationOpts);

    const now = Date.now();
    let marked = 0;

    for (const s of result.page) {
      if (s.isDelisted) continue;
      const isGitHub = isGitHubSource(s.source);

      // Content / discovery refresh — same logic as before.
      let contentMarked = false;
      if (isGitHub) {
        const hasUrl = s.skillMdUrl && s.skillMdUrl !== "";
        const contentStale =
          hasUrl &&
          !s.needsContentFetch &&
          now - (s.contentFetchedAt ?? 0) > CONTENT_REFRESH_INTERVAL_MS;
        // GitHub-only rows are exempt from the MAX_DISCOVERY_FAILURES cap:
        // ordinary skills un-stick from exhausted discovery when new installs
        // arrive (installsChanged resets the counter), but no feed ever
        // changes a GitHub-only row's installs, so three transient failures
        // (e.g. GitHub rate-limit windows) would otherwise freeze it forever —
        // no rediscovery, no content fetch, no heartbeat, silent delist at
        // day 30 while the repo is alive. The retry cost is bounded: one
        // discovery attempt per REDISCOVERY_INTERVAL_MS, and a truly dead
        // repo stops costing anything once the missed heartbeats delist the
        // row (the isDelisted skip above).
        const pastFailureCap =
          (s.discoveryFailCount ?? 0) >= MAX_DISCOVERY_FAILURES &&
          !s.isGitHubOnly;
        const needsRediscovery =
          !hasUrl &&
          !s.needsDiscovery &&
          !pastFailureCap &&
          now - (s.contentFetchedAt ?? 0) > REDISCOVERY_INTERVAL_MS;

        if (contentStale) {
          await ctx.db.patch(s.skillDocId, { needsContentFetch: true });
          await ctx.db.patch(s._id, { needsContentFetch: true });
          contentMarked = true;
        } else if (needsRediscovery) {
          await ctx.db.patch(s.skillDocId, { needsDiscovery: true });
          await ctx.db.patch(s._id, { needsDiscovery: true });
          contentMarked = true;
        }
      } else {
        const stale =
          !s.needsContentFetch &&
          now - (s.contentFetchedAt ?? 0) > CONTENT_REFRESH_INTERVAL_MS;
        if (stale) {
          await ctx.db.patch(s.skillDocId, { needsContentFetch: true });
          await ctx.db.patch(s._id, { needsContentFetch: true });
          contentMarked = true;
        }
      }

      // Audit refresh — independent of content (audit data changes on its
      // own cadence). Re-flag if not currently flagged AND last audit fetch
      // was >7 days ago.
      const auditStale =
        !s.needsAudit &&
        now - (s.auditFetchedAt ?? 0) > AUDIT_REFRESH_INTERVAL_MS;
      let auditMarked = false;
      if (auditStale) {
        await ctx.db.patch(s.skillDocId, { needsAudit: true });
        await ctx.db.patch(s._id, { needsAudit: true });
        auditMarked = true;
      }

      if (contentMarked || auditMarked) marked++;
    }

    return {
      nextCursor: result.continueCursor,
      isDone: result.isDone,
      marked,
    };
  },
});

export const markStaleContent = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | undefined;
    let isDone = false;
    let total = 0;

    while (!isDone) {
      const result: { nextCursor: string; isDone: boolean; marked: number } =
        await ctx.runMutation(internal.skills.markStaleContentBatch, {
          cursor,
        });
      total += result.marked;
      cursor = result.nextCursor;
      isDone = result.isDone;
    }

    if (total > 0) {
      console.log(`Marked ${total} skills for content re-fetch / re-discovery`);
    }

    // Chain into discovery (which itself chains into content fetch + v1 detail).
    await ctx.scheduler.runAfter(0, internal.skills.backfillDiscoverUrls, {});
  },
});

// ---------------------------------------------------------------------------
// Detail fetch — v1 API (well-known sources only)
// ---------------------------------------------------------------------------
//
// Well-known sources (mintlify.com, bun.sh, etc.) have no GitHub URL — the
// v1 detail endpoint is the only way to get their content. GitHub-source
// skills go through the discovery + raw fetch path above; this listing
// query filters them out.

const DETAIL_BATCH_SIZE = 10;
// Process skills sequentially (one fetch at a time) within a batch. Each v1
// detail response holds the entire skill folder (`files[]`) in memory while
// V8 parses it (parse peak is ~3-4x the source size). Even concurrency 5
// hit OOM on heavy skills. Sequential keeps peak memory bounded to a single
// response's parse cost — safe up to ~15MB responses, which covers virtually
// every skill. Trade-off: ~30 skills/min vs ~75 with concurrency 5. One-time
// cost during the initial backfill; daily syncs hit the hash-skip path so
// only changed skills get re-parsed.
const DETAIL_CONCURRENCY = 1;
const DETAIL_CHAIN_DELAY_MS = 5_000;

export const listSkillsNeedingDetailFetch = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { cursor, limit }) => {
    const result = await ctx.db
      .query("skillSummaries")
      .withIndex("by_needsContentFetch", (q) => q.eq("needsContentFetch", true))
      .paginate({ numItems: limit, cursor: cursor ?? null });

    // Restrict to well-known sources. GitHub-source skills with
    // needsContentFetch=true are handled by the raw-fetch path
    // (listSkillsNeedingContentFetch + fetchSkillContent), not here.
    const skills = result.page
      .filter((s) => !s.isDelisted)
      .filter((s) => !isGitHubSource(s.source))
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

export const updateSkillFromDetail = internalMutation({
  args: {
    skillId: v.id("skills"),
    description: v.optional(v.string()),
    content: v.optional(v.string()),
    syncHash: v.string(),
  },
  /**
   * Apply a v1 detail fetch to the skill + summary rows. If the API hash
   * matches the stored syncHash we still clear `needsContentFetch` (we did
   * fetch successfully) but skip overwriting description/content and skip
   * queueing a re-embed. That keeps the embedding pipeline from re-running
   * on every sync for skills that haven't actually changed upstream.
   */
  handler: async (ctx, { skillId, description, content, syncHash }) => {
    const skill = await ctx.db.get(skillId);
    if (!skill) return;

    const now = Date.now();
    const hashUnchanged = skill.syncHash === syncHash;

    if (hashUnchanged) {
      await ctx.db.patch(skillId, {
        contentFetchedAt: now,
        needsContentFetch: false,
        hasContentFetchError: false,
      });
      const summary = await ctx.db
        .query("skillSummaries")
        .withIndex("by_source_skillId", (q) =>
          q.eq("source", skill.source).eq("skillId", skill.skillId),
        )
        .unique();
      if (summary) {
        await ctx.db.patch(summary._id, {
          contentFetchedAt: now,
          needsContentFetch: false,
          hasContentFetchError: false,
        });
      }
      return;
    }

    const descriptionChanged =
      description !== undefined && description !== skill.description;
    const contentChanged = content !== undefined && content !== skill.content;
    const hasActualChange = descriptionChanged || contentChanged;

    await ctx.db.patch(skillId, {
      ...(description !== undefined && { description }),
      ...(content !== undefined && { content }),
      syncHash,
      contentFetchedAt: now,
      ...(hasActualChange && { contentUpdatedAt: now, needsEmbedding: true }),
      needsContentFetch: false,
      hasContentFetchError: false,
    });

    await upsertSkillSummary(ctx, {
      source: skill.source,
      skillId: skill.skillId,
      name: skill.name,
      description: description ?? skill.description,
      installs: skill.installs,
      syncHash,
      skillDocId: skillId,
      contentFetchedAt: now,
      needsContentFetch: false,
      hasContentFetchError: false,
      // Belt and braces. This path is well-known-sources only (its work set
      // filters GitHub sources out) and a GitHub-only row is a GitHub source by
      // construction, so the field should never matter here — but this call can
      // INSERT a summary, and the insert branch writes `isGitHubOnly` straight
      // through. Passing it means the mirror stays correct without depending on
      // a source filter two functions away.
      isGitHubOnly: skill.isGitHubOnly,
    });
  },
});

export const markDetailFetchFailed = internalMutation({
  args: { skillId: v.id("skills") },
  handler: async (ctx, { skillId }) => {
    const skill = await ctx.db.get(skillId);
    if (!skill) return;
    const now = Date.now();
    await ctx.db.patch(skillId, {
      contentFetchedAt: now,
      needsContentFetch: false,
      hasContentFetchError: true,
    });
    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", skill.source).eq("skillId", skill.skillId),
      )
      .unique();
    if (summary) {
      await ctx.db.patch(summary._id, {
        contentFetchedAt: now,
        needsContentFetch: false,
        hasContentFetchError: true,
      });
    }
  },
});

export const fetchSkillDetailBatch = internalAction({
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
    } = await ctx.runQuery(internal.skills.listSkillsNeedingDetailFetch, {
      cursor: cursor ?? undefined,
      limit: DETAIL_BATCH_SIZE,
    });

    if (result.skills.length > 0) {
      let rateLimited: SkillsApiRateLimitError | null = null;

      const processOne = async (s: {
        skillDocId: Id<"skills">;
        source: string;
        skillId: string;
      }) => {
        if (rateLimited) return;
        const id = `${s.source}/${s.skillId}`;
        try {
          // Lean helper strips the response to {hash, skillMdContents} so
          // the heavy files[] doesn't live through the mutation await below.
          // withTransientRetry absorbs flaky 5xx / network blips inline so a
          // single hiccup doesn't shove the row into 7-day refresh limbo.
          const { hash, skillMdContents } = await withTransientRetry(() =>
            v1GetSkillSyncData(s.source, s.skillId),
          );
          if (!skillMdContents || !hash) {
            await ctx.runMutation(internal.skills.markDetailFetchFailed, {
              skillId: s.skillDocId,
            });
            return;
          }
          const description = extractFrontmatterDescription(skillMdContents);
          const body = extractBodyContent(skillMdContents);
          await ctx.runMutation(internal.skills.updateSkillFromDetail, {
            skillId: s.skillDocId,
            description: description ?? undefined,
            content: body ?? undefined,
            syncHash: hash,
          });
        } catch (e) {
          if (e instanceof SkillsApiRateLimitError) {
            rateLimited = e;
            return;
          }
          if (e instanceof SkillsApiNotFoundError) {
            await ctx.runMutation(internal.skills.markDetailFetchFailed, {
              skillId: s.skillDocId,
            });
            return;
          }
          console.error(`Detail fetch failed for ${id}:`, e);
          await ctx.runMutation(internal.skills.markDetailFetchFailed, {
            skillId: s.skillDocId,
          });
        }
      };

      // Bound concurrency to DETAIL_CONCURRENCY by chunking the batch into
      // sequential waves. Each wave's responses get GC'd before the next
      // wave starts, so peak memory is bounded by the wave size, not the
      // batch size.
      for (let i = 0; i < result.skills.length; i += DETAIL_CONCURRENCY) {
        if (rateLimited) break;
        const wave = result.skills.slice(i, i + DETAIL_CONCURRENCY);
        await Promise.all(wave.map(processOne));
      }

      if (rateLimited) {
        const retryAfter = (rateLimited as SkillsApiRateLimitError)
          .retryAfterSeconds;
        console.warn(
          `Detail fetch rate limited; resuming in ${retryAfter}s`,
        );
        await ctx.scheduler.runAfter(
          retryAfter * 1000,
          internal.skills.fetchSkillDetailBatch,
          { cursor },
        );
        return;
      }
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        DETAIL_CHAIN_DELAY_MS,
        internal.skills.fetchSkillDetailBatch,
        { cursor: result.nextCursor },
      );
    } else {
      console.log("Detail fetch complete — kicking off stats + embeddings");
      await ctx.scheduler.runAfter(
        5_000,
        internal.devStats.recalculateStats,
        {},
      );
      await ctx.scheduler.runAfter(
        10_000,
        internal.skills.embedSkillsBatch,
        {},
      );
      // Same publish step as the raw-content chain: well-known sources get
      // their content here, so this branch needs its own ping.
      await ctx.scheduler.runAfter(
        15_000,
        internal.skills.revalidateSkillSyncTag,
        {},
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Delist skills not seen in the API for 30+ days
// ---------------------------------------------------------------------------

const DELIST_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const listStaleSummaries = internalQuery({
  args: { cursor: v.optional(v.string()), cutoff: v.number() },
  handler: async (ctx, { cursor, cutoff }) => {
    const paginationOpts = cursor
      ? { numItems: 100, cursor }
      : { numItems: 100, cursor: null };
    // Indexed range: only non-delisted rows last seen before the cutoff. The
    // caller pins cutoff so the range boundary is identical across all pages.
    const result = await ctx.db
      .query("skillSummaries")
      .withIndex("by_isDelisted_lastSeenInApi", (q) =>
        q.eq("isDelisted", false).lt("lastSeenInApi", cutoff),
      )
      .paginate(paginationOpts);

    const staleEntries = result.page.map((s) => ({
      summaryId: s._id,
      source: s.source,
      skillId: s.skillId,
    }));

    return {
      entries: staleEntries,
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});


export const delistSkillsBatch = internalMutation({
  args: {
    entries: v.array(
      v.object({
        summaryId: v.id("skillSummaries"),
        source: v.string(),
        skillId: v.string(),
      }),
    ),
  },
  handler: async (ctx, { entries }) => {
    for (const { summaryId, source, skillId } of entries) {
      // Soft-delete the summary. Keeping the row (~200 bytes) lets the
      // Delisted stat count correctly and enables the fast-path relist in
      // upsertSkillsBatch. Clear pipeline flags so background workers skip
      // the row, and mirror the embedding deletion below.
      const summary = await ctx.db.get(summaryId);
      if (summary) {
        await ctx.db.patch(summaryId, {
          isDelisted: true,
          needsContentFetch: false,
          needsDiscovery: false,
          needsEmbedding: false,
          // Drop out of the resolve work-set too — a row delisted before it was
          // ever resolved shouldn't burn a GitHub call resolving a dead repo. (If
          // it relists, upsertSkillsBatch re-flags it.) Same reason as the other
          // needs* clears above.
          needsRepoResolution: false,
          hasEmbedding: false,
          skillEmbeddingId: undefined,
          // Clear leaderboard denormalizations on delist. Listing/search
          // queries already filter on isDelisted: false, so leaving these
          // populated isn't user-facing — but it confuses anyone debugging
          // raw rows ("why does this delisted skill have a trendingRank?")
          // and causes drift if the row ever relists later via
          // upsertSkillsBatch's fast-path.
          trendingRank: undefined,
          trendingInstalls: undefined,
          hotRank: undefined,
          hotChange: undefined,
          hotInstallsYesterday: undefined,
        });
        // Note: a copy's delist leaves peers' cached copyCount one high until the
        // weekly computeCopyCounts recompute heals it (both directions). The
        // detail page is always correct — getSkillCopies filters delisted live.
      }

      // Mark skill as delisted and clear its pipeline flags too.
      const skill = await ctx.db
        .query("skills")
        .withIndex("by_source_skillId", (q) =>
          q.eq("source", source).eq("skillId", skillId),
        )
        .unique();
      if (skill && !skill.isDelisted) {
        await ctx.db.patch(skill._id, {
          isDelisted: true,
          needsContentFetch: false,
          needsDiscovery: false,
          needsEmbedding: false,
          // Mirror the leaderboard cleanup from skillSummaries above.
          trendingRank: undefined,
          trendingInstalls: undefined,
          hotRank: undefined,
          hotChange: undefined,
          hotInstallsYesterday: undefined,
        });

        // Delete the embedding row entirely — delisted skills are excluded
        // from vector search anyway, so keeping the row just wastes storage.
        const skillEmbedding = await ctx.db
          .query("skillEmbeddings")
          .withIndex("by_skillId", (q) => q.eq("skillId", skill._id))
          .unique();
        if (skillEmbedding) {
          await ctx.db.delete(skillEmbedding._id);
        }
      }
    }
  },
});

export const markDelistedSkills = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | undefined;
    let isDone = false;
    let totalDelisted = 0;
    // Pin the cutoff once so every page queries the same range boundary.
    const cutoff = Date.now() - DELIST_THRESHOLD_MS;

    while (!isDone) {
      const result = await ctx.runQuery(internal.skills.listStaleSummaries, {
        cursor,
        cutoff,
      });

      if (result.entries.length > 0) {
        await ctx.runMutation(internal.skills.delistSkillsBatch, {
          entries: result.entries,
        });
        totalDelisted += result.entries.length;
      }

      cursor = result.nextCursor;
      isDone = result.isDone;
    }

    if (totalDelisted > 0) {
      console.log(
        `Delisted ${totalDelisted} skills not seen in API for 30+ days`,
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Embeddings — semantic search index for skills
// ---------------------------------------------------------------------------

/** Build the embedding input string from a skill's name + description + content. */
function buildEmbeddingInput(
  name: string,
  description: string | undefined,
  content: string | undefined,
): string {
  const parts = [name];
  if (description) parts.push(description);
  if (content) parts.push(content);
  return truncateForEmbedding(parts.join("\n\n"));
}

export const listSkillsNeedingEmbedding = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { cursor, limit }) => {
    const result = await ctx.db
      .query("skills")
      .withIndex("by_needsEmbedding", (q) => q.eq("needsEmbedding", true))
      .paginate({ numItems: limit, cursor: cursor ?? null });

    return {
      skills: result.page.map((s) => ({
        id: s._id,
        name: s.name,
        description: s.description,
        content: s.content,
      })),
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const writeEmbeddingsBatch = internalMutation({
  args: {
    entries: v.array(
      v.object({
        skillId: v.id("skills"),
        embedding: v.array(v.float64()),
        mode: v.union(v.literal("full"), v.literal("minimal")),
      }),
    ),
  },
  /**
   * Canonical write path for skill embeddings. ALL embedding writes must go
   * through this function. It atomically:
   *   1. Reads the parent skill row + the corresponding summary row
   *   2. Inserts (or patches) a row in `skillEmbeddings` with the vector
   *   3. Patches the parent skill row's bookkeeping fields
   *   4. Patches the summary row to mirror the new embedding state and
   *      set `skillEmbeddingId` so the recommendation pipeline can find
   *      the summary from a vector-search result
   *
   * Convex mutations are transactional — all operations either fully commit
   * or fully roll back, so we can't end up with a half-written embedding.
   *
   * If a skill has no corresponding summary (which should never happen in
   * practice — every skill insert in `upsertSkillsBatch` is paired with a
   * summary upsert), we log loudly and skip the embedding write entirely
   * rather than orphaning the row.
   *
   * If you add a new code path that needs to write embeddings, call this
   * function instead of writing the table directly.
   */
  handler: async (ctx, { entries }) => {
    for (const { skillId, embedding, mode } of entries) {
      const skill = await ctx.db.get(skillId);
      if (!skill) continue;

      // Look up the summary first so we can fail loudly if missing.
      const summary = await ctx.db
        .query("skillSummaries")
        .withIndex("by_source_skillId", (q) =>
          q.eq("source", skill.source).eq("skillId", skill.skillId),
        )
        .unique();
      if (!summary) {
        console.error(
          `writeEmbeddingsBatch: no summary for skill ${skillId} (${skill.source}/${skill.skillId}) — skipping embedding write to avoid orphaning a row`,
        );
        continue;
      }

      const isDelisted = skill.isDelisted ?? false;

      // Insert or update the embedding row.
      let embeddingDocId;
      const existingEmbedding = await ctx.db
        .query("skillEmbeddings")
        .withIndex("by_skillId", (q) => q.eq("skillId", skillId))
        .unique();
      if (existingEmbedding) {
        await ctx.db.patch(existingEmbedding._id, {
          embedding,
          isDelisted,
          embeddingMode: mode,
        });
        embeddingDocId = existingEmbedding._id;
      } else {
        embeddingDocId = await ctx.db.insert("skillEmbeddings", {
          skillId,
          embedding,
          isDelisted,
          embeddingMode: mode,
        });
      }

      // Patch the parent skill row to clear pipeline flags. The vector and
      // its bookkeeping metadata (embeddedAt/embeddingVersion/embeddingMode)
      // live on the embedding row now — only the queue flags remain here.
      await ctx.db.patch(skillId, {
        needsEmbedding: false,
        // Clear any stale skip reason if a previously-skipped skill is being
        // successfully re-embedded (e.g. after a content update).
        embeddingSkipReason: undefined,
      });

      // Patch the summary: mirror the embedding state and set the
      // back-reference that the recommendation pipeline uses.
      await ctx.db.patch(summary._id, {
        hasEmbedding: true,
        embeddingMode: mode,
        needsEmbedding: false,
        embeddingSkipReason: undefined,
        skillEmbeddingId: embeddingDocId,
      });
    }
  },
});

/**
 * Mark a single skill as unembeddable. Clears `needsEmbedding` so the worker
 * won't keep retrying it, and records *why* in `embeddingSkipReason` so a
 * future migration (smarter truncation, tiktoken, chunking) can find these
 * skills and try again instead of leaving them silently empty.
 *
 * This is non-destructive — call `clearEmbeddingSkipReason` (or just patch
 * `needsEmbedding: true`) to put a skill back in the queue.
 */
export const markSkillUnembeddable = internalMutation({
  args: { skillId: v.id("skills"), reason: v.string() },
  handler: async (ctx, { skillId, reason }) => {
    const skill = await ctx.db.get(skillId);
    if (!skill) return;
    await ctx.db.patch(skillId, {
      needsEmbedding: false,
      embeddingSkipReason: reason,
    });

    // Mirror to the summary row so listUnembeddable / coverage stats can
    // find this skill cheaply.
    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", skill.source).eq("skillId", skill.skillId),
      )
      .unique();
    if (summary) {
      await ctx.db.patch(summary._id, {
        needsEmbedding: false,
        embeddingSkipReason: reason,
      });
    }
  },
});

/**
 * One-shot backfill: set `isDelisted = false` on every skill (and summary)
 * where it's currently `undefined`. Convex's indexed equality filters treat
 * `undefined` and `false` as distinct values, so without this backfill,
 * indexed queries like `q.eq("isDelisted", false)` (used in vector search
 * and the search index) would silently exclude every active skill that was
 * inserted before this fix.
 *
 * Run via:
 *   npx convex run skills:backfillIsDelistedFalse
 *
 * Idempotent — safe to re-run. Only patches rows where the field is missing.
 */
export const backfillIsDelistedFalseBatch = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db
      .query("skills")
      .paginate({ numItems: 100, cursor: cursor ?? null });
    let patched = 0;
    for (const s of result.page) {
      if (s.isDelisted === undefined) {
        await ctx.db.patch(s._id, { isDelisted: false });
        patched++;
      }
    }
    return {
      nextCursor: result.continueCursor,
      isDone: result.isDone,
      patched,
    };
  },
});

export const backfillIsDelistedFalseSummariesBatch = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    // Summaries are small (~200 bytes each) so we can safely use a larger
    // page size — but keep it under the 16 MB read budget with headroom.
    const result = await ctx.db
      .query("skillSummaries")
      .paginate({ numItems: 500, cursor: cursor ?? null });
    let patched = 0;
    for (const s of result.page) {
      if (s.isDelisted === undefined) {
        await ctx.db.patch(s._id, { isDelisted: false });
        patched++;
      }
    }
    return {
      nextCursor: result.continueCursor,
      isDone: result.isDone,
      patched,
    };
  },
});

export const backfillIsDelistedFalse = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | undefined;
    let isDone = false;
    let total = 0;
    while (!isDone) {
      const result: { nextCursor: string; isDone: boolean; patched: number } =
        await ctx.runMutation(
          internal.skills.backfillIsDelistedFalseBatch,
          { cursor },
        );
      total += result.patched;
      cursor = result.nextCursor;
      isDone = result.isDone;
    }
    console.log(`Set isDelisted=false on ${total} skill rows`);

    // Same for summaries
    cursor = undefined;
    isDone = false;
    let summaryTotal = 0;
    while (!isDone) {
      const result: { nextCursor: string; isDone: boolean; patched: number } =
        await ctx.runMutation(
          internal.skills.backfillIsDelistedFalseSummariesBatch,
          { cursor },
        );
      summaryTotal += result.patched;
      cursor = result.nextCursor;
      isDone = result.isDone;
    }
    console.log(`Set isDelisted=false on ${summaryTotal} skillSummary rows`);
  },
});

/**
 * List skills the embedding worker gave up on, with enough metadata to
 * decide whether to investigate or retry. Run via:
 *   npx convex run skills:listUnembeddable
 * Returns an empty array if nothing was skipped (the happy path).
 *
 * Reads from skillSummaries (~200 bytes/row) instead of skills (~25 KB/row)
 * for cheap pipeline visibility.
 */
export const listUnembeddable = internalQuery({
  args: {},
  handler: async (ctx) => {
    const summaries = await ctx.db
      .query("skillSummaries")
      .filter((q) => q.neq(q.field("embeddingSkipReason"), undefined))
      .collect();
    return {
      count: summaries.length,
      skills: summaries.map((s) => ({
        id: s.skillDocId,
        source: s.source,
        skillId: s.skillId,
        name: s.name,
        reason: s.embeddingSkipReason,
      })),
    };
  },
});

/**
 * Coverage report for the embedding pipeline. Tells you what fraction of
 * skills are embedded, how they were embedded (full vs minimal fallback),
 * and how many were skipped. Use this to decide whether truncation needs
 * improvement: if `minimal` is more than a few % of total, the per-skill
 * fallback is firing too often and a smarter strategy (chunking, tiktoken)
 * would pay off.
 *
 * Run via: npx convex run skills:embeddingCoverageStats
 *
 * Reads from skillSummaries (~200 bytes/row, ~3 MB total for 16k skills)
 * instead of skills (~25 KB/row, ~400 MB total). Embedding state is
 * mirrored to summaries by writeEmbeddingsBatch and markSkillUnembeddable
 * — if you ever bypass those, run backfillSummaryEmbeddingState to resync.
 */
interface CoverageStats {
  total: number;
  delisted: number;
  eligible: number;
  withEmbedding: number;
  modeFull: number;
  modeMinimal: number;
  modeUnknown: number;
  skipped: number;
  pending: number;
  minimalPercentage: string;
}

interface CoverageBatchResult {
  counts: {
    total: number;
    delisted: number;
    withEmbedding: number;
    modeFull: number;
    modeMinimal: number;
    modeUnknown: number;
    skipped: number;
    pending: number;
  };
  nextCursor: string;
  isDone: boolean;
}

export const embeddingCoverageStatsBatch = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    // Summary docs are ~200 bytes each, so 1000 per page ≈ 200 KB — well
    // under the 16 MB read budget.
    const result = await ctx.db
      .query("skillSummaries")
      .paginate({ numItems: 1000, cursor: cursor ?? null });

    const counts = {
      total: 0,
      delisted: 0,
      withEmbedding: 0,
      modeFull: 0,
      modeMinimal: 0,
      modeUnknown: 0,
      skipped: 0,
      pending: 0,
    };

    for (const summary of result.page) {
      counts.total++;
      if (summary.isDelisted) {
        counts.delisted++;
        continue;
      }
      if (summary.hasEmbedding) {
        counts.withEmbedding++;
        if (summary.embeddingMode === "full") counts.modeFull++;
        else if (summary.embeddingMode === "minimal") counts.modeMinimal++;
        else counts.modeUnknown++;
      } else if (summary.embeddingSkipReason) {
        counts.skipped++;
      } else if (summary.needsEmbedding) {
        counts.pending++;
      }
    }

    return {
      counts,
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const embeddingCoverageStats = internalAction({
  args: {},
  handler: async (ctx): Promise<CoverageStats> => {
    let cursor: string | undefined;
    let isDone = false;
    const totals = {
      total: 0,
      delisted: 0,
      withEmbedding: 0,
      modeFull: 0,
      modeMinimal: 0,
      modeUnknown: 0,
      skipped: 0,
      pending: 0,
    };

    while (!isDone) {
      const result: CoverageBatchResult = await ctx.runQuery(
        internal.skills.embeddingCoverageStatsBatch,
        { cursor },
      );
      totals.total += result.counts.total;
      totals.delisted += result.counts.delisted;
      totals.withEmbedding += result.counts.withEmbedding;
      totals.modeFull += result.counts.modeFull;
      totals.modeMinimal += result.counts.modeMinimal;
      totals.modeUnknown += result.counts.modeUnknown;
      totals.skipped += result.counts.skipped;
      totals.pending += result.counts.pending;
      cursor = result.nextCursor;
      isDone = result.isDone;
    }

    const eligible = totals.total - totals.delisted;
    const minimalPct =
      totals.withEmbedding > 0
        ? ((totals.modeMinimal / totals.withEmbedding) * 100).toFixed(2)
        : "0.00";

    return {
      ...totals,
      eligible,
      minimalPercentage: `${minimalPct}%`,
    };
  },
});

// Hardcoded constants — NOT taken from args. The chain self-schedules with
// `ctx.scheduler.runAfter`, which captures arg values at schedule time. If
// these were args, in-flight scheduled chains from earlier deploys would keep
// using their old (potentially huge) batch sizes forever. Reading from a
// constant means new chains and old chains both pick up the current value
// the moment the new code is deployed.
//
// Sized conservatively to stay under OpenAI's 1M tokens-per-minute limit for
// text-embedding-3-small. SKILL.md files can tokenize as densely as ~1.5
// chars/token, so batch=10 × ~5k tokens = ~50k tokens/request. With a 5s
// chain delay, peak is ~600k TPM — comfortably under the 1M cap with
// headroom for batches that happen to cluster dense skills together.
//
// Throughput is ~100 skills/min. Slow for one-time backfills but fine for
// the daily cron (which only embeds skills whose content changed — usually
// dozens to a few hundred per day, finishing in seconds to minutes).
const EMBED_BATCH_SIZE = 10;
const EMBED_CHAIN_DELAY_MS = 5_000;

export const embedSkillsBatch = internalAction({
  args: {
    cursor: v.optional(v.string()),
    // batchSize accepted but IGNORED — kept for back-compat with stale
    // scheduled calls that still have it in their stored args.
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, { cursor }): Promise<void> => {
    const result: {
      skills: Array<{
        id: Id<"skills">;
        name: string;
        description?: string;
        content?: string;
      }>;
      nextCursor: string;
      isDone: boolean;
    } = await ctx.runQuery(internal.skills.listSkillsNeedingEmbedding, {
      cursor: cursor ?? undefined,
      limit: EMBED_BATCH_SIZE,
    });

    if (result.skills.length > 0) {
      const inputs = result.skills.map((s) =>
        buildEmbeddingInput(s.name, s.description, s.content),
      );

      try {
        const vectors = await embedTexts(inputs, "document");
        const entries = result.skills.map((s, i) => ({
          skillId: s.id,
          embedding: vectors[i],
          mode: "full" as const,
        }));
        await ctx.runMutation(internal.skills.writeEmbeddingsBatch, {
          entries,
        });
        console.log(`Embedded ${entries.length} skills`);
      } catch (e) {
        if (e instanceof EmbeddingInputTooLongError) {
          // At least one skill in the batch is too dense to fit even after
          // head-truncation. Fall back to per-skill embedding so we don't lose
          // the other skills in the batch (the cursor would otherwise advance
          // past them and they'd get skipped this pass).
          //
          // For each skill, we try the full input first; on length errors we
          // retry with just name + description (no content), which is almost
          // always small enough. If even that fails, we mark the skill as
          // unembeddable so the worker stops retrying it.
          console.warn(
            `Batch hit input-too-long at index ${e.badIndex}, falling back to per-skill embedding`,
          );

          const entries: Array<{
            skillId: Id<"skills">;
            embedding: number[];
            mode: "full" | "minimal";
          }> = [];
          let recovered = 0;
          let unembeddable = 0;

          for (const skill of result.skills) {
            // First try: full name + description + content
            const fullInput = buildEmbeddingInput(
              skill.name,
              skill.description,
              skill.content,
            );
            try {
              const [vector] = await embedTexts([fullInput], "document");
              entries.push({
                skillId: skill.id,
                embedding: vector,
                mode: "full",
              });
              continue;
            } catch (innerE) {
              if (!(innerE instanceof EmbeddingInputTooLongError)) {
                console.error(
                  "Per-skill embedding failed (non-length error):",
                  innerE,
                );
                return; // Bail out — chain will retry next run
              }
            }

            // Second try: name + description only (skip dense content)
            const minimalInput = buildEmbeddingInput(
              skill.name,
              skill.description,
              undefined,
            );
            try {
              const [vector] = await embedTexts([minimalInput], "document");
              entries.push({
                skillId: skill.id,
                embedding: vector,
                mode: "minimal",
              });
              recovered++;
              continue;
            } catch (innerE) {
              if (!(innerE instanceof EmbeddingInputTooLongError)) {
                console.error(
                  "Minimal embedding failed (non-length error):",
                  innerE,
                );
                return;
              }
            }

            // Both attempts failed — mark unembeddable
            console.warn(
              `Marking skill ${skill.id} as unembeddable (even name+description exceeds the limit)`,
            );
            await ctx.runMutation(internal.skills.markSkillUnembeddable, {
              skillId: skill.id,
              reason: "input_too_long",
            });
            unembeddable++;
          }

          if (entries.length > 0) {
            await ctx.runMutation(internal.skills.writeEmbeddingsBatch, {
              entries,
            });
          }
          console.log(
            `Embedded ${entries.length}/${result.skills.length} skills via fallback (${recovered} name+desc only, ${unembeddable} unembeddable)`,
          );
        } else {
          console.error("Embedding batch failed:", e);
          // Stop chaining — try again next cron run
          return;
        }
      }
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        EMBED_CHAIN_DELAY_MS,
        internal.skills.embedSkillsBatch,
        { cursor: result.nextCursor },
      );
    } else {
      console.log("Embedding backfill complete");
    }
  },
});

/**
 * Manually trigger an embedding backfill for all skills that need one.
 * Run via: npx convex run skills:backfillEmbeddings
 */
export const backfillEmbeddings = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runAction(internal.skills.embedSkillsBatch, {});
  },
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getById = internalQuery({
  args: { skillId: v.id("skills") },
  handler: async (ctx, { skillId }) => {
    return await ctx.db.get(skillId);
  },
});

export const getBySourceAndSkillId = query({
  args: { source: v.string(), skillId: v.string() },
  handler: async (ctx, { source, skillId }) => {
    return await ctx.db
      .query("skills")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", source).eq("skillId", skillId),
      )
      .unique();
  },
});

// How many days of install history the charts show — a trailing quarter. Caps
// both the skill-page dialog chart and the compare overlay (both read this), so
// the daily bars stay wide enough to read instead of collapsing into a wall at
// ~180 bars. The `skillSnapshots` table keeps the full history regardless; this
// only bounds what's fetched, so the window can be widened — or a zoom/brush
// strip added over the full series — later without losing data. The sidebar
// sparkline slices its own last week from this series.
const INSIGHTS_HISTORY_DAYS = 90;

/**
 * Analytics for one skill's detail page: the daily install time series plus the
 * count and all-time rank. Reads entirely from the cheap `skillSummaries` +
 * `skillSnapshots` tables — never the heavy `skills` row. The history is empty
 * until daily snapshots accumulate (skills.sh has no backfill), so the client
 * gates the chart on having enough points.
 */
export const getInsights = query({
  args: { source: v.string(), skillId: v.string() },
  handler: async (ctx, { source, skillId }) => {
    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", source).eq("skillId", skillId),
      )
      .unique();

    if (!summary) {
      return { snapshots: [], installs: 0, installRank: null };
    }

    const cutoffDay = appDay(Date.now() - INSIGHTS_HISTORY_DAYS * 86_400_000);
    const rows = await ctx.db
      .query("skillSnapshots")
      .withIndex("by_skill_day", (q) =>
        q.eq("skillDocId", summary.skillDocId).gte("day", cutoffDay),
      )
      .collect();
    // Index order is (skillDocId, day) ascending, and "YYYY-MM-DD" sorts
    // lexicographically by date, so these are already chronological.
    const snapshots = rows.map((r) => ({ day: r.day, installs: r.installs }));

    // Only daily-cadence fields here (all written by the daily syncSkills): the
    // skill page is ISR'd at 24h, so this stays internally consistent. The
    // faster-moving momentum fields (trendingRank/hotChange) deliberately don't
    // ride this cache — they live on the home rails, which their own crons keep
    // fresh.
    return {
      snapshots,
      installs: summary.installs,
      installRank: summary.installRank ?? null,
    };
  },
});

// Hard cap on how many skills one compare request can pull series for. The
// compare UI tops out at 3 columns; this is just a defensive bound so a
// hand-crafted request can't fan out into an unbounded read.
const COMPARE_MAX_REFS = 8;

/**
 * Batched insights for the compare page's single combined install chart: each
 * skill's daily snapshot series plus its name and all-time rank, in one query
 * so the overlay chart and the per-column rank stat share a single read. Like
 * `getInsights`, this touches only the cheap `skillSummaries` + `skillSnapshots`
 * tables. Missing skills (renamed/removed) come back with an empty series so the
 * caller can still key results by `(source, skillId)` and render a column.
 */
export const getCompareInsights = query({
  args: {
    refs: v.array(v.object({ source: v.string(), skillId: v.string() })),
  },
  handler: async (ctx, { refs }) => {
    const cutoffDay = appDay(Date.now() - INSIGHTS_HISTORY_DAYS * 86_400_000);
    const skills = await Promise.all(
      refs.slice(0, COMPARE_MAX_REFS).map(async ({ source, skillId }) => {
        const summary = await ctx.db
          .query("skillSummaries")
          .withIndex("by_source_skillId", (q) =>
            q.eq("source", source).eq("skillId", skillId),
          )
          .unique();

        if (!summary) {
          return {
            source,
            skillId,
            name: skillId,
            installs: 0,
            installRank: null as number | null,
            snapshots: [] as { day: string; installs: number }[],
          };
        }

        const rows = await ctx.db
          .query("skillSnapshots")
          .withIndex("by_skill_day", (q) =>
            q.eq("skillDocId", summary.skillDocId).gte("day", cutoffDay),
          )
          .collect();

        return {
          source,
          skillId,
          name: summary.name,
          installs: summary.installs,
          installRank: summary.installRank ?? null,
          snapshots: rows.map((r) => ({ day: r.day, installs: r.installs })),
        };
      }),
    );

    return { skills };
  },
});

// How many days of daily snapshots to keep. The charts only read the trailing
// INSIGHTS_HISTORY_DAYS (90), so anything older isn't shown — but we retain a
// wider window as a buffer (the prune never races the query at the 90-day edge)
// and to bank history for a future zoom/brush without waiting to re-accumulate.
// Storage holds flat at ~SNAPSHOT_RETENTION_DAYS × (#skills ≥ 50 installs) rows
// instead of growing ~1 row/skill/day forever. One-line knob: drop to 90 to
// match the display window if you'd rather stay lean.
const SNAPSHOT_RETENTION_DAYS = 180;
const PRUNE_BATCH_SIZE = 500;

/**
 * Daily retention prune for `skillSnapshots`. Action + batch mutation (mirrors
 * `githubCache.cleanupExpiredCache`): keep deleting the oldest rows a batch at a
 * time so a single mutation never hits its write limit, until nothing older than
 * the cutoff remains. Scheduled from crons.ts.
 */
export const pruneSnapshots = internalAction({
  args: {},
  handler: async (ctx) => {
    const cutoffDay = appDay(
      Date.now() - SNAPSHOT_RETENTION_DAYS * 86_400_000,
    );
    let total = 0;
    while (true) {
      const deleted: number = await ctx.runMutation(
        internal.skills.pruneSnapshotsBatch,
        { cutoffDay },
      );
      total += deleted;
      if (deleted === 0) break;
    }
    console.log(
      `Pruned ${total} skillSnapshots rows older than ${cutoffDay}`,
    );
  },
});

export const pruneSnapshotsBatch = internalMutation({
  args: { cutoffDay: v.string() },
  handler: async (ctx, { cutoffDay }) => {
    // `by_day` is day-ascending, so this walks the oldest rows first across all
    // skills; delete a batch and report the count so the action knows to loop.
    const stale = await ctx.db
      .query("skillSnapshots")
      .withIndex("by_day", (q) => q.lt("day", cutoffDay))
      .take(PRUNE_BATCH_SIZE);
    for (const row of stale) {
      await ctx.db.delete(row._id);
    }
    return stale.length;
  },
});

/**
 * Paginated list of non-delisted skills sorted by installs (descending).
 * Used as the default "browse" view on the home page when no search query
 * is entered. Reads from skillSummaries (~200 bytes/row) for cheap wire size.
 */
export const listPopularSkills = query({
  args: {
    paginationOpts: paginationOptsValidator,
    officialOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, { paginationOpts, officialOnly }) => {
    const result = await ctx.db
      .query("skillSummaries")
      .withIndex("by_isDelisted_installs", (q) => q.eq("isDelisted", false))
      .order("desc")
      .paginate(paginationOpts);
    return {
      ...result,
      page: result.page
        .filter((s) => !s.isDuplicate)
        .filter((s) => (officialOnly ? !!s.curatedOwner : true)),
    };
  },
});

/**
 * Every skill summary belonging to a given source ("org/repo"). Powers the
 * repo directory page. Returns delisted rows too — the page filters them at
 * render time so a future "show delisted" toggle is a UI-only change.
 */
export const listBySource = query({
  args: { source: v.string() },
  handler: async (ctx, { source }) => {
    return await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) => q.eq("source", source))
      .collect();
  },
});

/**
 * Per-repo aggregates for every repo under a given org, plus org-level totals.
 * Powers the org directory page. Aggregates inside Convex so the wire payload
 * is O(repos) instead of O(skills) — for an org with N skills across R repos,
 * we ship R aggregate rows instead of N full summary rows (~200 B each).
 *
 * Uses a prefix range scan on `by_source_skillId` because `source` is stored
 * as the full "org/repo" string. The exclusive upper bound `${org}0` works
 * because '/' (0x2F) is followed by '0' (0x30) in ASCII — no valid source can
 * fall between `${org}/` and `${org}0`.
 *
 * Delisted rows are excluded here so the page doesn't have to filter them.
 */
export const listRepoAggregatesByOrg = query({
  args: { org: v.string() },
  handler: async (ctx, { org }) => {
    const summaries = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.gte("source", `${org}/`).lt("source", `${org}0`),
      )
      .collect();

    const map = new Map<
      string,
      {
        repo: string;
        source: string;
        skillCount: number;
        totalInstalls: number;
      }
    >();
    let totalSkillCount = 0;
    let totalInstalls = 0;

    for (const skill of summaries) {
      if (skill.isDelisted) continue;
      if (skill.isDuplicate) continue;
      totalSkillCount += 1;
      totalInstalls += skill.installs;

      const slash = skill.source.indexOf("/");
      const repo =
        slash === -1 ? skill.source : skill.source.slice(slash + 1);
      const existing = map.get(skill.source);
      if (existing) {
        existing.skillCount += 1;
        existing.totalInstalls += skill.installs;
      } else {
        map.set(skill.source, {
          repo,
          source: skill.source,
          skillCount: 1,
          totalInstalls: skill.installs,
        });
      }
    }

    const repos = [...map.values()].sort(
      (a, b) => b.totalInstalls - a.totalInstalls,
    );

    return { repos, totalSkillCount, totalInstalls };
  },
});

/**
 * Internal query used by recommendations.ts to load skill metadata after a
 * vector search returns ranked skill IDs. Looks up the corresponding
 * skillSummaries rows (~200 bytes each) instead of the full skills rows
 * (~25 KB each), making analyzeRepo ~100x cheaper on bandwidth.
 *
 * Vector search lives on the skills table (where the embedding vectors are
 * stored) but the recommendation re-rank logic only needs name, source,
 * skillId, description, installs, and isDelisted — all of which are
 * mirrored on the summary.
 */
export const getSummariesByIds = internalQuery({
  args: { ids: v.array(v.id("skills")) },
  handler: async (ctx, { ids }) => {
    // Each lookup is a single indexed query via by_skillDocId.
    // Returns the summary plus the original skill _id so callers can map
    // back to vector search results that key by skill _id.
    const summaries = await Promise.all(
      ids.map(async (id) => {
        const summary = await ctx.db
          .query("skillSummaries")
          .withIndex("by_skillDocId", (q) => q.eq("skillDocId", id))
          .unique();
        return summary ? { skillDocId: id, summary } : null;
      }),
    );
    return summaries.filter(
      (s): s is NonNullable<typeof s> => s !== null,
    );
  },
});

/**
 * Like getSummariesByIds, but takes Id<"skillEmbeddings"> values from a
 * vector search on the skillEmbeddings table. Looks up summaries via the
 * by_skillEmbeddingId back-reference index, so we never read the heavy
 * embedding rows themselves.
 *
 * Returns the embedding doc id alongside the summary so callers can preserve
 * the vector-search ranking when iterating results.
 */
export const getSummariesByEmbeddingIds = internalQuery({
  args: { ids: v.array(v.id("skillEmbeddings")) },
  handler: async (ctx, { ids }) => {
    const summaries = await Promise.all(
      ids.map(async (id) => {
        const summary = await ctx.db
          .query("skillSummaries")
          .withIndex("by_skillEmbeddingId", (q) =>
            q.eq("skillEmbeddingId", id),
          )
          .unique();
        return summary ? { skillEmbeddingId: id, summary } : null;
      }),
    );
    return summaries.filter(
      (s): s is NonNullable<typeof s> => s !== null,
    );
  },
});

// ---------------------------------------------------------------------------
// Skill summaries (for backfill operations only)
// ---------------------------------------------------------------------------

export const backfillSkillSummaries = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | undefined;
    let isDone = false;
    let total = 0;

    while (!isDone) {
      const result: { nextCursor: string; isDone: boolean; count: number } =
        await ctx.runMutation(internal.skills.backfillSkillSummariesBatch, {
          cursor,
        });
      total += result.count;
      cursor = result.nextCursor;
      isDone = result.isDone;
    }

    console.log(`Backfilled ${total} skill summaries`);
  },
});

export const backfillSkillSummariesBatch = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const paginationOpts = cursor
      ? { numItems: 200, cursor }
      : { numItems: 200, cursor: null };
    const result = await ctx.db.query("skills").paginate(paginationOpts);

    for (const s of result.page) {
      await upsertSkillSummary(ctx, {
        source: s.source,
        skillId: s.skillId,
        name: s.name,
        description: s.description,
        installs: s.installs,
        syncHash: s.syncHash,
        lastSeenInApi: s.lastSeenInApi,
        isDelisted: s.isDelisted,
        skillDocId: s._id,
        contentFetchedAt: s.contentFetchedAt,
        skillMdUrl: s.skillMdUrl,
        needsContentFetch: s.needsContentFetch,
        needsDiscovery: s.needsDiscovery,
        hasContentFetchError: s.hasContentFetchError,
        discoveryFailCount: s.discoveryFailCount,
        hasSkillMdUrl: !!s.skillMdUrl && s.skillMdUrl !== "",
        // Mirror the marker, same as saveSkillContent. This call INSERTS when
        // the summary is missing, which is the whole point of a backfill, and
        // the insert branch of upsertSkillSummary writes `fields.isGitHubOnly`
        // straight through — so omitting it here silently clears the flag on
        // the mirror while the skills row keeps it. That costs more than a
        // reporting gap: `adopting` and `gitHubOnlyMarkerPatch` in
        // upsertSkillsBatch both read `summary.isGitHubOnly`, so adoption
        // could never fire and reconcile would skip the row forever.
        isGitHubOnly: s.isGitHubOnly,
      });
    }

    return {
      nextCursor: result.continueCursor,
      isDone: result.isDone,
      count: result.page.length,
    };
  },
});

// ---------------------------------------------------------------------------
// Diagnostic: pairwise cosine similarity between two skills
// ---------------------------------------------------------------------------
//
// Used to evaluate whether embedding-similarity dedup would catch a specific
// pair of suspected duplicate skills. Loads both skills' embeddings and
// reports their cosine similarity as a single number.
//
// Run via:
//   npx convex run skills:cosineSimilarityBetween '{
//     "a": { "source": "vercel-labs/agent-skills", "skillId": "vercel-react-best-practices" },
//     "b": { "source": "supercent-io/skills-template", "skillId": "vercel-react-best-practices" }
//   }'
//
// Interpretation:
//   1.0    — identical vectors (impossible in practice unless same embedding)
//   0.97+  — near-verbatim duplicates (the dedup target)
//   0.90   — clearly the same topic with real content differences
//   0.70   — same general category, materially different content
//   <0.5   — unrelated

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Cosine similarity requires same-length vectors (got ${a.length} vs ${b.length})`,
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const cosineSimilarityBetween = internalQuery({
  args: {
    a: v.object({ source: v.string(), skillId: v.string() }),
    b: v.object({ source: v.string(), skillId: v.string() }),
  },
  handler: async (ctx, { a, b }) => {
    const skillA = await ctx.db
      .query("skills")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", a.source).eq("skillId", a.skillId),
      )
      .unique();
    const skillB = await ctx.db
      .query("skills")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", b.source).eq("skillId", b.skillId),
      )
      .unique();

    if (!skillA) {
      return { error: `Skill A not found: ${a.source}/${a.skillId}` };
    }
    if (!skillB) {
      return { error: `Skill B not found: ${b.source}/${b.skillId}` };
    }

    const embeddingA = await ctx.db
      .query("skillEmbeddings")
      .withIndex("by_skillId", (q) => q.eq("skillId", skillA._id))
      .unique();
    const embeddingB = await ctx.db
      .query("skillEmbeddings")
      .withIndex("by_skillId", (q) => q.eq("skillId", skillB._id))
      .unique();

    if (!embeddingA) {
      return { error: `Skill A has no embedding: ${a.source}/${a.skillId}` };
    }
    if (!embeddingB) {
      return { error: `Skill B has no embedding: ${b.source}/${b.skillId}` };
    }

    const similarity = cosineSimilarity(
      embeddingA.embedding,
      embeddingB.embedding,
    );

    return {
      similarity,
      a: {
        source: skillA.source,
        skillId: skillA.skillId,
        name: skillA.name,
        installs: skillA.installs,
        descriptionPreview: (skillA.description ?? "").slice(0, 120),
        contentLength: skillA.content?.length ?? 0,
      },
      b: {
        source: skillB.source,
        skillId: skillB.skillId,
        name: skillB.name,
        installs: skillB.installs,
        descriptionPreview: (skillB.description ?? "").slice(0, 120),
        contentLength: skillB.content?.length ?? 0,
      },
    };
  },
});

export const backfillLastSeenInApiBatch = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const paginationOpts = cursor
      ? { numItems: 200, cursor }
      : { numItems: 200, cursor: null };
    const result = await ctx.db
      .query("skillSummaries")
      .paginate(paginationOpts);
    const now = Date.now();
    let patched = 0;

    for (const s of result.page) {
      if (s.lastSeenInApi === undefined) {
        await ctx.db.patch(s._id, { lastSeenInApi: now });
        patched++;
      }
    }

    return {
      nextCursor: result.continueCursor,
      isDone: result.isDone,
      patched,
    };
  },
});

export const backfillLastSeenInApi = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | undefined;
    let isDone = false;
    let total = 0;

    while (!isDone) {
      const result: { nextCursor: string; isDone: boolean; patched: number } =
        await ctx.runMutation(internal.skills.backfillLastSeenInApiBatch, {
          cursor,
        });
      total += result.patched;
      cursor = result.nextCursor;
      isDone = result.isDone;
    }

    console.log(`Backfilled lastSeenInApi on ${total} skills`);
  },
});

// One-time backfill for the needsRepoResolution work-set (added when resolution
// switched from full-scan to a by_needsRepoResolution index). Marks existing
// unresolved GitHub rows (githubRepoId still undefined) so the resolve pass can
// find them via the index. New rows get the flag on insert; this only covers
// rows that predate the field. Idempotent — re-run reports 0 once done.
export const backfillNeedsRepoResolutionBatch = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db
      .query("skillSummaries")
      .paginate(cursor ? { numItems: 200, cursor } : { numItems: 200, cursor: null });
    let patched = 0;
    for (const s of result.page) {
      const needs = s.githubRepoId === undefined && isGitHubSource(s.source);
      if (needs && s.needsRepoResolution !== true) {
        await ctx.db.patch(s._id, { needsRepoResolution: true });
        patched++;
      }
    }
    return { nextCursor: result.continueCursor, isDone: result.isDone, patched };
  },
});

export const backfillNeedsRepoResolution = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | undefined;
    let isDone = false;
    let total = 0;
    while (!isDone) {
      const result: { nextCursor: string; isDone: boolean; patched: number } =
        await ctx.runMutation(internal.skills.backfillNeedsRepoResolutionBatch, {
          cursor,
        });
      total += result.patched;
      cursor = result.nextCursor;
      isDone = result.isDone;
    }
    console.log(`Backfilled needsRepoResolution on ${total} skills`);
  },
});

// ---------------------------------------------------------------------------
// Public content query
// ---------------------------------------------------------------------------

export const getContent = query({
  args: { source: v.string(), skillId: v.string() },
  returns: v.object({
    content: v.union(v.string(), v.null()),
    skillMdUrl: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { source, skillId }) => {
    const skill = await ctx.db
      .query("skills")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", source).eq("skillId", skillId),
      )
      .unique();
    return {
      content: skill?.content ?? null,
      skillMdUrl: skill?.skillMdUrl ?? null,
    };
  },
});

// ---------------------------------------------------------------------------
// Manual skill add (admin-only)
// ---------------------------------------------------------------------------
//
// Lets the dev/owner insert a skill that exists on skills.sh but isn't reachable
// via the leaderboard sync — i.e. absent from the all-time feed even though it
// has real installs (e.g. bklit/bklit-ui/bklit-ui at 234 installs, which the
// listing endpoint just never returns). The skill is verified against skills.sh
// before insert, so audits, install commands, and security infra all work the
// same as for any other skill — this just bypasses the leaderboard's coverage gap.
//
// Rows get `leaderboard: "manual"` as an origin tag. Keeping them fresh and
// protected from the 30-day delist is handled generically by
// reconcileUnseenSkills (which refreshes ANY healthy skill the leaderboard sync
// doesn't touch, regardless of origin tag) — there is no manual-specific cron.

const MANUAL_LEADERBOARD = "manual";
// The GitHub-only origin tag + quota machinery live in lib/githubQuota.ts —
// one module owns the tag the insert writes AND the tag the count filters on.

// parseSkillInput lives at lib/parse-skill-input.ts so the /dev/add-skill form
// can import it and validate input client-side. Validating before calling the
// action prevents Convex's dev-mode "Server Error" console overlay for what's
// really just bad input. The action below still calls parseSkillInput as
// defense-in-depth (and wraps thrown Error → ConvexError for production).

// Fence-strict, unlike discovery's `parseSkillMdName` (convex/lib/github.ts): "name: X",
// optionally quoted. Restricted to the YAML frontmatter block so we don't
// accidentally pick up a "name:" line in the body.
export function extractSkillMdName(content: string): string | null {
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const nameMatch = fm[1].match(/^name:\s*(.+)$/m);
  if (!nameMatch) return null;
  return nameMatch[1].trim().replace(/^["']|["']$/g, "");
}

export function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Tiny pre-check: is this skill already in our catalog? Used by
 * addSkillManually so the action can return `already_exists` without burning
 * a skills.sh detail call or hitting upsertSkillsBatch needlessly.
 */
export const getManualAddPrecheck = internalQuery({
  args: { source: v.string(), skillId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      name: v.string(),
      isDelisted: v.boolean(),
      // Exposed so addSkillManually can offer the adoption escape hatch: a
      // GitHub-only row must NOT short-circuit to already_exists, or the
      // documented "retry the normal add once it's listed" recovery would be
      // a dead end (the detail endpoint would never be consulted).
      isGitHubOnly: v.boolean(),
    }),
  ),
  handler: async (ctx, { source, skillId }) => {
    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", source).eq("skillId", skillId),
      )
      .unique();
    if (!summary) return null;
    return {
      name: summary.name,
      isDelisted: summary.isDelisted ?? false,
      isGitHubOnly: summary.isGitHubOnly ?? false,
    };
  },
});

/**
 * Normalize a skill's `leaderboard` origin tag to "manual" when relisting via
 * addSkillManually (upsertSkillsBatch never patches `leaderboard` itself — it's
 * set-on-insert only). Purely provenance now: reconcileUnseenSkills keeps skills
 * fresh by health + staleness, not by origin tag, so nothing depends on this tag
 * functionally — it just records that the admin re-added the row by hand.
 */
export const promoteSkillToManual = internalMutation({
  args: { source: v.string(), skillId: v.string() },
  handler: async (ctx, { source, skillId }) => {
    const skill = await ctx.db
      .query("skills")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", source).eq("skillId", skillId),
      )
      .unique();
    if (!skill) return;
    if (skill.leaderboard === MANUAL_LEADERBOARD) return; // already manual
    await ctx.db.patch(skill._id, { leaderboard: MANUAL_LEADERBOARD });
  },
});

type ManualAddResult = {
  status:
    | "inserted"
    | "relisted"
    | "already_exists"
    | "adopted"
    | "not_on_skills_sh";
  source: string;
  skillId: string;
  name: string;
};

const manualAddReturns = v.object({
  status: v.union(
    v.literal("inserted"),
    v.literal("relisted"),
    v.literal("already_exists"),
    // A GitHub-only row whose skill has since appeared on skills.sh was
    // upgraded to a normal row (marker cleared, real installs taken over).
    // This is the documented recovery path for a GitHub-only skill that
    // later gets listed but never shows up on a feed.
    v.literal("adopted"),
    // The skills.sh detail endpoint 404ed. Returned as a status — NOT thrown —
    // because prod Convex redacts non-ConvexError messages to a generic
    // "Server Error", so the client could never distinguish "not listed" (the
    // trigger for the GitHub-only fallback) from a real failure by
    // message-sniffing. Expected outcomes are data, not exceptions.
    v.literal("not_on_skills_sh"),
  ),
  source: v.string(),
  skillId: v.string(),
  name: v.string(),
});

/**
 * The manual-add pipeline, shared by the admin action and the public one.
 *
 * Verifies the skill exists on skills.sh, then routes through the canonical
 * upsertSkillsBatch with `leaderboard: "manual"`, and kicks the
 * discovery/content-fetch chain so SKILL.md is downloaded within seconds
 * rather than waiting for the next syncSkills run. When `addedBy` is supplied
 * (public flow) it's threaded into the insert for attribution — normal-add
 * rows land as `leaderboard: "manual"`, so they never count against the
 * GitHub-only quota. Callers own the auth gate before invoking this.
 */
async function manualAddCore(
  ctx: ActionCtx,
  input: string,
  addedBy?: Id<"users">,
): Promise<ManualAddResult> {
  // Wrap parseSkillInput's plain Error → ConvexError so production preserves
  // the message instead of redacting to a generic "Server Error". (Defense-
  // in-depth — the form already validates client-side; this only matters if
  // someone calls the action via the Convex dashboard or programmatically.)
  let source: string;
  let skillId: string;
  try {
    ({ source, skillId } = parseSkillInput(input));
  } catch (err) {
    if (err instanceof Error) throw new ConvexError(err.message);
    throw err;
  }

  // Skip the API call if the catalog already has this skill in good standing.
  // Re-adding is harmless (upsertSkillsBatch is idempotent), but we'd rather
  // give a clear "no-op" signal than a silent success.
  //
  // EXCEPT for GitHub-only rows: they are in the catalog but NOT on skills.sh,
  // and re-running the normal add is their documented adoption escape hatch (a
  // skill can be listed on skills.sh yet absent from every feed — the
  // improve-ui coverage gap — so feed-driven adoption alone can strand them at
  // 0 installs forever). Short-circuiting here would make that recovery a
  // silent no-op, so GitHub-only rows fall through to the detail probe: 200 →
  // adopt below; still 404 → report already_exists.
  const precheck: {
    name: string;
    isDelisted: boolean;
    isGitHubOnly: boolean;
  } | null = await ctx.runQuery(internal.skills.getManualAddPrecheck, {
    source,
    skillId,
  });
  if (precheck && !precheck.isDelisted && !precheck.isGitHubOnly) {
    return {
      status: "already_exists" as const,
      source,
      skillId,
      name: precheck.name,
    };
  }

  // Verify against skills.sh. A 404 is an EXPECTED outcome (the trigger for
  // the client's GitHub-only fallback), so it's returned as a status, not
  // thrown — see the returns-validator comment. Rate limits are wrapped in
  // ConvexError so the prod toast says something actionable instead of the
  // redacted "Server Error".
  let detail: V1SkillDetail;
  try {
    detail = await withTransientRetry(() => v1GetSkillDetail(source, skillId));
  } catch (err) {
    if (err instanceof SkillsApiNotFoundError) {
      // A live GitHub-only row that is STILL not on skills.sh: nothing to
      // adopt, and offering the GitHub fallback would only dead-end at
      // "already in the catalog" — report it as already existing instead.
      if (precheck && !precheck.isDelisted) {
        return {
          status: "already_exists" as const,
          source,
          skillId,
          name: precheck.name,
        };
      }
      return { status: "not_on_skills_sh" as const, source, skillId, name: "" };
    }
    if (err instanceof SkillsApiRateLimitError) {
      throw new ConvexError(
        "skills.sh is rate-limiting requests. Try again in a minute.",
      );
    }
    throw err;
  }

  // Pull the human name out of SKILL.md frontmatter (the listing endpoint
  // would have given it to us directly, but detail doesn't include name as
  // a top-level field). Fall back to a humanized slug if the SKILL.md
  // doesn't parse cleanly.
  const skillMd = detail.files?.find((f) => f.path === "SKILL.md");
  const parsedName = skillMd ? extractSkillMdName(skillMd.contents) : null;
  const name = parsedName ?? humanizeSlug(detail.slug);
  // Same source the content pipeline will use — parse it now so the immediate
  // Typesense index (below) has a description instead of just the name.
  const parsedDescription = skillMd
    ? (extractFrontmatterDescription(skillMd.contents) ?? undefined)
    : undefined;

  await ctx.runMutation(internal.skills.upsertSkillsBatch, {
    skills: [
      {
        source: detail.source,
        skillId: detail.slug,
        name,
        installs: detail.installs,
        // detail endpoint doesn't expose isDuplicate; default to false. If
        // the skill is later flagged as a duplicate upstream, syncSkills
        // mirrors that into our row next time it appears on the leaderboard.
        isDuplicate: false,
      },
    ],
    leaderboard: MANUAL_LEADERBOARD,
    ...(addedBy && { addedBy }),
  });

  // On relist: upsertSkillsBatch deliberately doesn't patch `leaderboard`
  // (origin tag, set on insert only), so normalize it to "manual" for
  // provenance. Keeping the relisted skill fresh + undeleted is handled
  // generically by reconcileUnseenSkills (by health + staleness, not by tag).
  if (precheck?.isDelisted) {
    await ctx.runMutation(internal.skills.promoteSkillToManual, {
      source: detail.source,
      skillId: detail.slug,
    });
  }

  // Backfill chain + cache bust + immediate Typesense index — shared with the
  // GitHub-only add; see lib/postAdd.ts for the why of each step.
  await kickPostAddChain(ctx, {
    source: detail.source,
    skillId: detail.slug,
    description: parsedDescription,
  });

  return {
    // A live row could only reach the upsert via the GitHub-only fall-through,
    // and the upsert (isGitHubOnly unset → false) just ran the adoption
    // transition: marker cleared, real install count owned.
    status: precheck?.isDelisted
      ? ("relisted" as const)
      : precheck
        ? ("adopted" as const)
        : ("inserted" as const),
    source: detail.source,
    skillId: detail.slug,
    name,
  };
}

/**
 * Admin-only manual skill add. See manualAddCore.
 */
export const addSkillManually = action({
  args: { input: v.string() },
  returns: manualAddReturns,
  // Explicit return-type annotation breaks the inference cycle introduced by
  // `ctx.runQuery(internal.skills.*)` referencing the same file's api type.
  handler: async (ctx, { input }): Promise<ManualAddResult> => {
    await assertAdmin(ctx);
    return manualAddCore(ctx, input);
  },
});

/**
 * Public manual skill add (Branch 1 of the public add flow). Any signed-in
 * user can add a skill that already exists on skills.sh — no quota, since the
 * row is vetted-by-skills.sh and would sync within a day anyway. Attribution
 * is stamped via `addedBy`. A `not_on_skills_sh` result is the client's signal
 * to fall through to the GitHub-only path (githubOnly.previewGitHubSkillPublic).
 */
export const addSkillManuallyPublic = action({
  args: { input: v.string() },
  returns: manualAddReturns,
  handler: async (ctx, { input }): Promise<ManualAddResult> => {
    const userId: Id<"users"> = await ctx.runQuery(
      internal.skills.getAuthedUserId,
      {},
    );
    // Same per-user throttle as the GitHub-only branch (throttle.ts): this
    // branch hits the skills.sh detail endpoint per call, and the client
    // cascades from here into the GitHub fallback, so both share one budget.
    await ctx.runMutation(internal.throttle.bumpAddSkillThrottle, { userId });
    try {
      return await manualAddCore(ctx, input, userId);
    } catch (err) {
      // Prod redacts non-ConvexError throws to "Server Error"; keep transient
      // upstream failures actionable for the user (logged server-side).
      throw toPublicError(
        err,
        "Something went wrong talking to skills.sh. Try again in a minute.",
      );
    }
  },
});

/**
 * Resolve the signed-in user's id, or throw a clean ConvexError. Used by the
 * public add actions (which run as actions and can't touch the db directly).
 */
export const getAuthedUserId = internalQuery({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new ConvexError("Sign in to add a skill.");
    return user._id;
  },
});

/**
 * The signed-in user's GitHub-only-add quota, plus their id — internal, for the
 * add actions (the "N of M used" preview indicator and the confirm-time gate).
 * Quota semantics live in lib/githubQuota.ts.
 */
export const getGitHubAddQuota = internalQuery({
  args: {},
  returns: v.object({ ...gitHubQuotaValidator.fields, userId: v.id("users") }),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new ConvexError("Sign in to add a skill.");
    const quota = await computeGitHubAddQuota(ctx, user._id);
    return { ...quota, userId: user._id };
  },
});

/**
 * The signed-in user's GitHub-only-add quota — public, for the /add page's
 * "X of 3 free adds used" indicator. Returns null when signed out.
 */
export const myGitHubAddQuota = query({
  args: {},
  returns: v.union(v.null(), gitHubQuotaValidator),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return await computeGitHubAddQuota(ctx, user._id);
  },
});
