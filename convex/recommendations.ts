import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  buildRepoFingerprint,
  fingerprintToEmbeddingInput,
  scanTree,
  type RepoFingerprint,
  type TreeScanResult,
} from "./github";
import { embedText } from "./lib/embeddings";
import { fetchRepoMetadata, fetchRepoTree, NOT_MODIFIED } from "./lib/github";
import { getGithubOauthToken } from "./lib/clerkGithub";
import {
  extractRepoSlug,
  matchesDemoRepo,
  isRepoMatchAllowed,
  PRO_REQUIRED,
} from "../lib/repo-match";

// ---------------------------------------------------------------------------
// Tree scan ↔ cache encoding
// ---------------------------------------------------------------------------
// The githubTreeCache schema stores `dependencyFilePaths: string[]`. We pack
// the full TreeScanResult into this array using prefixed entries so a 304
// cache hit can restore the scan without re-fetching the tree.

function encodeScanForCache(scan: TreeScanResult): string[] {
  return [
    ...scan.configFiles.map((p) => `c:${p}`),
    ...scan.workspacePackageJsonPaths.map((p) => `w:${p}`),
    ...scan.depFiles.map((p) => `d:${p}`),
    ...(scan.readmePath ? [`r:${scan.readmePath}`] : []),
  ];
}

function decodeCachedScan(encoded: string[]): TreeScanResult {
  const configFiles: string[] = [];
  const workspacePackageJsonPaths: string[] = [];
  const depFiles: string[] = [];
  let readmePath: string | null = null;

  for (const entry of encoded) {
    const prefix = entry.slice(0, 2);
    const path = entry.slice(2);
    switch (prefix) {
      case "c:":
        configFiles.push(path);
        break;
      case "w:":
        workspacePackageJsonPaths.push(path);
        break;
      case "d:":
        depFiles.push(path);
        break;
      case "r:":
        readmePath = path;
        break;
    }
  }

  return { configFiles, workspacePackageJsonPaths, depFiles, readmePath };
}

// ---------------------------------------------------------------------------
// Repo fingerprint cache
// ---------------------------------------------------------------------------

const FINGERPRINT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Toggle verbose cache-hit/miss logging for analyzeRepo. Flip to false to
// silence the pipeline logs in production.
const ANALYZE_REPO_DEBUG = false;

function debugLog(msg: string): void {
  if (ANALYZE_REPO_DEBUG) console.log(msg);
}

export const getCachedFingerprint = internalQuery({
  args: { cacheKey: v.string() },
  handler: async (ctx, { cacheKey }) => {
    const entry = await ctx.db
      .query("repoFingerprintCache")
      .withIndex("by_cacheKey", (q) => q.eq("cacheKey", cacheKey))
      .unique();
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > FINGERPRINT_CACHE_TTL_MS) return null;
    return {
      fingerprint: entry.fingerprint,
      embedding: entry.embedding,
      recommendations: entry.recommendations ?? null,
    };
  },
});

export const setCachedFingerprint = internalMutation({
  args: {
    cacheKey: v.string(),
    fingerprint: v.object({
      packages: v.array(v.string()),
      configFiles: v.array(v.string()),
      languages: v.array(v.string()),
      description: v.optional(v.string()),
      topics: v.array(v.string()),
      readmeExcerpt: v.optional(v.string()),
    }),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, { cacheKey, fingerprint, embedding }) => {
    const existing = await ctx.db
      .query("repoFingerprintCache")
      .withIndex("by_cacheKey", (q) => q.eq("cacheKey", cacheKey))
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        fingerprint,
        embedding,
        cachedAt: now,
        recommendations: undefined,
      });
    } else {
      await ctx.db.insert("repoFingerprintCache", {
        cacheKey,
        fingerprint,
        embedding,
        cachedAt: now,
      });
    }
  },
});

// Action + batch mutation so the daily cleanup keeps chewing through expired
// rows if more than one batch has accumulated, without risking a single
// mutation's write limit.
export const cleanupExpiredFingerprintCache = internalAction({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - FINGERPRINT_CACHE_TTL_MS;
    while (true) {
      const deleted: number = await ctx.runMutation(
        internal.recommendations.cleanupExpiredFingerprintCacheBatch,
        { cutoff },
      );
      if (deleted === 0) break;
    }
  },
});

