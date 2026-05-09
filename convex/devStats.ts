import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// Number of discovery attempts before a skill is considered exhausted
// and stops being retried automatically.
export const MAX_DISCOVERY_FAILURES = 3;

// ---------------------------------------------------------------------------
// v1 migration diagnostic — one-shot read-only health check
// ---------------------------------------------------------------------------

/**
 * Single-call snapshot of the post-migration state. Reports counts that
 * answer: did the listing pass populate every row's lastSeenInApi? Did the
 * detail-fetch chain drain (needsContentFetch should be near 0)? Are
 * syncHashes now real SHA-256 strings? Are well-known sources present with
 * content? How many duplicates were flagged?
 *
 * Paginated through internalQuery batches so the action accumulates counts
 * across multiple read-budget-bounded queries (no single query reads the
 * whole table at once — that would exceed Convex's 16 MB per-call limit
 * once the table grew past ~19k rows).
 *
 * Run via: npx convex run devStats:v1MigrationDiagnostic
 */
interface DiagnosticBatch {
  total: number;
  delisted: number;
  needsContentFetch: number;
  hasContentFetchError: number;
  isDuplicate: number;
  withDescription: number;
  lastSeenInApiPopulated: number;
  sha256SyncHash: number;
  legacySyncHash: number;
  noSyncHash: number;
  github: number;
  wellKnown: number;
  wellKnownWithContent: number;
  wellKnownDomains: string[];
  sampleSha256: string[];
  wellKnownExample: { source: string; skillId: string } | null;
  nextCursor: string;
  isDone: boolean;
}

