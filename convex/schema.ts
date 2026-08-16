import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.optional(v.string()),
    image: v.optional(v.string()),
    externalId: v.string(),
  }).index("byExternalId", ["externalId"]),

  // Fixed-window per-user throttles for public actions that fan out to
  // external APIs (currently one key: the add-skill flow, whose preview can
  // cost dozens of GitHub calls). One row per (user, key); the enforcing
  // mutation resets `count` when the window has elapsed. See throttle.ts.
  userThrottles: defineTable({
    userId: v.id("users"),
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_user_key", ["userId", "key"]),

  skills: defineTable({
    source: v.string(),
    skillId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    content: v.optional(v.string()),
    installs: v.number(),
    leaderboard: v.string(),
    // True when this row was added straight from a GitHub repo and has no
    // skills.sh presence at all (absent from the leaderboard feed AND the
    // detail endpoint). Such a row has no upstream install count, and no
    // skills.sh feed will ever stamp its `lastSeenInApi` — so the content
    // pipeline stamps it instead (see updateDescription): GitHub still serving
    // SKILL.md is what proves it alive, and a dead repo stops the stamps and
    // lets the normal 30-day delist remove it. Cleared the moment any
    // skills.sh feed reports the skill ("adoption" in upsertSkillsBatch), at
    // which point ordinary lifecycle rules resume.
    isGitHubOnly: v.optional(v.boolean()),
    // The user who manually added this skill (public "add from GitHub" flow),
    // for attribution/takedown and to count a free user's GitHub-only-add quota.
    // Stamped once on insert and never rewritten (adoption/relist preserve it),
    // so the quota count stays stable. Undefined for skills that entered via
    // the normal sync pipeline. Quota only counts rows where the immutable
    // origin tag `leaderboard === "github"`; see convex/lib/plans.ts.
    addedBy: v.optional(v.id("users")),
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
    // GitHub's own blob SHA for this skill's SKILL.md, captured from the Tree
    // API during discovery. A DIFFERENT hash from `syncHash` above and not
    // comparable to it: this is git's object id, SHA-1 over
    // `"blob " + size + "\0" + contents`, whereas syncHash is our SHA-256 over
    // the raw text. Kept side by side on purpose, doing different jobs.
    //
    // Why it earns a field: `syncHash` can only be computed AFTER downloading
    // the file, so today every freshness check costs a full fetch of every
    // skill. GitHub hands this one back for free inside the recursive tree
    // response we already request, so a single conditional tree call per REPO
    // reveals which SKILL.md files moved without downloading any of them.
    //
    // The catalog is ~98% GitHub sources clustering at ~6.8 skills per repo
    // (sampled Aug 2026), so that turns a per-skill sweep into a per-repo one
    // and is what makes a daily content cadence cost less than today's weekly
    // fetch-everything cycle. Undefined for well-known sources, which have no
    // tree to walk and must keep paying the detail endpoint.
    //
    // Strictly a change DETECTOR. `syncHash` remains the content hash of
    // record; nothing should compare these two to each other.
    githubBlobSha: v.optional(v.string()),
    // GitHub-source skill needs SKILL.md path discovery via the Tree API.
    // Set true on first sync OR when content fetch fails twice (path likely
    // moved). Cleared by updateSkillMdUrls after discovery runs (success or
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
    // Exception: isGitHubOnly rows are exempt from the cap (no feed ever
    // changes their installs, so they'd freeze forever) — they keep retrying
    // on the rediscovery cadence; see markStaleContentBatch.
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
    // Counts a user's GitHub-only adds for the free-tier quota. Compound with
    // leaderboard so the count filters to `leaderboard === "github"` in-index.
    .index("by_addedBy_leaderboard", ["addedBy", "leaderboard"])
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

  // ROW SIZE — the authoritative figure, because several cost arguments across
  // the repo multiply by it and one of them got it badly wrong.
  //
  // **~1.3 KB per billed document** (measured against prod, Aug 2026: mean
  // 1,315 B over a 1,500-row sample; dev 1,164 B). Convex bills the WHOLE
  // document on every read — there is no projection pushdown, so a query that
  // returns three fields still pays for all of them, `description` (~500 B, the
  // bulk of the row) included.
  //
  // Comments throughout this repo said ~200 B until Aug 2026. That was probably
  // true at design time and drifted as `description` and the embedding/audit
  // mirrors landed. It is a 6x error, and it is how `/sitemap.xml` shipped a
  // ~21 MB-per-walk catalog read costed as a cheap one — 500 MB/day of Convex
  // database bandwidth before anyone noticed. Derived totals elsewhere
  // (embeddingCoverageStats, the bundle-page comparison below,
  // app/sitemap.ts's PAGE_SIZE headroom) are computed FROM this number; if you
  // re-measure it, grep for `1.3 KB` and recompute them rather than editing
  // this line alone.
  //
  // Re-measure with:
  //   npx convex run --prod --inline-query 'const rows = await ctx.db
  //     .query("skillSummaries").withIndex("by_isDelisted",
  //     q => q.eq("isDelisted", false)).take(1500);
  //     return Math.round(rows.reduce((n, r) =>
  //       n + JSON.stringify(r).length, 0) / rows.length);'
  //
  // Still far under the ~13-25 KB `skills` row, so the denormalization this
  // table exists for is as justified as it ever was — just by 10x, not 65x.
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
    // rank refresh stays a cheap ~1.3 KB patch. The percentile denominator is
    // syncStats.totalSkills.
    installRank: v.optional(v.number()),
    syncHash: v.optional(v.string()),
    // Mirrored from the skills row, following the same pattern as `syncHash`
    // above. See the field's full explanation on `skills`.
    //
    // The mirror is what makes the per-repo freshness sweep affordable: it can
    // compare a repo's tree against ~1.3 KB summary rows instead of paging the
    // ~13 KB skills documents, and 40 hex characters is a rounding error on a
    // row that already carries a 64-character syncHash.
    githubBlobSha: v.optional(v.string()),
    // Also mirrored from skills, and for the same reason: "did this change since
    // I last looked at my bundle?" is one timestamp comparison per skill, and
    // making it read a ~1.3 KB summary instead of a ~13 KB skills document is
    // the difference between a bundle page costing ~130 KB and ~1.3 MB of reads
    // (at 100 skills). A 10x saving, not the 65x the pre-Aug-2026 ~200 B figure
    // implied — still worth the mirror, and worth knowing it is 10x.
    //
    // Note the distinction from `contentFetchedAt` beside it: fetched is the last
    // time we CHECKED, updated is the last time the file actually MOVED. Unread
    // state has to key off the latter or every skill turns unread on every
    // refresh sweep.
    contentUpdatedAt: v.optional(v.number()),
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
    // table (~1.3 KB/row) instead of scanning full skill docs (~25 KB/row).
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
    // Mirrored from skills row. Read on the hot paths that only touch
    // summaries: reconcile skips these rows (the detail endpoint would 404
    // forever, and an unstamped row clogs the head of its oldest-first scan).
    // See the skills-table comment for the full lifecycle.
    isGitHubOnly: v.optional(v.boolean()),
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
    // GitHub-only rows, for the slug audit (githubOnlyAudit.ts). A small set —
    // the fallback path is quota-limited — but it has to be reachable without
    // scanning the catalog to find the handful. On summaries rather than
    // `skills` so the audit reads ~1.3 KB/row instead of a full ~13-25 KB
    // document whose `content` it doesn't want.
    .index("by_isGitHubOnly", ["isGitHubOnly"])
    .index("by_hasSkillMdUrl", ["hasSkillMdUrl"])
    .index("by_hasSkillMdUrl_discoveryFailCount", [
      "hasSkillMdUrl",
      "discoveryFailCount",
    ])
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
    .index("by_needsAudit", ["needsAudit"]),
  // (Removed: the `search_name` full-text index. It backed the old Convex
  // `searchSkills` home query, now replaced by browser-direct Typesense —
  // see docs/search-overhaul.md. With no consumer it was pure write
  // amplification on this ~75k-row table, which the sync rewrites daily.)

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
    // The verdict this row held before the most recent change to it, plus when
    // that change landed. `writeAuditResult` has always computed
    // `worstStatusChanged` and then patched straight over the old value, so a
    // regression was detected and immediately forgotten.
    //
    // A single previous value rather than a history table, matching the same
    // call this file's neighbour makes for content: an alert needs "pass → fail",
    // not the full sequence of verdicts. Kept here rather than in a separate
    // table because it is one field on a row that is already being written.
    //
    // This is the highest-severity monitoring signal there is: a skill that
    // passed its audits when someone installed it and fails them now. Nothing
    // re-checks after install, and skills execute inside the user's agent.
    previousWorstStatus: v.optional(v.string()),
    previousWorstRiskLevel: v.optional(v.string()),
    worstStatusChangedAt: v.optional(v.number()),
  })
    .index("by_skillDocId", ["skillDocId"])
    .index("by_source_skillId", ["source", "skillId"])
    // Lets the notifier sweep recent verdict movements without scanning the
    // whole table. Sparse on purpose: only rows that have ever changed verdict
    // carry `worstStatusChangedAt`, and a catalog where most skills pass and
    // keep passing means most rows never enter this index at all.
    .index("by_worstStatusChangedAt", ["worstStatusChangedAt"]),

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

  // Version archive for skill content. One row per DETECTED CHANGE to a skill's
  // raw SKILL.md, written by both content-write paths in skills.ts
  // (`updateDescription` and `updateSkillFromDetail`) via `recordSkillVersion`.
  //
  // The raw file lives in Convex FILE storage rather than inline. Bodies run
  // ~10-25 KB, and file storage is a separate and much cheaper allowance
  // (100 GB included, $0.03/GB overage) than document storage ($0.20/GB), which
  // the ~16.8k-row `skills` table already draws on. Measured against prod
  // (Aug 2026): ~27.5% of the catalog changes per month, and a stored blob
  // averages ~15 KB (the midpoint of the 10-25 KB range above skews high —
  // most SKILL.mds sit in the lower half).
  //
  // Those two are the MEASURED quantities; everything else here is derived from
  // them and the LIVE row count (~16.0k — delisted rows are never content-
  // refetched, so they cannot produce blobs), and so moves whenever the catalog
  // does: ~16.0k x 27.5% = ~4,400 changes/month x ~15 KB = ~66 MB/month.
  // Originally stated as ~2,600 and ~39 MB off a 9.5k row count that was
  // already stale; recompute rather than scale.
  //
  // `skillSnapshots` above already writes ~285k rows a month, so this is still
  // a rounding error next to what the pipeline does daily.
  //
  // NO PATCH/DIFF IS STORED, deliberately. Because every version's full text is
  // retained, any two versions can be diffed on demand — the client renderer
  // does exactly that — and patches can be backfilled from the blobs at any
  // point if adjacent-diff egress ever justifies the optimization. Storing them
  // up front would cost a storage read plus a diff on every single write, for a
  // benefit that is speculative until there is traffic. Deferring is free here
  // in a way it usually isn't, precisely because the source material is kept.
  skillVersions: defineTable({
    skillDocId: v.id("skills"),
    // Denormalized so a timeline or cross-skill feed reads without joining back
    // to `skills`, whose rows are ~13 KB.
    source: v.string(),
    skillId: v.string(),
    changedAt: v.number(),
    // SHA-256 of the raw file — same construction as `skills.syncHash`, so the
    // two are directly comparable.
    syncHash: v.string(),
    previousSyncHash: v.optional(v.string()),
    // Raw SKILL.md INCLUDING frontmatter. `skills.content` is the body with
    // frontmatter stripped (see extractBodyContent), so a frontmatter-only edit
    // — a `version:` bump being the common case — is invisible there and
    // visible here. Diffing the stripped body would silently drop those.
    rawStorageId: v.id("_storage"),
    rawBytes: v.number(),
    // Parsed from frontmatter where the author declares one. "4.0.3 → 4.0.4" is
    // a far more legible timeline entry than a hash delta, and a major bump is a
    // genuine severity signal. Absent for the many skills that declare no
    // version, so it enhances the timeline rather than carrying it.
    frontmatterVersion: v.optional(v.string()),
    previousFrontmatterVersion: v.optional(v.string()),
    // Descriptions are kept inline, in full, on purpose. A description change is
    // the high-severity content event: the description is what decides WHEN an
    // agent invokes a skill, so an upstream edit changes the user's agent
    // behavior without touching their code. Holding it outside the blob means
    // alerts and timelines render it without fetching any file.
    descriptionBefore: v.optional(v.string()),
    descriptionAfter: v.optional(v.string()),
    descriptionChanged: v.boolean(),
    contentChanged: v.boolean(),
    // True when this row is a STARTING POINT rather than an event: the first
    // copy taken of a file we had no prior record of. Written by the one-time
    // backfill, and by a skill's genuine first content fetch.
    //
    // NOT simply "the first row for this skill". A well-known skill missed by
    // the GitHub-only backfill has an empty archive but a long-standing
    // `syncHash`, so its first row is a real change and must report as one. See
    // `recordSkillVersion` for how the two are told apart.
    //
    // A baseline has no stored predecessor blob, so no body DIFF is possible
    // against it — but that is not the same as "do not notify", and it is no
    // longer coextensive with this flag. `descriptionBefore` is read off the
    // live skills row rather than the blob, so description-level reporting
    // works on any first row, baseline or not.
    isBaseline: v.boolean(),
    // No `suppressed` flag here on purpose. Mass-change suppression is computed
    // at READ time (`isCatalogWideChangeEvent` in skillVersions.ts), because a
    // writer cannot know it is the 3rd of 3,000. See that file for the
    // threshold and the precedent that makes the breaker necessary.
  })
    .index("by_skill_changedAt", ["skillDocId", "changedAt"])
    // Chronological feed across all skills.
    .index("by_changedAt", ["changedAt"])
    // Mass-change breaker only. It must count REAL changes in a window, and
    // baselines outnumber them enormously while the archive backfills (459 to 0
    // on the day this index was added). Filtering after a capped read spends the
    // whole budget on baselines and reports zero, which fails silent — the one
    // failure mode a circuit breaker may not have. Indexing the flag moves the
    // filter into the seek, so the read is bounded by real changes alone.
    .index("by_isBaseline_changedAt", ["isBaseline", "changedAt"]),

  // Per-repo ETag for the daily freshness sweep (convex/freshness.ts).
  //
  // Deliberately NOT reusing `githubTreeCache` below. That row is keyed by the
  // same `owner/repo` string, but its `dependencyFilePaths` field carries a
  // prefix-encoded scan owned by `recommendations.ts`, and its ETag belongs to
  // whichever branch that scan was taken from. Two writers with different
  // payloads on one row is how a cache starts returning one consumer's data to
  // another; a second small table is cheaper than that class of bug.
  //
  // One row per GitHub repo (~1,400 at current catalog size), so this stays
  // small no matter how many skills each repo holds.
  repoSweepState: defineTable({
    repo: v.string(),
    branch: v.string(),
    // Absent until the first successful tree fetch. Its whole purpose is the
    // conditional request: an unchanged repo answers 304, which costs no
    // response body and does not count against GitHub's rate limit.
    etag: v.optional(v.string()),
    sweptAt: v.number(),
  }).index("by_repo", ["repo"]),

  /**
   * One row per freshness-sweep WALK, so a run that stops halfway is evident.
   *
   * The sweep self-chains across ~40 invocations. An action that throws is not
   * retried and an action interrupted mid-flight simply stops, so a chain can
   * end early with no error, no log line, and no retry. On 2026-08-09 one did:
   * 146 of 1,624 repos, discovered only because someone happened to read
   * `sweepHealth`, and by then the logs had been evicted and the per-repo
   * timestamps had been overwritten by the manual re-run. The cause is still
   * unknown, which is the actual problem this table solves.
   *
   * `finishedAt` unset on the newest row means the last walk never completed.
   * That is the signal — `sweepHealth` reports it, so the next reading says so
   * outright instead of leaving it to be inferred from a repo count.
   */
  sweepRuns: defineTable({
    startedAt: v.number(),
    /** Unset while running, and permanently unset if the chain died. */
    finishedAt: v.optional(v.number()),
    reposSwept: v.number(),
    reposSkipped: v.number(),
    skillsFlagged: v.number(),
    /** "complete" | "rate-limited". Absent means it never reached an ending. */
    outcome: v.optional(v.string()),
  }).index("by_startedAt", ["startedAt"]),

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
              curatedOwner: v.optional(v.string()),
              worstAuditStatus: v.optional(v.string()),
              worstAuditRiskLevel: v.optional(v.string()),
            }),
          ),
          // Lexical package overlaps surfaced as the row's match reason.
          matchedPackages: v.optional(v.array(v.string())),
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
    // Can anyone but the owner open this bundle's one link?
    //
    // It used to mean "listed in the public directory", and a separate
    // `shareToken` gave closed bundles a second, unguessable URL. Two links to
    // one thing with different rules is a model the owner has to hold in their
    // head, and with the directory gone the two states had collapsed into the
    // same thing anyway. Now: one link (`urlId`), one switch (this).
    //
    // Off by default, and `migrateOneLinkModel` closed the rows created under
    // the old public-by-default rule.
    isPublic: v.boolean(),
    forkedFrom: v.optional(v.id("bundles")),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    // When the OWNER last opened this bundle. Stamped by `markBundleViewed`,
    // which refuses non-owners — a share-link visitor reading someone else's
    // bundle must not mark it read for them.
    //
    // This is the whole "since you last looked" mechanism, chosen over email
    // notification. It buys most of the felt value of alerts (the bundle can say
    // "3 skills changed since your last visit" and surface those first) for one
    // optional number, with no delivery, unsubscribe, digest-tuning, or
    // alert-fatigue problem to solve.
    //
    // Per bundle rather than per user on purpose: opening one watchlist must not
    // silently mark every other one read. The dashboard's cross-bundle count is
    // derived by taking the union across bundles, which stays correct without a
    // second global timestamp to keep in sync.
    //
    // Undefined means never opened. Do NOT treat that as "everything is unread":
    // the per-skill baseline is `max(lastViewedAt ?? 0, entry.addedAt)`, because
    // a skill added yesterday should not present six months of prior history as
    // new to this reader.
    lastViewedAt: v.optional(v.number()),
  })
    // Only the two access paths remain: a user's own bundles, and one bundle by
    // its link. `by_public_createdAt`, `by_featured`, `by_public_featured` and
    // the `search_name` search index all existed to browse and rank OTHER
    // people's bundles, which is no longer a thing you can do here.
    .index("by_userId", ["userId"])
    .index("by_urlId", ["urlId"]),

  // REMOVED: `bundleStats` (copy/fork/star counters) and `bundleStars`.
  //
  // They existed to rank a public directory of community bundles, and that
  // directory is gone. A social signal nobody is generating reads as an
  // abandoned product, not a quiet one, so the counters went with it rather
  // than sitting at zero. Bundles are private working sets now; what matters
  // about one is the state of the skills in it, not how many strangers copied
  // it.

  // Single-row run lock for the Typesense catalog sync (typesense.syncCatalog).
  // Two overlapping mark-and-sweep walks can cross-stamp documents and sweep
  // live docs out of the search index (e.g. a manual run overlapping the daily
  // chained run) — the lock makes a second start a loud no-op instead.
  // `completedAt` unset = a run is in progress (or crashed; stale locks past
  // the TTL are stealable).
  typesenseSyncLock: defineTable({
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  }),

  // Single-row cache for the Vercel OIDC token skills.sh wants (see
  // convex/skillsAuth.ts). Convex can't mint one itself, so it pulls a fresh
  // token from the site's /api/skills-token relay hourly (the runtime token
  // lives 2h) and parks it here for the upstream calls in between.
  //
  // `token` is a bearer credential: it must never be returned from a public
  // query or logged.
  //
  // The row doubles as the refresh-health record, which is what makes a fall
  // back to the legacy API key visible on /dev instead of silent. Hence the
  // token fields are OPTIONAL: "we have failure history but no token" is a real
  // state (a relay that has never once succeeded), and it needs to be
  // expressible directly rather than encoded as an empty string with a zero
  // expiry that every reader has to remember to distrust.
  //
  // Two independent failure modes, and the panel needs both. `lastRefreshError`
  // covers the relay refusing to hand us a token; `lastOidcRejected*` covers
  // skills.sh refusing to accept one we did get, which is the more likely of
  // the two and is invisible from the token's expiry alone.
  skillsAuthToken: defineTable({
    token: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    refreshedAt: v.optional(v.number()),
    lastRefreshError: v.optional(v.string()),
    lastRefreshErrorAt: v.optional(v.number()),
    lastOidcRejectedAt: v.optional(v.number()),
    lastOidcRejectedStatus: v.optional(v.number()),
  }),

  syncStats: defineTable({
    totalSkills: v.number(),
    contentFetchErrors: v.number(),
    pendingContentFetch: v.number(),
    pendingDiscovery: v.number(),
    noSkillMdUrl: v.number(),
    noUrlExhausted: v.number(),
    delisted: v.number(),
    // Healthy (repo still serves SKILL.md) but unseen by any sync for >7 days =
    // dropped from skills.sh while the repo stays alive. ~0 in steady state; a
    // non-zero value is the detection signal for the deferred fast-delete
    // ("Fix 2", see docs/skill-lifecycle.md). Optional: backfilled on next recalc.
    deadButInstallable: v.optional(v.number()),
    recalculatedAt: v.number(),
  }),
});
