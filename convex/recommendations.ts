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

export interface SkillRecommendation {
  source: string;
  skillId: string;
  name: string;
  description?: string;
  installs: number;
  score: number;
}

export interface AnalyzeRepoResult {
  error: string | null;
  repoName: string;
  fingerprint: RepoFingerprint | null;
  recommendations: SkillRecommendation[];
}

const SEARCH_LIMIT = 200;
const RESULT_LIMIT = 60;

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

    // Build a lowercase package set for substring matching
    const packageSet = fingerprint.packages.map((p) => p.toLowerCase());

    // Re-rank: base = vector similarity, +0.2 per package substring hit,
    // +0.1 * log10(installs + 1) as a popularity prior
    const ranked: SkillRecommendation[] = [];
    for (const result of results) {
      const summary = summaryByDocId.get(result._id as Id<"skills">);
      if (!summary) continue;

      const haystack = `${summary.name} ${summary.description ?? ""}`.toLowerCase();
      let packageBonus = 0;
      for (const pkg of packageSet) {
        if (pkg.length >= 3 && haystack.includes(pkg)) {
          packageBonus += 0.2;
          if (packageBonus >= 0.6) break; // Cap the bonus
        }
      }

      const popBonus = 0.1 * Math.log10(summary.installs + 1);

      ranked.push({
        source: summary.source,
        skillId: summary.skillId,
        name: summary.name,
        description: summary.description,
        installs: summary.installs,
        score: result._score + packageBonus + popBonus,
      });
    }

    ranked.sort((a, b) => b.score - a.score);

    return {
      error: null,
      repoName,
      fingerprint,
      recommendations: ranked.slice(0, RESULT_LIMIT),
    };
  },
});