export const v1MigrationDiagnosticBatch = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }): Promise<DiagnosticBatch> => {
    // Page size 1000 × ~880 bytes per row ≈ 880 KB per call. Comfortably
    // under the 16 MB read budget with headroom.
    const result = await ctx.db
      .query("skillSummaries")
      .paginate({ numItems: 1000, cursor: cursor ?? null });

    const counts = {
      total: 0,
      delisted: 0,
      needsContentFetch: 0,
      hasContentFetchError: 0,
      isDuplicate: 0,
      withDescription: 0,
      lastSeenInApiPopulated: 0,
      sha256SyncHash: 0,
      legacySyncHash: 0,
      noSyncHash: 0,
      github: 0,
      wellKnown: 0,
      wellKnownWithContent: 0,
    };
    const wellKnownDomains: string[] = [];
    const sampleSha256: string[] = [];
    let wellKnownExample: { source: string; skillId: string } | null = null;

    for (const s of result.page) {
      counts.total++;
      if (s.isDelisted) counts.delisted++;
      if (s.needsContentFetch) counts.needsContentFetch++;
      if (s.hasContentFetchError) counts.hasContentFetchError++;
      if (s.isDuplicate) counts.isDuplicate++;
      if (s.description && s.description.length > 0) counts.withDescription++;
      if (s.lastSeenInApi !== undefined) counts.lastSeenInApiPopulated++;

      if (s.syncHash === undefined) {
        counts.noSyncHash++;
      } else if (
        s.syncHash.length === 64 &&
        /^[0-9a-f]+$/.test(s.syncHash)
      ) {
        counts.sha256SyncHash++;
        if (sampleSha256.length < 3) sampleSha256.push(s.syncHash);
      } else {
        counts.legacySyncHash++;
      }

      const orgSegment = s.source.split("/")[0] ?? "";
      const isWellKnown = orgSegment.includes(".");
      if (isWellKnown) {
        counts.wellKnown++;
        if (!wellKnownDomains.includes(orgSegment)) {
          wellKnownDomains.push(orgSegment);
        }
        if (s.description && s.description.length > 0) {
          counts.wellKnownWithContent++;
          if (!wellKnownExample) {
            wellKnownExample = { source: s.source, skillId: s.skillId };
          }
        }
      } else {
        counts.github++;
      }
    }

    return {
      ...counts,
      wellKnownDomains,
      sampleSha256,
      wellKnownExample,
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

/**
 * Pages through skills with hasContentFetchError=true and buckets them by
 * source-type plus live-probes a sample to see what skills.sh is actually
 * returning. Helps understand whether errors are real (slug-encoding-style
 * bugs in our code), transient (server 500s), or just "skills.sh has no
 * snapshot for this skill" (which the old pipeline would have silently
 * retired via MAX_DISCOVERY_FAILURES).
 *
 * Run via: npx convex run devStats:v1ErrorAnalysis
 */
interface ErrorBucketBatch {
  errorRows: Array<{ source: string; skillId: string; isWellKnown: boolean }>;
  nextCursor: string;
  isDone: boolean;
}

export const v1ErrorAnalysisBatch = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }): Promise<ErrorBucketBatch> => {
    const result = await ctx.db
      .query("skillSummaries")
      .withIndex("by_hasContentFetchError", (q) =>
        q.eq("hasContentFetchError", true),
      )
      .paginate({ numItems: 1000, cursor: cursor ?? null });

    const errorRows = result.page.map((s) => ({
      source: s.source,
      skillId: s.skillId,
      isWellKnown: (s.source.split("/")[0] ?? "").includes("."),
    }));

    return {
      errorRows,
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const v1ErrorAnalysis = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | undefined;
    let isDone = false;
    const allErrors: Array<{
      source: string;
      skillId: string;
      isWellKnown: boolean;
    }> = [];

    while (!isDone) {
      const batch: ErrorBucketBatch = await ctx.runQuery(
        internal.devStats.v1ErrorAnalysisBatch,
        { cursor },
      );
      for (const row of batch.errorRows) allErrors.push(row);
      cursor = batch.nextCursor;
      isDone = batch.isDone;
    }

    const githubErrors = allErrors.filter((r) => !r.isWellKnown);
    const wellKnownErrors = allErrors.filter((r) => r.isWellKnown);

    // Bucket GitHub errors by org so we can spot patterns (one bad org
    // dominating vs random spread).
    const orgCounts = new Map<string, number>();
    for (const e of githubErrors) {
      const org = e.source.split("/")[0] ?? e.source;
      orgCounts.set(org, (orgCounts.get(org) ?? 0) + 1);
    }
    const topOrgs = Array.from(orgCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([org, count]) => ({ org, count }));

    // Bucket well-known errors by domain.
    const domainCounts = new Map<string, number>();
    for (const e of wellKnownErrors) {
      const domain = e.source.split("/")[0] ?? e.source;
      domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
    }
    const wellKnownByDomain = Array.from(domainCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([domain, count]) => ({ domain, count }));

    // Live-probe up to 5 GitHub errors and 5 well-known errors. Calls the
    // v1 detail endpoint directly and reports what came back. This is what
    // tells us whether errors are 404 (skills.sh has no snapshot), 500
    // (their server crashed), or 200-with-no-SKILL.md (snapshot exists but
    // the file isn't named SKILL.md).
    const probeSamples = [
      ...githubErrors.slice(0, 5),
      ...wellKnownErrors.slice(0, 5),
    ];

    const probes: Array<{
      source: string;
      skillId: string;
      status: number;
      hasFiles: boolean;
      fileCount: number;
      hasSkillMd: boolean;
      filePaths: string[];
      bodyPreview?: string;
    }> = [];

    for (const sample of probeSamples) {
      const url = `https://skills.sh/api/v1/skills/${sample.source}/${encodeURIComponent(sample.skillId)}`;
      try {
        const res = await fetch(url, {
          headers: process.env.SKILLS_SH_API_KEY
            ? { Authorization: `Bearer ${process.env.SKILLS_SH_API_KEY}` }
            : {},
        });
        if (res.ok) {
          const data = (await res.json()) as {
            files: Array<{ path: string }> | null;
          };
          const filePaths = (data.files ?? []).map((f) => f.path);
          probes.push({
            source: sample.source,
            skillId: sample.skillId,
            status: res.status,
            hasFiles: data.files !== null,
            fileCount: filePaths.length,
            hasSkillMd: filePaths.includes("SKILL.md"),
            filePaths: filePaths.slice(0, 10),
          });
        } else {
          const text = await res.text().catch(() => "");
          probes.push({
            source: sample.source,
            skillId: sample.skillId,
            status: res.status,
            hasFiles: false,
            fileCount: 0,
            hasSkillMd: false,
            filePaths: [],
            bodyPreview: text.slice(0, 200),
          });
        }
      } catch (e) {
        probes.push({
          source: sample.source,
          skillId: sample.skillId,
          status: -1,
          hasFiles: false,
          fileCount: 0,
          hasSkillMd: false,
          filePaths: [],
          bodyPreview: String(e).slice(0, 200),
        });
      }
    }

    return {
      total: allErrors.length,
      githubCount: githubErrors.length,
      wellKnownCount: wellKnownErrors.length,
      topErroringGithubOrgs: topOrgs,
      wellKnownErrorsByDomain: wellKnownByDomain,
      probes,
    };
  },
});

