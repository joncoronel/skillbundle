import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  buildRepoFingerprint,
  fingerprintToEmbeddingInput,
  parseGitHubUrl,
  type RepoFingerprint,
} from "./github";
import { embedText } from "./lib/embeddings";

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

    // Try cache first — repeat detections of the same repo are free
    let fingerprint: RepoFingerprint;
    let queryEmbedding: number[];

    const cached = await ctx.runQuery(
      internal.recommendations.getCachedFingerprint,
      { cacheKey },
    );
    if (cached) {
      fingerprint = cached.fingerprint;
      queryEmbedding = cached.embedding;
    } else {
      // Fetch fresh fingerprint
      const built = await buildRepoFingerprint(owner, repo);
      if (!built) {
        return {
          error: "Could not fetch repository details",
          repoName,
          fingerprint: null,
          recommendations: [],
        };
      }
      fingerprint = built.fingerprint;

      // Embed the fingerprint text
      const embeddingInput = fingerprintToEmbeddingInput(built.fingerprint);
      try {
        queryEmbedding = await embedText(embeddingInput);
      } catch (e) {
        console.error("Failed to embed repo fingerprint:", e);
        return {
          error: "Failed to analyze repository (embedding error)",
          repoName,
          fingerprint: built.fingerprint,
          recommendations: [],
        };
      }

      // Cache for next time
      await ctx.runMutation(internal.recommendations.setCachedFingerprint, {
        cacheKey,
        fingerprint: built.fingerprint,
        embedding: queryEmbedding,
      });
    }

    // Vector search over the skills index
    const results = await ctx.vectorSearch("skills", "by_embedding", {
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

    // Load summary metadata for each ranked skill. We use summaries
    // (~200 bytes/row) instead of full skill docs (~25 KB/row) because the
    // re-rank loop below only reads small fields, all of which are mirrored.
    const ids = results.map((r) => r._id as Id<"skills">);
    const entries = await ctx.runQuery(internal.skills.getSummariesByIds, {
      ids,
    });

    // Index summaries by their owning skill _id so we can preserve the
    // vector-search ranking when looping over results below.
    const summaryByDocId = new Map(
      entries.map((e) => [e.skillDocId, e.summary]),
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
      const summary = summaryByDocId.get(result._id as Id<"skills">);
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

    return {
      error: null,
      repoName,
      fingerprint,
      recommendations,
    };
  },
});