export const cleanupExpiredFingerprintCacheBatch = internalMutation({
  args: { cutoff: v.number() },
  handler: async (ctx, { cutoff }) => {
    const expired = await ctx.db
      .query("repoFingerprintCache")
      .filter((q) => q.lt(q.field("cachedAt"), cutoff))
      .take(100);

    for (const entry of expired) {
      await ctx.db.delete(entry._id);
    }
    return expired.length;
  },
});

export const setCachedRecommendations = internalMutation({
  args: {
    cacheKey: v.string(),
    recommendations: v.array(
      v.object({
        name: v.string(),
        variantCount: v.number(),
        variants: v.array(
          v.object({
            source: v.string(),
            skillId: v.string(),
            description: v.optional(v.string()),
            installs: v.number(),
            curatedOwner: v.optional(v.string()),
            worstAuditStatus: v.optional(v.string()),
            worstAuditRiskLevel: v.optional(v.string()),
          }),
        ),
        matchedPackages: v.optional(v.array(v.string())),
      }),
    ),
  },
  handler: async (ctx, { cacheKey, recommendations }) => {
    const existing = await ctx.db
      .query("repoFingerprintCache")
      .withIndex("by_cacheKey", (q) => q.eq("cacheKey", cacheKey))
      .unique();

    // No-op if the row was deleted between setCachedFingerprint and this call.
    // The next analyzeRepo request will rebuild everything from scratch.
    if (existing) {
      await ctx.db.patch(existing._id, { recommendations });
    }
  },
});

// ---------------------------------------------------------------------------
// Public action: analyze a GitHub repo and return ranked skill recommendations
// ---------------------------------------------------------------------------

/**
 * A grouped recommendation row in the result list. Each group represents one
 * unique skill `name` and contains 1+ variants from different sources.
 *
 * Singleton groups (variantCount === 1) are rendered as the existing skill
 * row in the UI. Multi-variant groups are rendered as a collapsible row that
 * expands to show all variants.
 */
export interface GroupedRecommendation {
  name: string;
  /** True total count of variants in the candidate pool, even if `variants` is capped. */
  variantCount: number;
  /**
   * Variants of this skill from different sources. Sorted by install count
   * descending. Capped at MAX_VARIANTS_PER_GROUP entries — if `variantCount`
   * exceeds the cap, the trailing entries are dropped.
   */
  variants: Array<{
    source: string;
    skillId: string;
    description?: string;
    installs: number;
    /** Curated/official owner slug, when the variant is an official skill. */
    curatedOwner?: string;
    worstAuditStatus?: string;
    worstAuditRiskLevel?: string;
  }>;
  /**
   * Repo packages whose names literally appear in this group's name or
   * descriptions — the lexical slice of the match, surfaced as the row's
   * "matches: …" reason. Empty/absent = the match is purely semantic
   * (embedding similarity), which the results header explains.
   */
  matchedPackages?: string[];
}

export interface AnalyzeRepoResult {
  error: string | null;
  repoName: string;
  fingerprint: RepoFingerprint | null;
  recommendations: GroupedRecommendation[];
}

// Vector search candidate pool. Wider than RESULT_LIMIT because the grouping
// pass collapses same-name variants into single rows, and we want enough
// headroom so popular skills are likely to be in the pool.
//
// Capped at 250 because Convex's vectorSearch has a hard limit of 256
// results per query. This is the maximum candidate pool we can request.
const SEARCH_LIMIT = 250;

// Final number of GROUPS returned to the frontend (not entries — a single
// group can contain multiple variants behind a collapsible).
const RESULT_LIMIT = 60;

// Cap on how many variants ship per group. Beyond this, the long tail of
// forks isn't useful and just inflates the response payload. The frontend
// shows "showing N of M versions" when this cap kicks in.
const MAX_VARIANTS_PER_GROUP = 10;