export const v1MigrationDiagnostic = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | undefined;
    let isDone = false;

    const totals = {
      total: 0,
      delisted: 0,
      needsContentFetch: 0,
      hasContentFetchError: 0,
      isDuplicate: 0,
      withDescription: 0,
      lastSeenInApiPopulated: 0,
      sha256SyncHash: 0,
      legacySyncHash: 0,
      noSyncHash: 0,
      github: 0,
      wellKnown: 0,
      wellKnownWithContent: 0,
    };
    const wellKnownDomains = new Set<string>();
    const sampleSha256: string[] = [];
    let wellKnownExample: { source: string; skillId: string } | null = null;

    while (!isDone) {
      const batch: DiagnosticBatch = await ctx.runQuery(
        internal.devStats.v1MigrationDiagnosticBatch,
        { cursor },
      );
      totals.total += batch.total;
      totals.delisted += batch.delisted;
      totals.needsContentFetch += batch.needsContentFetch;
      totals.hasContentFetchError += batch.hasContentFetchError;
      totals.isDuplicate += batch.isDuplicate;
      totals.withDescription += batch.withDescription;
      totals.lastSeenInApiPopulated += batch.lastSeenInApiPopulated;
      totals.sha256SyncHash += batch.sha256SyncHash;
      totals.legacySyncHash += batch.legacySyncHash;
      totals.noSyncHash += batch.noSyncHash;
      totals.github += batch.github;
      totals.wellKnown += batch.wellKnown;
      totals.wellKnownWithContent += batch.wellKnownWithContent;
      for (const d of batch.wellKnownDomains) wellKnownDomains.add(d);
      for (const h of batch.sampleSha256) {
        if (sampleSha256.length < 3) sampleSha256.push(h);
      }
      if (!wellKnownExample && batch.wellKnownExample) {
        wellKnownExample = batch.wellKnownExample;
      }
      cursor = batch.nextCursor;
      isDone = batch.isDone;
    }

    return {
      total: totals.total,
      delisted: totals.delisted,
      active: totals.total - totals.delisted,
      needsContentFetch: totals.needsContentFetch,
      hasContentFetchError: totals.hasContentFetchError,
      isDuplicate: totals.isDuplicate,
      withDescription: totals.withDescription,
      lastSeenInApiPopulated: totals.lastSeenInApiPopulated,
      syncHash: {
        sha256: totals.sha256SyncHash,
        legacy: totals.legacySyncHash,
        missing: totals.noSyncHash,
        sampleSha256,
      },
      sourceTypes: {
        github: totals.github,
        wellKnown: totals.wellKnown,
        wellKnownDistinctOrgs: wellKnownDomains.size,
        wellKnownDomains: Array.from(wellKnownDomains).sort(),
        wellKnownWithContent: totals.wellKnownWithContent,
        wellKnownExample,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Admin guard — checks caller's email against ADMIN_EMAILS env var
// ---------------------------------------------------------------------------

// Parsed once per Convex deployment / cold start. Worth caching since
// `checkIsAdmin` runs on every reactive re-evaluation of `getByUrlId`, and
// re-splitting the env var per call is wasted work.
const ADMIN_EMAILS: readonly string[] = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);

// Non-throwing admin check. Use when you need a boolean without short-circuiting
// the surrounding query (e.g. folding `viewerIsAdmin` into a public bundle query).
export async function checkIsAdmin(ctx: {
  auth: QueryCtx["auth"];
}): Promise<boolean> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.email) return false;
  return ADMIN_EMAILS.includes(identity.email);
}

