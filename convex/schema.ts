import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.optional(v.string()),
    image: v.optional(v.string()),
    externalId: v.string(),
  }).index("byExternalId", ["externalId"]),

  skills: defineTable({
    source: v.string(),
    skillId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    content: v.optional(v.string()),
    installs: v.number(),
    leaderboard: v.string(),
    skillMdUrl: v.optional(v.string()),
    contentFetchedAt: v.optional(v.number()),
    contentUpdatedAt: v.optional(v.number()),
    lastSynced: v.number(),
    syncHash: v.optional(v.string()),
    needsDiscovery: v.optional(v.boolean()),
    needsContentFetch: v.optional(v.boolean()),
    contentFetchFailCount: v.optional(v.number()),
    hasContentFetchError: v.optional(v.boolean()),
    lastSeenInApi: v.optional(v.number()),
    isDelisted: v.optional(v.boolean()),
    discoveryFailCount: v.optional(v.number()),
    // Embedding fields for semantic search
    embedding: v.optional(v.array(v.float64())),
    embeddedAt: v.optional(v.number()),
    embeddingVersion: v.optional(v.number()),
    needsEmbedding: v.optional(v.boolean()),
    // How the embedding input was constructed:
    //   "full"    — name + description + content (the happy path)
    //   "minimal" — name + description only (fallback because content tokenized
    //               too densely to fit OpenAI's per-input limit even after
    //               truncation)
    // Lets us measure what fraction of skills are using degraded embeddings.
    // If "minimal" grows past a few %, that's a signal to improve truncation
    // strategy (chunking, tiktoken, smarter content extraction, etc).
    embeddingMode: v.optional(v.string()),
    // Set when the worker gives up on a skill (e.g. content too dense to fit
    // OpenAI's per-input token limit even after truncation). Non-destructive:
    // a future migration can re-flag these by reason and try a smarter
    // truncation/chunking strategy.
    embeddingSkipReason: v.optional(v.string()),
  })
    .index("by_leaderboard", ["leaderboard"])
    .index("by_source_skillId", ["source", "skillId"])
    .index("by_needsDiscovery", ["needsDiscovery"])
    .index("by_needsContentFetch", ["needsContentFetch"])
    .index("by_isDelisted", ["isDelisted"])
    .index("by_hasContentFetchError", ["hasContentFetchError"])
    .index("by_leaderboard_active", ["leaderboard", "isDelisted"])
    .index("by_needsEmbedding", ["needsEmbedding"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["isDelisted"],
    }),

  skillSummaries: defineTable({
    source: v.string(),
    skillId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    installs: v.number(),
    syncHash: v.optional(v.string()),
    lastSeenInApi: v.optional(v.number()),
    isDelisted: v.optional(v.boolean()),
    // Denormalized from skills table to avoid reading full 30KB+ skill docs.
    // Required: every summary is created alongside its skill row.
    skillDocId: v.id("skills"),
    contentFetchedAt: v.optional(v.number()),
    skillMdUrl: v.optional(v.string()),
    needsContentFetch: v.optional(v.boolean()),
    needsDiscovery: v.optional(v.boolean()),
    hasContentFetchError: v.optional(v.boolean()),
    hasSkillMdUrl: v.optional(v.boolean()),
    discoveryFailCount: v.optional(v.number()),
    // Embedding state mirrored from the skills table so coverage stats and
    // unembeddable-skill listings can be computed from this small summary
    // table (~200 bytes/row) instead of scanning full skill docs (~25 KB/row).
    // The actual embedding vector itself stays only on the skills table.
    hasEmbedding: v.optional(v.boolean()),
    embeddingMode: v.optional(v.string()),
    embeddingSkipReason: v.optional(v.string()),
    needsEmbedding: v.optional(v.boolean()),
  })
    .index("by_source_skillId", ["source", "skillId"])
    .index("by_isDelisted", ["isDelisted"])
    .index("by_needsContentFetch", ["needsContentFetch"])
    .index("by_needsDiscovery", ["needsDiscovery"])
    .index("by_hasContentFetchError", ["hasContentFetchError"])
    .index("by_hasSkillMdUrl", ["hasSkillMdUrl"])
    // Lets us look up summaries by their owning skill row's _id. Used by
    // analyzeRepo to convert vector-search results (which return skill IDs)
    // into cheap summary lookups instead of reading full skill docs.
    .index("by_skillDocId", ["skillDocId"])
    // Selective indexes for the dev dashboard's embedding monitoring panel.
    // Both columns are mostly undefined in steady state, so equality queries
    // through these indexes touch only the few rows that match.
    .index("by_embeddingSkipReason", ["embeddingSkipReason"])
    .index("by_embeddingMode", ["embeddingMode"])
    // Full-text search index for the home page text search. Lives on
    // skillSummaries (~200 bytes/row) instead of skills (~25 KB/row) so each
    // page of search results is ~5 KB on the wire instead of ~625 KB.
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["isDelisted"],
    }),

  githubTreeCache: defineTable({
    repo: v.string(),
    branch: v.string(),
    etag: v.string(),
    dependencyFilePaths: v.array(v.string()),
    cachedAt: v.number(),
  }).index("by_repo", ["repo"]),

  // Cache of GitHub repo fingerprints + their embeddings, keyed by owner/repo
  // (with optional commit SHA suffix). Lets repeat analyses skip re-fetching
  // repo metadata and re-embedding the fingerprint.
  repoFingerprintCache: defineTable({
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
    cachedAt: v.number(),
  }).index("by_cacheKey", ["cacheKey"]),

  bundles: defineTable({
    userId: v.id("users"),
    name: v.string(),
    urlId: v.string(),
    skills: v.array(
      v.object({
        source: v.string(),
        skillId: v.string(),
        addedAt: v.optional(v.number()),
      }),
    ),
    isPublic: v.boolean(),
    shareToken: v.optional(v.string()),
    forkedFrom: v.optional(v.id("bundles")),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_urlId", ["urlId"])
    .index("by_public_createdAt", ["isPublic", "createdAt"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["isPublic"],
    }),

  bundleEvents: defineTable({
    bundleId: v.id("bundles"),
    eventType: v.union(
      v.literal("view"),
      v.literal("copy"),
      v.literal("fork"),
    ),
    userId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_bundle_createdAt", ["bundleId", "createdAt"])
    .index("by_type_createdAt", ["eventType", "createdAt"]),

  bundleStats: defineTable({
    bundleId: v.id("bundles"),
    viewCount: v.number(),
    copyCount: v.number(),
    forkCount: v.number(),
    recentCopyCount: v.number(),
    lastEventAt: v.number(),
  })
    .index("by_bundleId", ["bundleId"])
    .index("by_recentCopies", ["recentCopyCount"]),

  syncStats: defineTable({
    totalSkills: v.number(),
    contentFetchErrors: v.number(),
    pendingContentFetch: v.number(),
    pendingDiscovery: v.number(),
    noSkillMdUrl: v.number(),
    noUrlExhausted: v.number(),
    delisted: v.number(),
    recalculatedAt: v.number(),
  }),
});
