import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  buildRepoFingerprint,
  fingerprintToEmbeddingInput,
  scanTree,
  parseGitHubUrl,
  type RepoFingerprint,
  type TreeScanResult,
} from "./github";
import { embedText } from "./lib/embeddings";
import {
  fetchRepoMetadata,
  fetchRepoTree,
  NOT_MODIFIED,
} from "./lib/github";

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

function makeCacheKey(owner: string, repo: string): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
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

export const cleanupExpiredFingerprintCache = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - FINGERPRINT_CACHE_TTL_MS;
    const expired = await ctx.db
      .query("repoFingerprintCache")
      .filter((q) => q.lt(q.field("cachedAt"), cutoff))
      .take(100);

    for (const entry of expired) {
      await ctx.db.delete(entry._id);
    }
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
          }),
        ),
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
  }>;
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
    const { limits } = await ctx.runQuery(
      internal.plans.internalCurrentPlan,
      {},
    );
    if (!limits.canAutoDetect) {
      return {
        error: "GitHub auto-detection requires a Pro plan.",
        repoName: "",
        fingerprint: null,
        recommendations: [],
      };
    }

    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      return {
        error: "Invalid GitHub URL",
        repoName: "",
        fingerprint: null,
        recommendations: [],
      };
    }

    const { owner, repo } = parsed;
    const repoName = `${owner}/${repo}`;
    const cacheKey = makeCacheKey(owner, repo);
    const repoKey = `${owner}/${repo}`;

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
    const treeCache = await ctx.runQuery(
      internal.githubCache.getTreeCache,
      { repo: repoKey },
    );

    let treeChanged = false;
    let scan: TreeScanResult | null = null;
    let branch: string | undefined;

    if (treeCache) {
      const treeResult = await fetchRepoTree(
        owner,
        repo,
        [treeCache.branch],
        { etag: treeCache.etag },
      );
      if (treeResult === NOT_MODIFIED) {
        // Repo unchanged — fingerprint cache (if any) is still valid
        await ctx.runMutation(internal.githubCache.touchTreeCache, {
          repo: repoKey,
        });
        branch = treeCache.branch;
        scan = decodeCachedScan(treeCache.dependencyFilePaths);
      } else if (treeResult) {
        // Repo changed — rebuild fingerprint even if cached
        treeChanged = true;
        branch = treeResult.branch;
        scan = scanTree(treeResult.entries);
        if (treeResult.etag) {
          await ctx.runMutation(internal.githubCache.setTreeCache, {
            repo: repoKey,
            branch: treeResult.branch,
            etag: treeResult.etag,
            dependencyFilePaths: encodeScanForCache(scan),
          });
        }
      } else {
        // Tree API failed — trust the fingerprint cache if available
        branch = treeCache.branch;
        scan = decodeCachedScan(treeCache.dependencyFilePaths);
      }
    } else {
      // No tree cache at all — need full rebuild
      treeChanged = true;
    }

    // ------------------------------------------------------------------
    // Step 2: Check fingerprint cache (skip if tree changed)
    // ------------------------------------------------------------------
    const cached = treeChanged
      ? null
      : await ctx.runQuery(
          internal.recommendations.getCachedFingerprint,
          { cacheKey },
        );

    if (cached) {
      fingerprint = cached.fingerprint;
      queryEmbedding = cached.embedding;

      // Full cache hit — skip vector search, summary lookups, and grouping.
      if (cached.recommendations) {
        return {
          error: null,
          repoName,
          fingerprint,
          recommendations: cached.recommendations,
        };
      }
    } else {
      // ------------------------------------------------------------------
      // Step 3: Fetch metadata + tree (if not already done)
      // ------------------------------------------------------------------
      const meta = await fetchRepoMetadata(owner, repo);
      if (!branch) branch = meta?.defaultBranch ?? "main";

      // If we don't have a tree scan yet (no cache existed), fetch fresh
      if (!scan) {
        const branchesToTry: string[] = [];
        if (meta?.defaultBranch) branchesToTry.push(meta.defaultBranch);
        if (!branchesToTry.includes("main")) branchesToTry.push("main");
        if (!branchesToTry.includes("master")) branchesToTry.push("master");

        const treeResult = await fetchRepoTree(owner, repo, branchesToTry);
        if (treeResult && treeResult !== NOT_MODIFIED) {
          branch = treeResult.branch;
          scan = scanTree(treeResult.entries);
          if (treeResult.etag) {
            await ctx.runMutation(internal.githubCache.setTreeCache, {
              repo: repoKey,
              branch: treeResult.branch,
              etag: treeResult.etag,
              dependencyFilePaths: encodeScanForCache(scan),
            });
          }
        }
        // If tree API fails, scan stays null — graceful degradation.
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
      fingerprint = await buildRepoFingerprint({
        owner,
        repo,
        branch,
        description: meta?.description ?? undefined,
        topics: meta?.topics ?? [],
        configFiles: scan?.configFiles ?? [],
        filesToFetch,
      });

      if (
        fingerprint.packages.length === 0 &&
        fingerprint.configFiles.length === 0 &&
        !fingerprint.readmeExcerpt &&
        !fingerprint.description &&
        fingerprint.topics.length === 0
      ) {
        return {
          error: "Could not fetch repository details",
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

      await ctx.runMutation(internal.recommendations.setCachedFingerprint, {
        cacheKey,
        fingerprint,
        embedding: queryEmbedding,
      });
    }

    // Vector search over the skillEmbeddings table. Returns embedding-row
    // IDs paired with cosine-similarity scores. We translate those IDs back
    // to summary metadata via the by_skillEmbeddingId index — never reading
    // the heavy embedding rows themselves.
    const results = await ctx.vectorSearch("skillEmbeddings", "by_embedding", {
      vector: queryEmbedding,
      limit: SEARCH_LIMIT,
      filter: (q) => q.eq("isDelisted", false),
    });

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
    const embeddingIds = results.map(
      (r) => r._id as Id<"skillEmbeddings">,
    );
    const entries = await ctx.runQuery(
      internal.skills.getSummariesByEmbeddingIds,
      { ids: embeddingIds },
    );

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

    // Helper: compute the composite score (vector + package bonus + popularity)
    // for a single variant, given its raw vector score.
    function computeScore(
      summary: (typeof entries)[number]["summary"],
      vectorScore: number,
    ): number {
      const haystack =
        `${summary.name} ${summary.description ?? ""}`.toLowerCase();
      let packageBonus = 0;
      for (const pkg of packageSet) {
        if (pkg.length >= 3 && haystack.includes(pkg)) {
          packageBonus += 0.2;
          if (packageBonus >= 0.6) break; // Cap the bonus
        }
      }
      const popBonus = 0.1 * Math.log10(summary.installs + 1);
      return vectorScore + packageBonus + popBonus;
    }

    interface PendingGroup {
      name: string;
      // The MAX composite score across all variants in this group.
      // Determines the group's position in the final result list.
      score: number;
      variants: Array<{
        source: string;
        skillId: string;
        description?: string;
        installs: number;
      }>;
    }

    const groupsByName = new Map<string, PendingGroup>();

    for (const result of results) {
      const summary = summaryByEmbeddingId.get(
        result._id as Id<"skillEmbeddings">,
      );
      if (!summary) continue;

      const variant = {
        source: summary.source,
        skillId: summary.skillId,
        description: summary.description,
        installs: summary.installs,
      };
      const variantScore = computeScore(summary, result._score);

      const existing = groupsByName.get(summary.name);
      if (existing === undefined) {
        groupsByName.set(summary.name, {
          name: summary.name,
          score: variantScore,
          variants: [variant],
        });
      } else {
        existing.variants.push(variant);
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
      };
    });

    // Cache recommendations so repeat analyses skip the vector search.
    await ctx.runMutation(internal.recommendations.setCachedRecommendations, {
      cacheKey,
      recommendations,
    });

    return {
      error: null,
      repoName,
      fingerprint,
      recommendations,
    };
  },
});