// Synchronous overload for callers that already have the user's email in scope
// (e.g. after `getCurrentUser`). Avoids a second `ctx.auth.getUserIdentity()`
// call in hot paths like `getByUrlId` that reactively re-runs on every bundle update.
export function checkIsAdminByEmail(email: string | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
}

export async function assertAdmin(ctx: { auth: QueryCtx["auth"] }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.email) throw new Error("Not authenticated");
  if (ADMIN_EMAILS.length === 0) throw new Error("ADMIN_EMAILS not configured");
  if (!ADMIN_EMAILS.includes(identity.email)) throw new Error("Not authorized");
}

export const isAdmin = query({
  args: {},
  handler: async (ctx) => checkIsAdmin(ctx),
});

// ---------------------------------------------------------------------------
// Stats (reads a single cached document)
// ---------------------------------------------------------------------------

export const getSyncStats = query({
  args: {},
  handler: async (ctx) => {
    await assertAdmin(ctx);
    const stats = await ctx.db.query("syncStats").first();
    return (
      stats ?? {
        totalSkills: 0,
        contentFetchErrors: 0,
        pendingContentFetch: 0,
        pendingDiscovery: 0,
        noSkillMdUrl: 0,
        noUrlExhausted: 0,
        delisted: 0,
        recalculatedAt: 0,
      }
    );
  },
});

/**
 * Reactive list of skills the embedding worker gave up on. Uses an indexed
 * query so the cost scales with the number of matching rows, not the total
 * size of the table. Currently expected to be empty in the happy path
 * (~0 KB read), and never expensive even with hundreds of skipped skills.
 */
export const listUnembeddableSkills = query({
  args: {},
  handler: async (ctx) => {
    await assertAdmin(ctx);
    // The by_embeddingSkipReason index is sorted with `undefined` first,
    // then the actual reason strings. `gt(field, "")` walks past the
    // undefined entries and returns only rows with a real reason set.
    const summaries = await ctx.db
      .query("skillSummaries")
      .withIndex("by_embeddingSkipReason", (q) =>
        q.gt("embeddingSkipReason", ""),
      )
      .collect();
    return summaries.map((s) => ({
      id: s.skillDocId,
      source: s.source,
      skillId: s.skillId,
      name: s.name,
      reason: s.embeddingSkipReason,
      installs: s.installs,
    }));
  },
});

/**
 * Reactive list of skills embedded with the "minimal" fallback (name +
 * description only, no content). These skills have degraded embeddings
 * because their content was too dense to fit OpenAI's per-input token limit.
 * If this list grows large, consider improving truncation strategy
 * (tiktoken-based truncation, chunking, etc).
 */
export const listMinimalModeSkills = query({
  args: {},
  handler: async (ctx) => {
    await assertAdmin(ctx);
    const summaries = await ctx.db
      .query("skillSummaries")
      .withIndex("by_embeddingMode", (q) => q.eq("embeddingMode", "minimal"))
      .collect();
    return summaries.map((s) => ({
      id: s.skillDocId,
      source: s.source,
      skillId: s.skillId,
      name: s.name,
      installs: s.installs,
    }));
  },
});

