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
    // Discovered raw.githubusercontent.com URL for the SKILL.md file. Set by
    // discoverSkillMdUrls after walking the GitHub Tree (or empty string if
    // discovery failed). Used by fetchSkillContent for the actual download.
    // Empty for well-known sources (they go through v1 detail instead).
    skillMdUrl: v.optional(v.string()),
    contentFetchedAt: v.optional(v.number()),
    contentUpdatedAt: v.optional(v.number()),
    lastSynced: v.number(),
    // SHA-256 hex over the SKILL.md contents. Computed locally for raw GitHub
    // fetches (sha256Hex helper); copied directly from skills.sh's API for
    // well-known sources via v1 detail. Used for the hash-skip path: if the
    // newly-fetched hash matches stored, skip parse/embed/write entirely.
    syncHash: v.optional(v.string()),
    // GitHub-source skill needs SKILL.md path discovery via the Tree API.
    // Set true on first sync OR when content fetch fails twice (path likely
    // moved). Cleared by updateSkillMdUrl after discovery runs (success or
    // exhausted). Not used by well-known sources.
    needsDiscovery: v.optional(v.boolean()),
    // Skill needs its content downloaded. For GitHub: set after discovery
    // resolves a URL, drained by fetchSkillContent (raw fetch). For well-
    // known: set on first sync, drained by fetchSkillDetailBatch (v1 detail).
    needsContentFetch: v.optional(v.boolean()),
    // Increments on each consecutive content-fetch failure. After 2 fails,
    // markContentFetchFailed clears the URL and re-flags for discovery —
    // assumes the SKILL.md path moved upstream.
    contentFetchFailCount: v.optional(v.number()),
    // First content-fetch failure shows this badge in the UI ("Install may
    // fail"). Cleared on success or on 2nd failure (which moves to discovery).
    hasContentFetchError: v.optional(v.boolean()),
    // Increments each time discovery fails to find a SKILL.md. After
    // MAX_DISCOVERY_FAILURES (3), markStaleContent stops re-flagging the
    // skill — it's "exhausted." Reset to 0 when installs change (active
    // installs are a signal the repo is alive) or when discovery succeeds.
    discoveryFailCount: v.optional(v.number()),
    lastSeenInApi: v.optional(v.number()),
    isDelisted: v.optional(v.boolean()),
    // True when skills.sh has flagged this skill as a fork/copy of another.
    // Listing/search queries default-filter rows where this is true.
    isDuplicate: v.optional(v.boolean()),
    // Set when this skill belongs to the curated first-party set (the owner
    // string from /skills/curated, e.g. "vercel-labs"). Undefined for
    // non-curated skills. Drives the "Official" badge on cards.
    curatedOwner: v.optional(v.string()),
    // Trending leaderboard rank (1..N). Undefined when not on the trending
    // leaderboard. Refreshed by syncTrending cron.
    trendingRank: v.optional(v.number()),
    // Installs over the trending window (~24h) from the v1 "trending" view —
    // the metric that view is ranked by (NOT lifetime installs). Shown on the
    // Trending tab. Set and cleared in lockstep with trendingRank.
    trendingInstalls: v.optional(v.number()),
    // Hot view: rank (1..N) in the v1 "hot" leaderboard, which orders by
    // current-hour install volume. Undefined when not on the hot view.
    // Refreshed by syncHot. `hotChange` is the day-over-day delta for the
    // current hour — current-hour installs minus the same hour yesterday (per
    // the v1 hot view), so it can be negative — used for the momentum chip;
    // `hotInstallsYesterday` is that same-hour-yesterday count (so current-hour
    // volume = hotChange + hotInstallsYesterday). Not the ranking key — hotRank is.
    hotRank: v.optional(v.number()),
    hotChange: v.optional(v.number()),
    hotInstallsYesterday: v.optional(v.number()),
    // Worst audit verdict across all providers, denormalized so the cards
    // can render a badge without a join. Mirrors the value on `skillAudits`.
    // "pass" | "warn" | "fail" | "unknown". Undefined when audits never fetched.
    worstAuditStatus: v.optional(v.string()),
    worstAuditRiskLevel: v.optional(v.string()),
    // Audit-fetch pipeline state. Same shape as needsContentFetch — set true
    // on new/relisted skills and on rows whose auditFetchedAt is >7 days old
    // (re-flagged by markStaleContent). Drained by fetchAuditBatch.
    needsAudit: v.optional(v.boolean()),
    auditFetchedAt: v.optional(v.number()),
    // Embedding pipeline state. The actual vector lives in the
    // `skillEmbeddings` table — these fields are just bookkeeping for the
    // daily cron worker that populates it.
    needsEmbedding: v.optional(v.boolean()),
    // Set when the worker gives up on a skill (e.g. content too dense to fit
    // OpenAI's per-input token limit even after truncation). Non-destructive:
    // a future migration can re-flag these by reason and try a smarter
    // truncation/chunking strategy.
    embeddingSkipReason: v.optional(v.string()),
  })
    .index("by_source_skillId", ["source", "skillId"])
    .index("by_needsDiscovery", ["needsDiscovery"])
    .index("by_needsContentFetch", ["needsContentFetch"])
    .index("by_isDelisted", ["isDelisted"])
    .index("by_hasContentFetchError", ["hasContentFetchError"])
    .index("by_needsEmbedding", ["needsEmbedding"]),

  // Embedding vectors live in their own table to keep `skills` row reads
  // cheap. A skill row averages ~13 KB without the embedding vs ~25 KB with
  // it. The recommendation pipeline reaches summaries by `skillEmbeddingId`
  // (back-reference on skillSummaries), so vector search results don't need
  // to be translated through the heavy embedding rows themselves.
  //
  // The vector index lives here because Convex requires the vector index to
  // be on the table that owns the vector field.
  skillEmbeddings: defineTable({
    skillId: v.id("skills"),
    embedding: v.array(v.float64()),
    // Mirrored from the parent skill row so the vector index filter
    // (`q.eq("isDelisted", false)`) works without a join. Set explicitly to
    // false on insert and patched in lockstep with the skill row's flag.
    isDelisted: v.boolean(),
    embeddingMode: v.optional(v.string()),
  })
    .index("by_skillId", ["skillId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 512,
      filterFields: ["isDelisted"],
    }),

  skillSummaries: defineTable({
    source: v.string(),
    skillId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    installs: v.number(),
    // All-time install rank (1..N) captured from the order of the v1
    // "all-time" leaderboard during syncSkills (the API returns rows already
    // sorted by lifetime installs). Powers the skill page's "#142 · Top 3%"
    // stat. Lives only on the summary (not the heavy skills row) so the daily
    // rank refresh stays a cheap ~200B patch. The percentile denominator is
    // syncStats.totalSkills.
    installRank: v.optional(v.number()),
    syncHash: v.optional(v.string()),
    // Required: every summary is created from an API feed, so it always has a
    // "last seen" timestamp. Kept non-optional so the by_isDelisted_lastSeenInApi
    // range (staleness scans) has no undefined edge case. Backfilled before the
    // tightening (see skills.ts:backfillLastSeenInApi).
    lastSeenInApi: v.number(),
    // Required: defaulted to false on insert and set true on delist, never unset.
    // Non-optional so eq("isDelisted", false) index ranges are exhaustive (no
    // undefined rows to miss). Backfilled before tightening (backfillIsDelistedFalse).
    isDelisted: v.boolean(),
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
    // The actual embedding vector lives in the skillEmbeddings table.
    hasEmbedding: v.optional(v.boolean()),
    embeddingMode: v.optional(v.string()),
    embeddingSkipReason: v.optional(v.string()),
    needsEmbedding: v.optional(v.boolean()),
    // Back-reference to the skillEmbeddings row that holds this skill's
    // vector. Vector search returns Id<"skillEmbeddings"> values; the
    // recommendation pipeline maps those back to summaries via the
    // by_skillEmbeddingId index, avoiding any read of the heavy embedding
    // rows themselves. Optional because legacy summaries (from before the
    // table split) won't have it set until the backfill runs.
    skillEmbeddingId: v.optional(v.id("skillEmbeddings")),
    // Mirrored from skills row. Used for default-filtering forks/copies out
    // of listing and search queries.
    isDuplicate: v.optional(v.boolean()),
    // Mirrored from skills row. Drives the "Official" badge on every card.
    // The value is the curated owner slug (e.g. "vercel-labs"). Used as a
    // filter field on the search index for "Official only" search results.
    curatedOwner: v.optional(v.string()),
    // Mirrored from skills row. Powers the home page's Trending tab.
    trendingRank: v.optional(v.number()),
    // Mirrored from skills row. The v1 trending view's windowed install count
    // (~24h), shown on the Trending tab. Set/cleared with trendingRank.
    trendingInstalls: v.optional(v.number()),
    // Mirrored from skills row. Powers the home page's Hot rail and the
    // momentum chips on cards. hotRank is the ranking key (v1 hot order, by
    // current-hour install volume); hotChange/hotInstallsYesterday feed the chip.
    hotRank: v.optional(v.number()),
    hotChange: v.optional(v.number()),
    hotInstallsYesterday: v.optional(v.number()),
    // Mirrored from skills row. Drives the audit pill on cards (one read,
    // no join into skillAudits).
    worstAuditStatus: v.optional(v.string()),
    worstAuditRiskLevel: v.optional(v.string()),
    // Mirrored audit-fetch pipeline state.
    needsAudit: v.optional(v.boolean()),
    auditFetchedAt: v.optional(v.number()),
    // Duplicate/rename detection (Phase 2). Resolved by resolveRepoIdentities.
    // `githubRepoId` is GitHub's stable numeric repo id (survives renames), so
    // skills sharing it under different `source` names are aliases of one repo.
    // `repoLiveName` is the repo's current "owner/repo"; when it differs from
    // `source`, this row is a dead renamed alias. `copyCount` (aliases + forks)
    // is denormalized so list rows can show the "shared content" marker cheaply.
    githubRepoId: v.optional(v.number()),
    repoLiveName: v.optional(v.string()),
    copyCount: v.optional(v.number()),
    // Work-set flag for resolveRepoIdentities (mirrors the needs* pipeline
    // pattern). True on a GitHub row that hasn't been resolved to a repo id yet;
    // cleared when resolveRepoIdentities stamps it (real id or no-id sentinel).
    // Well-known sources are false (never resolved). Lets the resolve pass read
    // only the unresolved work-set via by_needsRepoResolution instead of scanning
    // the whole catalog.
    needsRepoResolution: v.optional(v.boolean()),
  })
    .index("by_source_skillId", ["source", "skillId"])
    // Alias grouping: same repo id + same slug, different source = renamed alias.
    .index("by_repo_skill", ["githubRepoId", "skillId"])
    // Fork grouping: same content hash across different repo ids = genuine fork.
    .index("by_syncHash", ["syncHash"])
    // Work-set for resolveRepoIdentities: q.eq("needsRepoResolution", true) reads
    // only unresolved GitHub rows (mirrors by_needsDiscovery et al.).
    .index("by_needsRepoResolution", ["needsRepoResolution"])
    .index("by_skillEmbeddingId", ["skillEmbeddingId"])
    .index("by_isDelisted", ["isDelisted"])
    // Powers the home page's default "popular skills" list. Queried with
    // q.eq("isDelisted", false).order("desc") to walk non-delisted rows from
    // highest installs to lowest. Every insert path sets isDelisted explicitly
    // to false, so undefined rows (should be none) are silently excluded.
    .index("by_isDelisted_installs", ["isDelisted", "installs"])
    // Powers the staleness scans (markDelistedSkills' 30-day delist, reconcile's
    // 23h refresh): q.eq("isDelisted", false).lt("lastSeenInApi", cutoff) reads
    // only the stale non-delisted rows instead of scanning the whole catalog and
    // filtering in memory. Both index fields are required (see schema), so the
    // range has no undefined edge cases.
    .index("by_isDelisted_lastSeenInApi", ["isDelisted", "lastSeenInApi"])
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
    // Trending tab on the home page: walk by trendingRank ascending, filtered
    // to non-delisted rows. Convex orders undefined < numbers, so queries MUST
    // use `q.eq("isDelisted", false).gt("trendingRank", 0)` to skip the
    // ~75k undefined rows that come first in the index walk.
    .index("by_isDelisted_trendingRank", ["isDelisted", "trendingRank"])
    // Hot rail: walk by hotRank ascending, filtered to non-delisted. hotRank
    // mirrors the v1 "hot" view's order (by current-hour install volume), so
    // the rail matches skills.sh. Queries MUST use
    // `q.eq("isDelisted", false).gt("hotRank", 0)` to skip the undefined
    // majority that sorts first in Convex's index order.
    .index("by_isDelisted_hotRank", ["isDelisted", "hotRank"])
    // Curated/official browsing — owner pages and the "Official only" filter.
    // Queries MUST use `q.gt("curatedOwner", "")` so the walk skips the
    // overwhelmingly-undefined rows at the start of the index.
    .index("by_curatedOwner", ["curatedOwner"])
    // Audit-fetch queue. Queries with `q.eq("needsAudit", true)` walk only
    // the skills that need their audit refreshed. Drained by fetchAuditBatch.
    .index("by_needsAudit", ["needsAudit"])
    // Full-text search index for the home page text search. Lives on
    // skillSummaries (~200 bytes/row) instead of skills (~25 KB/row) so each
    // page of search results is ~5 KB on the wire instead of ~625 KB.
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["isDelisted", "curatedOwner"],
    }),

  // One row per audited skill. Lives in its own table because audits change
  // independently of skill content (re-run periodically by skills.sh's audit
  // partners) and would bloat the skills row otherwise. The denormalized
  // `worstAuditStatus` field on `skills` and `skillSummaries` is what list
  // views read; this table is for the detail panel's per-provider breakdown.
  skillAudits: defineTable({
    skillDocId: v.id("skills"),
    source: v.string(),
    skillId: v.string(),
    audits: v.array(
      v.object({
        provider: v.string(),
        slug: v.string(),
        status: v.string(), // "pass" | "warn" | "fail"
        summary: v.string(),
        auditedAt: v.string(),
        riskLevel: v.optional(v.string()),
        categories: v.optional(v.array(v.string())),
      }),
    ),
    // Worst status across providers, computed at write time. Faster than
    // re-reducing on every read. "pass" if all pass; "warn" if any warn and
    // none fail; "fail" if any fail; "unknown" when no audits exist yet.
    worstStatus: v.string(),
    worstRiskLevel: v.optional(v.string()),
    fetchedAt: v.number(),
  })
    .index("by_skillDocId", ["skillDocId"])
    .index("by_source_skillId", ["source", "skillId"]),

  // Daily install snapshots — one row per skill per UTC day. skills.sh only
  // exposes a point-in-time install count (no history, no backfill), so this
  // table is how we build "installs over time": the daily syncSkills cron
  // appends today's count here (idempotent on skillDocId+day). The same rows
  // power the momentum stat (installs gained over the last 7/30 days =
  // latest.installs − the snapshot ~N days ago). A daily prune
  // (skills.pruneSnapshots) drops rows older than the retention window so the
  // table stays flat instead of growing forever; `by_day` lets it range-scan
  // the oldest rows across all skills.
  skillSnapshots: defineTable({
    skillDocId: v.id("skills"),
    day: v.string(), // "YYYY-MM-DD" in the app timezone (see appDay in skills.ts)
    installs: v.number(),
  })
    .index("by_skill_day", ["skillDocId", "day"])
    .index("by_day", ["day"]),

  // Denormalized owner-level rollup powering the /official directory page.
  // Computed by syncCurated from the same curated set that drives the
  // per-skill `curatedOwner` stamp. Reading this table is O(N owners),
  // ~hundreds of rows, instead of O(N curated skills) which today is ~4,400
  // and growing. The /official page is hour-cached at the Next.js layer,
  // but on cache miss the previous .collect() of every curated summary was
  // a ~4 KB-per-row read budget hit; this table caps that to ~50 bytes per
  // owner.
  curatedOwnerSummaries: defineTable({
    owner: v.string(),
    skillCount: v.number(),
    repoCount: v.number(),
  }),

  githubTreeCache: defineTable({
    repo: v.string(),
    branch: v.string(),
    etag: v.string(),
    dependencyFilePaths: v.array(v.string()),
    cachedAt: v.number(),
  }).index("by_repo", ["repo"]),

  // Per-repo cache for duplicate/rename detection (Phase 2). One row per
  // "owner/repo" we've resolved against the GitHub API: `repoId` is GitHub's
  // stable numeric id and `liveName` is the repo's current "owner/repo" (a 301
  // redirect means the queried name is a dead rename → liveName differs). Lets
  // resolveRepoIdentities resolve once per repo instead of once per skill.
  // `repoId`/`liveName` are null when the repo 404s (deleted/unreachable).
  githubRepoResolution: defineTable({
    repo: v.string(),
    repoId: v.union(v.number(), v.null()),
    liveName: v.union(v.string(), v.null()),
    resolvedAt: v.number(),
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
    // Cached final recommendations from the vector search + grouping pipeline.
    // Written in a second mutation after the vector search completes, so
    // repeat analyses of an unchanged repo skip the vector search entirely.
    recommendations: v.optional(
      v.array(
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
    ),
  }).index("by_cacheKey", ["cacheKey"]),

  bundles: defineTable({
    userId: v.id("users"),
    name: v.string(),
    urlId: v.string(),
    description: v.optional(v.string()),
    skills: v.array(
      v.object({
        source: v.string(),
        skillId: v.string(),
        addedAt: v.optional(v.number()),
      }),
    ),
    // IMPORTANT: this field is denormalized onto bundleStats.isPublic so the
    // by_public_starCount index can filter at the index level. Any code path
    // that mutates isPublic here MUST mirror the change to the corresponding
    // bundleStats row IF one exists (see updateBundleVisibility for the
    // pattern). When no stats row exists yet, downstream creation paths
    // (recordCopy, forkBundle, toggleStar) read the bundle's current isPublic
    // at insert time, so the invariant holds eventually.
    isPublic: v.boolean(),
    shareToken: v.optional(v.string()),
    forkedFrom: v.optional(v.id("bundles")),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    featuredAt: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_urlId", ["urlId"])
    .index("by_public_createdAt", ["isPublic", "createdAt"])
    .index("by_featured", ["featuredAt"])
    .index("by_public_featured", ["isPublic", "featuredAt"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["isPublic"],
    }),

  bundleStats: defineTable({
    bundleId: v.id("bundles"),
    // Denormalized from bundles.isPublic so the by_public_starCount index can
    // rank-and-filter at the index level. Required (not optional) so the
    // invariant is enforced by the schema — every row is guaranteed to have
    // isPublic set, and rows can never silently drop out of "Most starred".
    // All insert paths (recordCopy, forkBundle, toggleStar) read it from the
    // bundle; updateBundleVisibility mirrors flips onto any existing stats row.
    isPublic: v.boolean(),
    copyCount: v.number(),
    forkCount: v.number(),
    starCount: v.optional(v.number()),
    lastEventAt: v.number(),
  })
    .index("by_bundleId", ["bundleId"])
    .index("by_public_starCount", ["isPublic", "starCount"]),

  bundleStars: defineTable({
    bundleId: v.id("bundles"),
    userId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_user_bundle", ["userId", "bundleId"])
    .index("by_bundle", ["bundleId"]),

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