export const analyzeRepo = action({
  args: { repoUrl: v.string() },
  handler: async (ctx, { repoUrl }): Promise<AnalyzeRepoResult> => {
    const parsed = extractRepoSlug(repoUrl);
    if (!parsed) {
      return {
        error: "Invalid GitHub URL",
        repoName: "",
        fingerprint: null,
        recommendations: [],
      };
    }

    // GitHub owner/repo are case-insensitive, so normalize to lowercase once at
    // the entrance. This is the security-relevant spot: matchesDemoRepo already
    // lowercases, so without this a case variant (`ShAdCn-Ui/Ui`) skips the plan
    // check AND misses the raw-cased tree cache, forcing a full unauthenticated
    // GitHub + embedding recompute per variant. One normalized key feeds both
    // caches (tree + fingerprint), so every case collapses to a single entry.
    const owner = parsed.owner.toLowerCase();
    const repo = parsed.repo.toLowerCase();
    // Lowercase feeds the caches + GitHub calls (both case-insensitive), so
    // every case variant collapses to one entry. Display keeps the user's
    // casing so "Microsoft/TypeScript" doesn't render all-lowercase.
    const repoName = `${parsed.owner}/${parsed.repo}`;
    const repoKey = `${owner}/${repo}`;
    const cacheKey = repoKey;

    // Repo match is Pro-gated; the demo allowlist is the one exception (runs
    // free for everyone, signed out included). Skip the plan query for demo
    // repos, and gate everything else through the shared predicate. Thrown as a
    // ConvexError so it lands as a query error, not cacheable data — see
    // PRO_REQUIRED. This is the authoritative gate; the client mirrors it only
    // to avoid the round-trip.
    if (!matchesDemoRepo(owner, repo)) {
      const { limits } = await ctx.runQuery(
        internal.plans.internalCurrentPlan,
        {},
      );
      if (!isRepoMatchAllowed(limits, owner, repo)) {
        throw new ConvexError({ code: PRO_REQUIRED });
      }
    }

    // ------------------------------------------------------------------
    // Public vs private analysis
    // ------------------------------------------------------------------
    // Private analyses run with the user's GitHub OAuth token (from Clerk)
    // and are isolated under `${clerkUserId}:owner/repo` cache keys — `:` is
    // outside GitHub's name charset and Clerk ids contain no `/`, so these
    // can never collide with the global `owner/repo` keys or each other.
    // The global cache is never written from a token-authenticated pass, so
    // one user's private fingerprint can't be served to anyone else.
    const identity = await ctx.auth.getUserIdentity();
    const privateKey = identity ? `${identity.subject}:${repoKey}` : null;

    // Private-first shortcut: a user-scoped tree-cache row means this user
    // has analyzed this repo privately before — skip the public pass (and
    // its guaranteed 404 probe) and go straight to the private one.
    if (identity && privateKey) {
      const privateTree = await ctx.runQuery(
        internal.githubCache.getTreeCache,
        { repo: privateKey },
      );
      if (privateTree) {
        const tokenResult = await getGithubOauthToken(identity.subject);
        if (tokenResult?.status === "connected") {
          return await runAnalysis(ctx, {
            owner,
            repo,
            repoName,
            cacheKey: privateKey,
            treeCacheKey: privateKey,
            token: tokenResult.token,
          });
        }
        // Token revoked/disconnected — fall through to the public pass.
      }
    }

    const publicResult = await runAnalysis(ctx, {
      owner,
      repo,
      repoName,
      cacheKey,
      treeCacheKey: repoKey,
    });
    if (publicResult.error !== FETCH_ERROR || !identity || !privateKey) {
      return publicResult;
    }

    // Public fetch failed and the caller is signed in — retry with their
    // GitHub token in case the repo is private and they have access. Any
    // non-connected token status keeps the public error: the picker UI, not
    // this error path, is what teaches users to connect GitHub.
    const tokenResult = await getGithubOauthToken(identity.subject);
    if (tokenResult?.status !== "connected") return publicResult;
    return await runAnalysis(ctx, {
      owner,
      repo,
      repoName,
      cacheKey: privateKey,
      treeCacheKey: privateKey,
      token: tokenResult.token,
    });
  },
});

const FETCH_ERROR = "Could not fetch repository details";

/**
 * The full analysis pipeline (tree freshness check → fingerprint → embedding
 * → vector search → grouping), parameterized over cache keys and an optional
 * user token so it can run as either the global public pass or a per-user
 * private pass.
 */