/** Recalculate all stats by scanning summaries. Called at end of sync pipeline. */
export const recalculateStatsBatch = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const paginationOpts = cursor
      ? { numItems: 500, cursor }
      : { numItems: 500, cursor: null };
    const result = await ctx.db
      .query("skillSummaries")
      .paginate(paginationOpts);

    let totalSkills = 0;
    let contentFetchErrors = 0;
    let pendingContentFetch = 0;
    let pendingDiscovery = 0;
    let noSkillMdUrl = 0;
    let noUrlExhausted = 0;
    let delisted = 0;

    for (const s of result.page) {
      totalSkills++;
      if (s.hasContentFetchError) contentFetchErrors++;
      if (s.needsContentFetch) pendingContentFetch++;
      if (s.needsDiscovery) pendingDiscovery++;
      if (s.hasSkillMdUrl === false) {
        noSkillMdUrl++;
        if ((s.discoveryFailCount ?? 0) >= MAX_DISCOVERY_FAILURES)
          noUrlExhausted++;
      }
      if (s.isDelisted) delisted++;
    }

    return {
      totalSkills,
      contentFetchErrors,
      pendingContentFetch,
      pendingDiscovery,
      noSkillMdUrl,
      noUrlExhausted,
      delisted,
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const recalculateStats = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | undefined;
    let isDone = false;
    const totals = {
      totalSkills: 0,
      contentFetchErrors: 0,
      pendingContentFetch: 0,
      pendingDiscovery: 0,
      noSkillMdUrl: 0,
      noUrlExhausted: 0,
      delisted: 0,
    };

    while (!isDone) {
      const result: {
        totalSkills: number;
        contentFetchErrors: number;
        pendingContentFetch: number;
        pendingDiscovery: number;
        noSkillMdUrl: number;
        noUrlExhausted: number;
        delisted: number;
        nextCursor: string;
        isDone: boolean;
      } = await ctx.runMutation(internal.devStats.recalculateStatsBatch, {
        cursor,
      });

      totals.totalSkills += result.totalSkills;
      totals.contentFetchErrors += result.contentFetchErrors;
      totals.pendingContentFetch += result.pendingContentFetch;
      totals.pendingDiscovery += result.pendingDiscovery;
      totals.noSkillMdUrl += result.noSkillMdUrl;
      totals.noUrlExhausted += result.noUrlExhausted;
      totals.delisted += result.delisted;

      cursor = result.nextCursor;
      isDone = result.isDone;
    }

    // Upsert the single stats document
    await ctx.runMutation(internal.devStats.upsertStats, {
      ...totals,
      recalculatedAt: Date.now(),
    });

    console.log(`Recalculated sync stats: ${JSON.stringify(totals)}`);
  },
});

export const upsertStats = internalMutation({
  args: {
    totalSkills: v.number(),
    contentFetchErrors: v.number(),
    pendingContentFetch: v.number(),
    pendingDiscovery: v.number(),
    noSkillMdUrl: v.number(),
    noUrlExhausted: v.number(),
    delisted: v.number(),
    recalculatedAt: v.number(),
  },
  handler: async (ctx, stats) => {
    const existing = await ctx.db.query("syncStats").first();
    if (existing) {
      await ctx.db.patch(existing._id, stats);
    } else {
      await ctx.db.insert("syncStats", stats);
    }
  },
});

const errorFilterValidator = v.union(
  v.literal("contentFetchError"),
  v.literal("pendingContentFetch"),
  v.literal("pendingDiscovery"),
  v.literal("noUrlRetrying"),
  v.literal("noUrlExhausted"),
  v.literal("delisted"),
);

export const listSkillsWithErrors = query({
  args: {
    filter: errorFilterValidator,
  },
  handler: async (ctx, { filter }) => {
    await assertAdmin(ctx);

    // All queries use summaries (~200 bytes) instead of skills (~30KB)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function mapSummary(s: any) {
      return {
        _id: s.skillDocId ?? s._id,
        source: s.source as string,
        skillId: s.skillId as string,
        name: s.name as string,
        installs: s.installs as number,
        hasContentFetchError: s.hasContentFetchError as boolean | undefined,
        skillMdUrl: s.skillMdUrl as string | undefined,
        needsDiscovery: s.needsDiscovery as boolean | undefined,
        needsContentFetch: s.needsContentFetch as boolean | undefined,
        contentFetchedAt: s.contentFetchedAt as number | undefined,
        isDelisted: s.isDelisted as boolean | undefined,
        discoveryFailCount: s.discoveryFailCount as number | undefined,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let skills: any[];

    switch (filter) {
      case "contentFetchError": {
        const results = await ctx.db
          .query("skillSummaries")
          .withIndex("by_hasContentFetchError", (q) =>
            q.eq("hasContentFetchError", true),
          )
          .collect();
        skills = results.filter((s) => s.skillDocId).map(mapSummary);
        break;
      }
      case "pendingContentFetch": {
        const results = await ctx.db
          .query("skillSummaries")
          .withIndex("by_needsContentFetch", (q) =>
            q.eq("needsContentFetch", true),
          )
          .collect();
        skills = results.filter((s) => s.skillDocId).map(mapSummary);
        break;
      }
      case "pendingDiscovery": {
        const results = await ctx.db
          .query("skillSummaries")
          .withIndex("by_needsDiscovery", (q) =>
            q.eq("needsDiscovery", true),
          )
          .collect();
        skills = results.filter((s) => s.skillDocId).map(mapSummary);
        break;
      }
      case "noUrlRetrying": {
        const results = await ctx.db
          .query("skillSummaries")
          .withIndex("by_hasSkillMdUrl", (q) => q.eq("hasSkillMdUrl", false))
          .collect();
        skills = results
          .filter(
            (s) =>
              s.skillDocId &&
              (s.discoveryFailCount ?? 0) < MAX_DISCOVERY_FAILURES,
          )
          .map(mapSummary);
        break;
      }
      case "noUrlExhausted": {
        const results = await ctx.db
          .query("skillSummaries")
          .withIndex("by_hasSkillMdUrl", (q) => q.eq("hasSkillMdUrl", false))
          .collect();
        skills = results
          .filter(
            (s) =>
              s.skillDocId &&
              (s.discoveryFailCount ?? 0) >= MAX_DISCOVERY_FAILURES,
          )
          .map(mapSummary);
        break;
      }
      case "delisted": {
        const results = await ctx.db
          .query("skillSummaries")
          .withIndex("by_isDelisted", (q) => q.eq("isDelisted", true))
          .collect();
        skills = results.filter((s) => s.skillDocId).map(mapSummary);
        break;
      }
    }

    return { skills };
  },
});

// ---------------------------------------------------------------------------
// Internal mutations (not callable by clients directly)
// ---------------------------------------------------------------------------

export const retryContentFetch = internalMutation({
  args: { skillId: v.id("skills") },
  handler: async (ctx, { skillId }) => {
    const skill = await ctx.db.get(skillId);
    if (!skill) return;

    await ctx.db.patch(skillId, {
      needsContentFetch: true,
      hasContentFetchError: false,
      contentFetchFailCount: 0,
    });

    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", skill.source).eq("skillId", skill.skillId),
      )
      .unique();
    if (summary) {
      await ctx.db.patch(summary._id, {
        needsContentFetch: true,
        hasContentFetchError: false,
      });
    }
  },
});

export const retryDiscovery = internalMutation({
  args: { skillId: v.id("skills") },
  handler: async (ctx, { skillId }) => {
    const skill = await ctx.db.get(skillId);
    if (!skill) return;

    await ctx.db.patch(skillId, {
      needsDiscovery: true,
      skillMdUrl: "",
      hasContentFetchError: false,
      contentFetchFailCount: 0,
      discoveryFailCount: 0,
    });

    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", skill.source).eq("skillId", skill.skillId),
      )
      .unique();
    if (summary) {
      await ctx.db.patch(summary._id, {
        needsDiscovery: true,
        skillMdUrl: "",
        hasSkillMdUrl: false,
        hasContentFetchError: false,
        discoveryFailCount: 0,
      });
    }
  },
});