async function runAnalysis(
  ctx: ActionCtx,
  opts: {
    owner: string;
    repo: string;
    /** Display casing for results. */
    repoName: string;
    /** repoFingerprintCache key (global "owner/repo" or "user_…:owner/repo"). */
    cacheKey: string;
    /** githubTreeCache `repo` field key, same convention. */
    treeCacheKey: string;
    /** User OAuth token — presence marks this as a private pass. */
    token?: string;
  },
): Promise<AnalyzeRepoResult> {
  {
    const { owner, repo, repoName, cacheKey, treeCacheKey, token } = opts;
    const t0 = Date.now();
    let tPrev = t0;
    const mark = (label: string): void => {
      const now = Date.now();
      debugLog(`[analyzeRepo]   ⏱ ${label}: ${now - tPrev}ms`);
      tPrev = now;
    };

    debugLog(`[analyzeRepo] Starting for ${repoName}`);

    let fingerprint: RepoFingerprint;
    let queryEmbedding: number[];

    // ------------------------------------------------------------------
    // Step 1: Tree ETag freshness check
    // ------------------------------------------------------------------
    // Always check whether the repo has changed before trusting any cache.
    // With an authenticated GITHUB_TOKEN, 304 responses are free (don't
    // count against the 5,000/hour rate limit), so this costs only ~100ms
    // of latency. If the tree changed, we invalidate the fingerprint cache
    // and rebuild — so users who just restructured their repo get fresh
    // results immediately.
    const treeCache = await ctx.runQuery(internal.githubCache.getTreeCache, {
      repo: treeCacheKey,
    });

    let treeChanged = false;
    let scan: TreeScanResult | null = null;
    let branch: string | undefined;

    if (treeCache) {
      const treeResult = await fetchRepoTree(owner, repo, [treeCache.branch], {
        etag: treeCache.etag,
        token,
      });
      if (treeResult === NOT_MODIFIED) {
        // Repo unchanged — fingerprint cache (if any) is still valid
        debugLog(
          `[analyzeRepo] ✓ Tree cache HIT (304 Not Modified) — repo unchanged`,
        );
        await ctx.runMutation(internal.githubCache.touchTreeCache, {
          repo: treeCacheKey,
        });
        branch = treeCache.branch;
        scan = decodeCachedScan(treeCache.dependencyFilePaths);
      } else if (treeResult) {
        // Repo changed — rebuild fingerprint even if cached
        debugLog(`[analyzeRepo] ⟳ Tree cache STALE — repo changed, rebuilding`);
        treeChanged = true;
        branch = treeResult.branch;
        scan = scanTree(treeResult.entries);
        if (treeResult.etag) {
          await ctx.runMutation(internal.githubCache.setTreeCache, {
            repo: treeCacheKey,
            branch: treeResult.branch,
            etag: treeResult.etag,
            dependencyFilePaths: encodeScanForCache(scan),
          });
        }
      } else {
        // Tree API failed — trust the fingerprint cache if available
        debugLog(`[analyzeRepo] ⚠ Tree API failed — falling back to cache`);
        branch = treeCache.branch;
        scan = decodeCachedScan(treeCache.dependencyFilePaths);
      }
    } else {
      // No tree cache at all — need full rebuild
      debugLog(
        `[analyzeRepo] ✗ Tree cache MISS — first-time analysis or previously cleared`,
      );
      treeChanged = true;
    }
    mark("Tree check");

    // ------------------------------------------------------------------
    // Step 2: Check fingerprint cache (skip if tree changed)
    // ------------------------------------------------------------------
    const cached = treeChanged
      ? null
      : await ctx.runQuery(internal.recommendations.getCachedFingerprint, {
          cacheKey,
        });

    if (cached) {
      fingerprint = cached.fingerprint;
      queryEmbedding = cached.embedding;
      mark("Fingerprint cache check");

      // Full cache hit — skip vector search, summary lookups, and grouping.
      if (cached.recommendations) {
        debugLog(
          `[analyzeRepo] ✓ FULL CACHE HIT — returning ${cached.recommendations.length} cached recommendations (no vector search)`,
        );
        debugLog(`[analyzeRepo] Total: ${Date.now() - t0}ms`);
        return {
          error: null,
          repoName,
          fingerprint,
          recommendations: cached.recommendations,
        };
      }
      debugLog(
        `[analyzeRepo] ◐ PARTIAL CACHE HIT — reusing fingerprint+embedding, running vector search`,
      );
    } else {
      mark("Fingerprint cache check");
      debugLog(
        treeChanged
          ? `[analyzeRepo] ✗ Fingerprint cache SKIPPED (tree changed) — full rebuild from GitHub`
          : `[analyzeRepo] ✗ Fingerprint cache MISS — rebuilding fingerprint+embedding (tree data reused from cache)`,
      );
      // ------------------------------------------------------------------
      // Step 3: Fetch metadata + tree (if not already done)
      // ------------------------------------------------------------------
      const meta = await fetchRepoMetadata(owner, repo, token);
      if (!branch) branch = meta?.defaultBranch ?? "main";
      mark("GitHub metadata fetch");

      // If we don't have a tree scan yet (no cache existed), fetch fresh
      if (!scan) {
        const branchesToTry: string[] = [];
        if (meta?.defaultBranch) branchesToTry.push(meta.defaultBranch);
        if (!branchesToTry.includes("main")) branchesToTry.push("main");
        if (!branchesToTry.includes("master")) branchesToTry.push("master");

        const treeResult = await fetchRepoTree(owner, repo, branchesToTry, {
          token,
        });
        if (treeResult && treeResult !== NOT_MODIFIED) {
          branch = treeResult.branch;
          scan = scanTree(treeResult.entries);
          if (treeResult.etag) {
            await ctx.runMutation(internal.githubCache.setTreeCache, {
              repo: treeCacheKey,
              branch: treeResult.branch,
              etag: treeResult.etag,
              dependencyFilePaths: encodeScanForCache(scan),
            });
          }
        }
        // If tree API fails, scan stays null — graceful degradation.
      }

      // Nothing resolved at all (metadata 404 AND no tree): the repo is
      // private, deleted, or unreachable. Bail before firing the per-file
      // fetches below — on a private repo they are all guaranteed to fail.
      if (!meta && !scan) {
        return {
          error: FETCH_ERROR,
          repoName,
          fingerprint: null,
          recommendations: [],
        };
      }

      // ------------------------------------------------------------------
      // Step 4: Determine which files to fetch
      // ------------------------------------------------------------------
      const allDepFiles = [
        "package.json",
        "requirements.txt",
        "pyproject.toml",
        "Cargo.toml",
        "go.mod",
        "Dockerfile",
      ];
      const allReadmeCandidates = [
        "README.md",
        "readme.md",
        "README.MD",
        "Readme.md",
      ];

      let filesToFetch: string[];
      if (scan) {
        filesToFetch = [
          ...scan.depFiles,
          ...scan.workspacePackageJsonPaths,
          ...(scan.readmePath ? [scan.readmePath] : []),
        ];
      } else {
        filesToFetch = [...allDepFiles, ...allReadmeCandidates];
      }

      // ------------------------------------------------------------------
      // Step 5: Build fingerprint from resolved inputs
      // ------------------------------------------------------------------
      debugLog(
        `[analyzeRepo] Fetching ${filesToFetch.length} files from GitHub...`,
      );
      fingerprint = await buildRepoFingerprint({
        owner,
        repo,
        branch,
        description: meta?.description ?? undefined,
        topics: meta?.topics ?? [],
        configFiles: scan?.configFiles ?? [],
        filesToFetch,
        token,
      });
      mark(`GitHub file fetches (${filesToFetch.length} files)`);

      if (
        fingerprint.packages.length === 0 &&
        fingerprint.configFiles.length === 0 &&
        !fingerprint.readmeExcerpt &&
        !fingerprint.description &&
        fingerprint.topics.length === 0
      ) {
        return {
          error: FETCH_ERROR,
          repoName,
          fingerprint: null,
          recommendations: [],
        };
      }

      // ------------------------------------------------------------------
      // Step 6: Embed and cache
      // ------------------------------------------------------------------
      const embeddingInput = fingerprintToEmbeddingInput(fingerprint);
      try {
        queryEmbedding = await embedText(embeddingInput, "query");
      } catch (e) {
        console.error("Failed to embed repo fingerprint:", e);
        return {
          error: "Failed to analyze repository (embedding error)",
          repoName,
          fingerprint,
          recommendations: [],
        };
      }
      mark("Voyage embedding");

      await ctx.runMutation(internal.recommendations.setCachedFingerprint, {
        cacheKey,
        fingerprint,
        embedding: queryEmbedding,
      });
      mark("Save fingerprint cache");
    }

    // Vector search over the skillEmbeddings table. Returns embedding-row
    // IDs paired with cosine-similarity scores. We translate those IDs back
    // to summary metadata via the by_skillEmbeddingId index — never reading
    // the heavy embedding rows themselves.
    debugLog(`[analyzeRepo] Running vector search against skillEmbeddings...`);
    const results = await ctx.vectorSearch("skillEmbeddings", "by_embedding", {
      vector: queryEmbedding,
      limit: SEARCH_LIMIT,
      filter: (q) => q.eq("isDelisted", false),
    });
    debugLog(
      `[analyzeRepo] Vector search returned ${results.length} candidates`,
    );
    mark("Vector search");

    if (results.length === 0) {
      return {
        error: null,
        repoName,
        fingerprint,
        recommendations: [],
      };
    }

    // Load summary metadata for each ranked embedding. The summaries table
    // has a `skillEmbeddingId` back-reference so we can look up summaries
    // directly from the embedding IDs returned by vector search, without
    // ever reading the embedding rows themselves (each is ~12 KB).
    const embeddingIds = results.map((r) => r._id as Id<"skillEmbeddings">);
    const entries = await ctx.runQuery(
      internal.skills.getSummariesByEmbeddingIds,
      { ids: embeddingIds },
    );
    mark("Summary lookups");

    // Index summaries by their corresponding skillEmbedding _id so we can
    // preserve the vector-search ranking when looping over results below.
    const summaryByEmbeddingId = new Map(
      entries.map((e) => [e.skillEmbeddingId, e.summary]),
    );

    // ---------------------------------------------------------------------
    // Grouping pass — collapse same-name variants into one row each
    // ---------------------------------------------------------------------
    // Popular skills are forked verbatim into many repos' agent-skills
    // folders, producing 10-20+ rows in the database with the same name from
    // different sources. Without grouping, those variants each take a slot in
    // the top RESULT_LIMIT, crowding out genuinely different skills.
    //
    // Strategy: group every candidate by exact name. Each group becomes one
    // row in the final list, with all variants accessible behind a
    // collapsible UI. Singletons (groups of 1) render as normal rows.
    //
    // Score handling: a group inherits the MAX composite score across all
    // its variants. We compute the composite score (vector similarity +
    // package bonus + popularity bonus) for every variant and use the
    // highest. This means a group is ranked by whichever variant scored
    // best by any metric — so a group benefits from BOTH its best
    // vector-similarity match AND its most popular member.
    //
    // Variant ordering inside a group: install count descending. Once the
    // user has decided "I want this concept," install count is the most
    // useful trust signal for picking which version to install.
    //
    // Variant cap: MAX_VARIANTS_PER_GROUP. Beyond this, the long tail isn't
    // useful. The frontend can show "showing N of M" using `variantCount`.
    const packageSet = fingerprint.packages.map((p) => p.toLowerCase());

    // Helper: compute the composite score for a single variant.
    //
    // Uses multiplicative bonuses so everything scales with the underlying
    // vector relevance. An off-topic skill can't vault over relevant skills
    // no matter how many packages it mentions or how popular it is — its
    // low vector score keeps it low even after multipliers.
    //
    // Package multiplier — rewards skills whose name/description mentions
    // exact packages from the repo. Log-scaled so matches have diminishing
    // returns (1 match is a lot, 10th match is barely extra):
    //   1 match   → 1.03x
    //   3 matches → 1.06x
    //   7 matches → 1.09x
    //   15 matches→ 1.12x
    //   30 matches→ 1.15x
    //
    // Popularity multiplier — rewards skills with higher install counts:
    //   100 installs    → 1.10x
    //   1,000 installs  → 1.15x
    //   10,000 installs → 1.20x
    //   100,000 installs→ 1.25x
    function computeScore(
      summary: (typeof entries)[number]["summary"],
      vectorScore: number,
    ): { score: number; matchedPackages: string[] } {
      const haystack =
        `${summary.name} ${summary.description ?? ""}`.toLowerCase();
      // Collect the actual matching package names (not just a count) — they
      // double as the row's user-facing "matches: …" reason.
      const matchedPackages: string[] = [];
      for (const pkg of packageSet) {
        if (pkg.length >= 4 && haystack.includes(pkg)) matchedPackages.push(pkg);
      }
      const packageMultiplier =
        1 + 0.03 * Math.log2(matchedPackages.length + 1);
      const popMultiplier = 1 + 0.05 * Math.log10(summary.installs + 1);
      return {
        score: vectorScore * packageMultiplier * popMultiplier,
        matchedPackages,
      };
    }

    interface PendingGroup {
      name: string;
      // The MAX composite score across all variants in this group.
      // Determines the group's position in the final result list.
      score: number;
      // Union of every variant's lexical package matches (insertion-ordered).
      matchedPackages: Set<string>;
      variants: Array<{
        source: string;
        skillId: string;
        description?: string;
        installs: number;
        curatedOwner?: string;
        worstAuditStatus?: string;
        worstAuditRiskLevel?: string;
      }>;
    }

    const groupsByName = new Map<string, PendingGroup>();

    for (const result of results) {
      const summary = summaryByEmbeddingId.get(
        result._id as Id<"skillEmbeddings">,
      );
      if (!summary) continue;
      // Drop fork/copy duplicates from recommendation results — the user
      // expects to see the canonical skill, not a re-uploaded clone of it.
      if (summary.isDuplicate) continue;

      const variant = {
        source: summary.source,
        skillId: summary.skillId,
        description: summary.description,
        installs: summary.installs,
        curatedOwner: summary.curatedOwner,
        worstAuditStatus: summary.worstAuditStatus,
        worstAuditRiskLevel: summary.worstAuditRiskLevel,
      };
      const { score: variantScore, matchedPackages } = computeScore(
        summary,
        result._score,
      );

      const existing = groupsByName.get(summary.name);
      if (existing === undefined) {
        groupsByName.set(summary.name, {
          name: summary.name,
          score: variantScore,
          matchedPackages: new Set(matchedPackages),
          variants: [variant],
        });
      } else {
        existing.variants.push(variant);
        for (const pkg of matchedPackages) existing.matchedPackages.add(pkg);
        // Group inherits the best score across all its variants.
        if (variantScore > existing.score) {
          existing.score = variantScore;
        }
      }
    }

    // Sort groups by score descending and take the top RESULT_LIMIT.
    const sortedGroups = Array.from(groupsByName.values()).sort(
      (a, b) => b.score - a.score,
    );
    const topGroups = sortedGroups.slice(0, RESULT_LIMIT);

    // Within each group, sort variants by install count descending and cap.
    const recommendations: GroupedRecommendation[] = topGroups.map((group) => {
      const sortedVariants = group.variants
        .slice()
        .sort((a, b) => b.installs - a.installs);
      return {
        name: group.name,
        variantCount: sortedVariants.length,
        variants: sortedVariants.slice(0, MAX_VARIANTS_PER_GROUP),
        // Cap the user-facing match reason at 3 — one is a lot already.
        matchedPackages: Array.from(group.matchedPackages).slice(0, 3),
      };
    });

    mark("Grouping + scoring");

    // Cache recommendations so repeat analyses skip the vector search.
    debugLog(
      `[analyzeRepo] Saving ${recommendations.length} recommendations to cache`,
    );
    await ctx.runMutation(internal.recommendations.setCachedRecommendations, {
      cacheKey,
      recommendations,
    });
    mark("Save recommendations cache");
    debugLog(`[analyzeRepo] Total: ${Date.now() - t0}ms`);

    return {
      error: null,
      repoName,
      fingerprint,
      recommendations,
    };
  }
}