export const retryBatch = internalMutation({
  args: {
    filter: v.union(
      v.literal("contentFetchError"),
      v.literal("noUrlExhausted"),
    ),
  },
  handler: async (ctx, { filter }) => {
    let count = 0;

    if (filter === "contentFetchError") {
      const summaries = await ctx.db
        .query("skillSummaries")
        .withIndex("by_hasContentFetchError", (q) =>
          q.eq("hasContentFetchError", true),
        )
        .take(200);

      for (const summary of summaries) {
        const hasUrl = summary.skillMdUrl && summary.skillMdUrl !== "";
        if (summary.skillDocId) {
          await ctx.db.patch(summary.skillDocId, {
            hasContentFetchError: false,
            contentFetchFailCount: 0,
            ...(hasUrl
              ? { needsContentFetch: true }
              : { needsDiscovery: true, discoveryFailCount: 0 }),
          });
        }
        await ctx.db.patch(summary._id, {
          hasContentFetchError: false,
          ...(hasUrl
            ? { needsContentFetch: true }
            : { needsDiscovery: true, discoveryFailCount: 0 }),
        });
        count++;
      }
    } else if (filter === "noUrlExhausted") {
      // Reset skills that have given up on discovery (failCount >= MAX_DISCOVERY_FAILURES)
      // TODO: .collect() is unbounded — risks Convex's 16k doc limit if the no-URL set
      // grows large. Consider an index on (hasSkillMdUrl, discoveryFailCount) or paginating.
      const summaries = await ctx.db
        .query("skillSummaries")
        .withIndex("by_hasSkillMdUrl", (q) => q.eq("hasSkillMdUrl", false))
        .collect();

      const exhausted = summaries
        .filter((s) => (s.discoveryFailCount ?? 0) >= MAX_DISCOVERY_FAILURES)
        .slice(0, 200);

      for (const summary of exhausted) {
        if (summary.skillDocId) {
          await ctx.db.patch(summary.skillDocId, {
            needsDiscovery: true,
            skillMdUrl: "",
            hasContentFetchError: false,
            contentFetchFailCount: 0,
            discoveryFailCount: 0,
          });
        }
        await ctx.db.patch(summary._id, {
          needsDiscovery: true,
          skillMdUrl: "",
          hasSkillMdUrl: false,
          hasContentFetchError: false,
          discoveryFailCount: 0,
        });
        count++;
      }
    }

    return { count };
  },
});

// ---------------------------------------------------------------------------
// Actions (public — called from dashboard, delegate to internal mutations)
// ---------------------------------------------------------------------------

export const callRetryContentFetch = action({
  args: { skillId: v.id("skills") },
  handler: async (ctx, { skillId }) => {
    await assertAdmin(ctx);
    await ctx.runMutation(internal.devStats.retryContentFetch, { skillId });
  },
});

export const callRetryDiscovery = action({
  args: { skillId: v.id("skills") },
  handler: async (ctx, { skillId }) => {
    await assertAdmin(ctx);
    await ctx.runMutation(internal.devStats.retryDiscovery, { skillId });
  },
});

export const callRetryBatch = action({
  args: {
    filter: v.union(
      v.literal("contentFetchError"),
      v.literal("noUrlExhausted"),
    ),
  },
  handler: async (ctx, { filter }): Promise<{ count: number }> => {
    await assertAdmin(ctx);
    return await ctx.runMutation(internal.devStats.retryBatch, { filter });
  },
});

export const triggerSync = action({
  args: {},
  handler: async (ctx) => {
    await assertAdmin(ctx);
    await ctx.scheduler.runAfter(0, internal.skills.syncSkills, {});
    return { scheduled: true };
  },
});

export const triggerBackfill = action({
  args: {
    type: v.union(v.literal("summaries"), v.literal("embeddings")),
  },
  handler: async (ctx, { type }) => {
    await assertAdmin(ctx);
    switch (type) {
      case "summaries":
        await ctx.scheduler.runAfter(
          0,
          internal.skills.backfillSkillSummaries,
          {},
        );
        break;
      case "embeddings":
        await ctx.scheduler.runAfter(
          0,
          internal.skills.backfillEmbeddings,
          {},
        );
        break;
    }
    return { scheduled: true, type };
  },
});

export const triggerRecalculateStats = action({
  args: {},
  handler: async (ctx) => {
    await assertAdmin(ctx);
    await ctx.scheduler.runAfter(0, internal.devStats.recalculateStats, {});
    return { scheduled: true };
  },
});

const ALLOWED_URL_PREFIXES = [
  "https://raw.githubusercontent.com/",
  "https://github.com/",
];

// Diagnostic: scan delisted skills and bucket by last-known install count.
// Tells us whether the 50-install floor is delisting skills (bucket clusters
// near 50) or whether skills.sh is removing them upstream at all install
// levels.
export const analyzeDelistedBatch = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db
      .query("skills")
      .withIndex("by_isDelisted", (q) => q.eq("isDelisted", true))
      .paginate({ numItems: 200, cursor: cursor ?? null });

    const buckets = {
      under50: 0,
      "50-99": 0,
      "100-499": 0,
      "500-999": 0,
      "1000-4999": 0,
      "5000plus": 0,
    };
    const samples: Array<{
      source: string;
      skillId: string;
      installs: number;
      lastSeenInApi: number | undefined;
    }> = [];

    for (const s of result.page) {
      if (s.installs < 50) buckets.under50++;
      else if (s.installs < 100) buckets["50-99"]++;
      else if (s.installs < 500) buckets["100-499"]++;
      else if (s.installs < 1000) buckets["500-999"]++;
      else if (s.installs < 5000) buckets["1000-4999"]++;
      else buckets["5000plus"]++;

      if (samples.length < 5) {
        samples.push({
          source: s.source,
          skillId: s.skillId,
          installs: s.installs,
          lastSeenInApi: s.lastSeenInApi,
        });
      }
    }

    return {
      pageCount: result.page.length,
      buckets,
      samples,
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const analyzeDelistedSkills = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    total: number;
    buckets: Record<string, number>;
    samples: Array<{
      source: string;
      skillId: string;
      installs: number;
      lastSeenInApi: number | undefined;
    }>;
  }> => {
    await assertAdmin(ctx);

    let cursor: string | undefined;
    let isDone = false;
    const totals: Record<string, number> = {
      under50: 0,
      "50-99": 0,
      "100-499": 0,
      "500-999": 0,
      "1000-4999": 0,
      "5000plus": 0,
    };
    let total = 0;
    const samples: Array<{
      source: string;
      skillId: string;
      installs: number;
      lastSeenInApi: number | undefined;
    }> = [];

    while (!isDone) {
      const res: {
        pageCount: number;
        buckets: Record<string, number>;
        samples: Array<{
          source: string;
          skillId: string;
          installs: number;
          lastSeenInApi: number | undefined;
        }>;
        nextCursor: string;
        isDone: boolean;
      } = await ctx.runQuery(internal.devStats.analyzeDelistedBatch, {
        cursor,
      });

      total += res.pageCount;
      for (const k of Object.keys(totals)) {
        totals[k] += res.buckets[k];
      }
      if (samples.length < 15) {
        samples.push(...res.samples.slice(0, 15 - samples.length));
      }

      cursor = res.nextCursor;
      isDone = res.isDone;
    }

    return { total, buckets: totals, samples };
  },
});

export const probeSkillUrl = action({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    await assertAdmin(ctx);
    if (!ALLOWED_URL_PREFIXES.some((prefix) => url.startsWith(prefix))) {
      return { status: 0, ok: false, error: "URL not allowed" };
    }
    try {
      const res = await fetch(url, { method: "HEAD" });
      return { status: res.status, ok: res.ok };
    } catch (e) {
      return { status: 0, ok: false, error: String(e) };
    }
  },
});
