import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import {
  resolveDefaultBranch,
  fetchRepoTree,
  NOT_MODIFIED,
} from "./lib/github";
import {
  embedTexts,
  truncateForEmbedding,
  EmbeddingInputTooLongError,
} from "./lib/embeddings";
import { MAX_DISCOVERY_FAILURES } from "./devStats";

// ---------------------------------------------------------------------------
// Sync actions
// ---------------------------------------------------------------------------

const BATCH_SIZE = 20;
const MIN_INSTALLS = 50;

export const syncSkills = internalAction({
  args: {},
  handler: async (ctx) => {
    let page = 0;
    let hasMore = true;
    let totalSynced = 0;

    while (hasMore) {
      const url = `https://skills.sh/api/skills/all-time/${page}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`Failed to fetch ${url}: ${res.status}`);
        break;
      }

      const data = (await res.json()) as {
        skills: Array<{
          source: string;
          skillId: string;
          name: string;
          installs: number;
        }>;
        hasMore: boolean;
        total: number;
        page: number;
      };

      // Pick only the fields we need — some leaderboards return extra fields
      // Filter out skills below the minimum install threshold
      const normalized = data.skills
        .filter((s) => s.installs >= MIN_INSTALLS)
        .map((s) => ({
          source: s.source,
          skillId: s.skillId,
          name: s.name,
          installs: s.installs,
        }));

      // If no skills passed the threshold, we've hit the long tail — stop
      if (normalized.length === 0) {
        console.log(`Stopping sync: installs dropped below ${MIN_INSTALLS}`);
        break;
      }

      // Process in batches to stay within Convex mutation limits
      for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
        const batch = normalized.slice(i, i + BATCH_SIZE);
        await ctx.runMutation(internal.skills.upsertSkillsBatch, {
          skills: batch,
          leaderboard: "all-time",
        });
      }

      totalSynced += normalized.length;
      hasMore = data.hasMore;
      page++;
    }

    console.log(`Synced ${totalSynced} skills (min ${MIN_INSTALLS} installs)`);

    // Mark skills not seen in the API for 30+ days as delisted
    await ctx.scheduler.runAfter(5_000, internal.skills.markDelistedSkills, {});

    // markStaleContent → backfillDiscoverUrls → backfillFetchContent → recalculateStats
    await ctx.scheduler.runAfter(8_000, internal.skills.markStaleContent, {});
  },
});

async function upsertSkillSummary(
  ctx: MutationCtx,
  fields: {
    source: string;
    skillId: string;
    name: string;
    description?: string;
    installs: number;
    syncHash?: string;
    lastSeenInApi?: number;
    isDelisted?: boolean;
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
      ...(fields.syncHash !== undefined && { syncHash: fields.syncHash }),
      ...(fields.lastSeenInApi !== undefined && {
        lastSeenInApi: fields.lastSeenInApi,
      }),
      ...(fields.isDelisted !== undefined && { isDelisted: fields.isDelisted }),
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
      syncHash: fields.syncHash,
      lastSeenInApi: fields.lastSeenInApi,
      // Default to false on insert so the by_isDelisted index is selective
      // and indexed equality filters (`q.eq("isDelisted", false)`) match.
      isDelisted: fields.isDelisted ?? false,
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
    });
  }
}

/** Simple hash of the fields that come from the API to detect structural changes.
 *  Excludes `installs` — install count changes are handled via a lightweight
 *  patch path to avoid expensive full-doc reads and junction table rewrites.
 */
function computeSyncHash(name: string, leaderboard: string) {
  return `${name}|${leaderboard}`;
}

export const upsertSkillsBatch = internalMutation({
  args: {
    skills: v.array(
      v.object({
        source: v.string(),
        skillId: v.string(),
        name: v.string(),
        installs: v.number(),
      }),
    ),
    leaderboard: v.string(),
  },
  handler: async (ctx, { skills, leaderboard }) => {
    const now = Date.now();

    for (const skill of skills) {
      const newHash = computeSyncHash(skill.name, leaderboard);

      // Phase 1: Lightweight check via summary (~200 bytes vs ~30KB full doc)
      const summary = await ctx.db
        .query("skillSummaries")
        .withIndex("by_source_skillId", (q) =>
          q.eq("source", skill.source).eq("skillId", skill.skillId),
        )
        .unique();

      // Hash unchanged — handle with lightweight patches, skip full skill doc read
      if (summary && summary.syncHash === newHash) {
        // Relist if skill reappears (rare — requires full doc read)
        if (summary.isDelisted) {
          const existing = await ctx.db
            .query("skills")
            .withIndex("by_source_skillId", (q) =>
              q.eq("source", skill.source).eq("skillId", skill.skillId),
            )
            .unique();
          if (existing) {
            await ctx.db.patch(existing._id, {
              isDelisted: false,
              needsEmbedding: true,
            });
            await ctx.db.patch(summary._id, {
              lastSeenInApi: now,
              isDelisted: false,
              installs: skill.installs,
              needsEmbedding: true,
              hasEmbedding: false,
              skillEmbeddingId: undefined,
            });
          }
        } else if (summary.installs !== skill.installs) {
          // Installs changed but nothing structural — lightweight patch
          // Patch skill doc by ID (no full doc read needed)
          if (summary.skillDocId) {
            await ctx.db.patch(summary.skillDocId, {
              installs: skill.installs,
              lastSeenInApi: now,
              // Reset discovery counter — active installs mean repo is worth re-checking
              discoveryFailCount: 0,
            });
          }
          await ctx.db.patch(summary._id, {
            lastSeenInApi: now,
            installs: skill.installs,
            discoveryFailCount: 0,
          });
        } else {
          await ctx.db.patch(summary._id, { lastSeenInApi: now });
        }
        continue;
      }

      // Phase 2: Hash changed or new skill — read full doc
      const existing = await ctx.db
        .query("skills")
        .withIndex("by_source_skillId", (q) =>
          q.eq("source", skill.source).eq("skillId", skill.skillId),
        )
        .unique();

      let skillDocId;

      if (existing) {
        skillDocId = existing._id;

        await ctx.db.patch(existing._id, {
          installs: skill.installs,
          leaderboard,
          lastSynced: now,
          syncHash: newHash,
          lastSeenInApi: now,
          // Relisting: the embedding row was hard-deleted on delist, so flag
          // the skill for re-embedding. Without this the worker never picks
          // it up (needsEmbedding stays whatever it was before delist).
          ...(existing.isDelisted && { isDelisted: false, needsEmbedding: true }),
        });
      } else {
        skillDocId = await ctx.db.insert("skills", {
          source: skill.source,
          skillId: skill.skillId,
          name: skill.name,
          installs: skill.installs,
          leaderboard,
          lastSynced: now,
          syncHash: newHash,
          needsDiscovery: true,
          needsContentFetch: false,
          lastSeenInApi: now,
          // Set explicitly so indexed filters like `q.eq("isDelisted", false)`
          // match new rows. Convex's indexed equality treats `undefined` and
          // `false` as distinct values, so leaving this unset would cause
          // the row to be invisible to vector/search index filters.
          isDelisted: false,
          // New skills need an embedding once their content lands
          needsEmbedding: true,
        });
      }

      // Update summary with new hash and data (include skillDocId + denormalized fields)
      await upsertSkillSummary(ctx, {
        source: skill.source,
        skillId: skill.skillId,
        name: skill.name,
        description: existing?.description,
        installs: skill.installs,
        syncHash: newHash,
        lastSeenInApi: now,
        skillDocId,
        ...(existing && {
          contentFetchedAt: existing.contentFetchedAt,
          skillMdUrl: existing.skillMdUrl,
          needsContentFetch: existing.needsContentFetch,
          needsDiscovery: existing.needsDiscovery,
        }),
        ...(!existing && {
          needsDiscovery: true,
          needsContentFetch: false,
          // Mirror needsEmbedding from the new skill row so coverage stats
          // computed from summaries stay accurate.
          needsEmbedding: true,
        }),
        ...(existing?.isDelisted && {
          isDelisted: false,
          needsEmbedding: true,
          hasEmbedding: false,
        }),
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Content helpers
// ---------------------------------------------------------------------------

function extractFrontmatterDescription(content: string): string | null {
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

export const listSourcesNeedingDiscovery = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const paginationOpts = cursor
      ? { numItems: 500, cursor }
      : { numItems: 500, cursor: null };
    // Scan summaries (~200 bytes) instead of skills (~30KB) to reduce bandwidth
    const result = await ctx.db
      .query("skillSummaries")
      .withIndex("by_needsDiscovery", (q) => q.eq("needsDiscovery", true))
      .paginate(paginationOpts);

    // Group skills by source repo
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

/** Check if a source looks like a GitHub org/repo (e.g. "resend/resend-skills")
 *  vs a domain (e.g. "smithery.ai", "bun.sh", "react-aria.adobe.com") */
function isGitHubSource(source: string): boolean {
  const parts = source.split("/");
  // Must be "owner/repo" format. Dots in repo name are fine (e.g. vercel/next.js)
  // but dots in the org name indicate a domain (e.g. smithery.ai → not GitHub)
  return parts.length === 2 && !parts[0].includes(".");
}

export const discoverSkillMdUrls = internalAction({
  args: {
    source: v.string(),
    skills: v.array(v.object({ docId: v.string(), skillId: v.string() })),
  },
  handler: async (ctx, { source, skills }) => {
    // Skip non-GitHub sources (domains like smithery.ai, bun.sh, etc.)
    if (!isGitHubSource(source)) {
      for (const s of skills) {
        await ctx.runMutation(internal.skills.updateSkillMdUrl, {
          docId: s.docId as ReturnType<typeof v.id<"skills">>["type"],
          skillMdUrl: "",
        });
      }
      return;
    }

    // source is "owner/repo" format
    const [owner, repo] = source.split("/");
    const defaultBranch = await resolveDefaultBranch(owner, repo);

    const branches = [defaultBranch];
    if (!branches.includes("main")) branches.push("main");
    if (!branches.includes("master")) branches.push("master");

    const treeResult = await fetchRepoTree(owner, repo, branches);
    // Skills sync never passes an etag so NOT_MODIFIED can't occur,
    // but TypeScript requires handling it. Treat as a miss.
    const tree = treeResult === NOT_MODIFIED ? null : treeResult;
    const resolvedBranch = tree?.branch ?? defaultBranch;

    // Fallback: if tree fetch failed or repo too large, try direct path guessing per skill
    if (!tree) {
      console.log(
        `Could not fetch tree for ${source} — trying direct path guessing`,
      );
      const matchedSkillIds = new Set<string>();
      for (const s of skills) {
        // Try common SKILL.md path patterns
        const paths = [
          `skills/${s.skillId}/SKILL.md`,
          `.claude/skills/${s.skillId}/SKILL.md`,
          `SKILL.md`,
        ];
        for (const path of paths) {
          const rawUrl = `https://raw.githubusercontent.com/${source}/${resolvedBranch}/${path}`;
          try {
            const res = await fetch(rawUrl, { method: "HEAD" });
            if (res.ok) {
              await ctx.runMutation(internal.skills.updateSkillMdUrl, {
                docId: s.docId as ReturnType<typeof v.id<"skills">>["type"],
                skillMdUrl: rawUrl,
              });
              matchedSkillIds.add(s.skillId);
              break;
            }
          } catch {
            continue;
          }
        }
      }
      // Mark remaining as not found
      const unmatched = skills.filter((s) => !matchedSkillIds.has(s.skillId));
      for (const s of unmatched) {
        await ctx.runMutation(internal.skills.updateSkillMdUrl, {
          docId: s.docId as ReturnType<typeof v.id<"skills">>["type"],
          skillMdUrl: "",
        });
      }
      console.log(
        `${source} (fallback): ${matchedSkillIds.size} matched, ${unmatched.length} not found`,
      );
      for (const s of unmatched) {
        console.log(`  ✗ ${s.skillId}`);
      }
      return;
    }

    // Collect all SKILL.md paths and build a directory-name lookup
    const allSkillMdPaths: string[] = [];
    const skillMdByDir = new Map<string, string>();
    for (const entry of tree.entries) {
      if (entry.type !== "blob") continue;
      const lowerPath = entry.path.toLowerCase();
      if (lowerPath !== "skill.md" && !lowerPath.endsWith("/skill.md"))
        continue;

      allSkillMdPaths.push(entry.path);
      const parts = entry.path.split("/");
      if (parts.length >= 2) {
        const parentDir = parts[parts.length - 2];
        skillMdByDir.set(parentDir, entry.path);
      }
    }

    // Pass 1: match by directory name === skillId
    const matchedSkillIds = new Set<string>();
    const matchedPaths = new Set<string>();

    for (const s of skills) {
      const path = skillMdByDir.get(s.skillId);
      if (path) {
        const rawUrl = `https://raw.githubusercontent.com/${source}/${resolvedBranch}/${path}`;
        await ctx.runMutation(internal.skills.updateSkillMdUrl, {
          docId: s.docId as ReturnType<typeof v.id<"skills">>["type"],
          skillMdUrl: rawUrl,
        });
        matchedSkillIds.add(s.skillId);
        matchedPaths.add(path);
      }
    }

    // Pass 2: for unmatched skills, fetch unmatched SKILL.md files and check
    // the frontmatter `name` field (directory name often differs from skillId,
    // or SKILL.md may be at the repo root)
    const unmatchedSkills = skills.filter(
      (s) => !matchedSkillIds.has(s.skillId),
    );
    const unmatchedMdPaths = allSkillMdPaths
      .filter((path) => !matchedPaths.has(path))
      .map((path) => [path, path] as const);

    if (unmatchedSkills.length > 0 && unmatchedMdPaths.length > 0) {
      // Build a quick lookup by skillId for remaining skills
      const remaining = new Map(unmatchedSkills.map((s) => [s.skillId, s]));

      for (const [, mdPath] of unmatchedMdPaths) {
        if (remaining.size === 0) break;

        const rawUrl = `https://raw.githubusercontent.com/${source}/${resolvedBranch}/${mdPath}`;
        try {
          const res = await fetch(rawUrl);
          if (!res.ok) continue;
          const text = await res.text();
          // Extract name from frontmatter: "name: some-skill-id"
          const nameMatch = text.match(/^name:\s*(.+)$/m);
          if (!nameMatch) continue;
          const name = nameMatch[1].trim().replace(/^["']|["']$/g, "");

          // Try exact match, then kebab-case, then prefix match
          // (skills.sh sometimes truncates names at commas to create skillIds)
          const kebabName = name.toLowerCase().replace(/\s+/g, "-");
          let skill = remaining.get(name) ?? remaining.get(kebabName);
          if (!skill) {
            for (const [skillId, s] of remaining) {
              if (kebabName.startsWith(skillId)) {
                skill = s;
                break;
              }
            }
          }
          if (skill) {
            await ctx.runMutation(internal.skills.updateSkillMdUrl, {
              docId: skill.docId as ReturnType<typeof v.id<"skills">>["type"],
              skillMdUrl: rawUrl,
            });
            matchedSkillIds.add(skill.skillId);
            remaining.delete(skill.skillId);
          }
        } catch {
          continue;
        }
      }
    }

    // Mark remaining unmatched skills as not found
    const finalUnmatched = skills.filter(
      (s) => !matchedSkillIds.has(s.skillId),
    );
    for (const s of finalUnmatched) {
      await ctx.runMutation(internal.skills.updateSkillMdUrl, {
        docId: s.docId as ReturnType<typeof v.id<"skills">>["type"],
        skillMdUrl: "",
      });
    }

    console.log(
      `${source}: ${matchedSkillIds.size} matched, ${finalUnmatched.length} not found` +
        (tree.truncated ? " (tree truncated)" : ""),
    );
    for (const s of finalUnmatched) {
      console.log(`  ✗ ${s.skillId}`);
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
    const newFailCount = hasUrl
      ? 0
      : ((skill?.discoveryFailCount ?? 0) + 1);
    await ctx.db.patch(docId, {
      skillMdUrl,
      needsDiscovery: false,
      needsContentFetch: hasUrl,
      discoveryFailCount: newFailCount,
      ...(hasUrl && { hasContentFetchError: false }),
      ...(!hasUrl && { contentFetchedAt: now }),
    });
    // Sync summary
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

    // Filter out sources already scheduled in previous batches
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

    // More sources on this page that we didn't process
    const remaining = newSources.length - batch.length;

    if (remaining > 0 || !result.isDone) {
      // If we have remaining on this page, re-query same cursor
      // Otherwise advance to next page
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
      await ctx.scheduler.runAfter(
        batch.length * stagger + 10_000,
        internal.skills.backfillFetchContent,
        {},
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Phase 2 — Content Fetching (raw.githubusercontent.com)
// ---------------------------------------------------------------------------

const CONTENT_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REDISCOVERY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Mark skills whose content is stale (>7 days) or whose empty URL needs re-discovery (>7 days).
 *  Scans skillSummaries (~200 bytes each) instead of skills (~30KB each) to reduce bandwidth.
 */
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

      // Content re-fetch: non-empty URL, >7 days since last fetch
      const contentStale =
        s.skillMdUrl &&
        s.skillMdUrl !== "" &&
        !s.needsContentFetch &&
        now - (s.contentFetchedAt ?? 0) > CONTENT_REFRESH_INTERVAL_MS;

      // URL re-discovery: empty URL, >7 days since last check, under failure limit
      const needsRediscovery =
        s.skillMdUrl === "" &&
        !s.needsDiscovery &&
        (s.discoveryFailCount ?? 0) < MAX_DISCOVERY_FAILURES &&
        now - (s.contentFetchedAt ?? 0) > REDISCOVERY_INTERVAL_MS;

      if (contentStale) {
        await ctx.db.patch(s.skillDocId, { needsContentFetch: true });
        await ctx.db.patch(s._id, { needsContentFetch: true });
        marked++;
      } else if (needsRediscovery) {
        await ctx.db.patch(s.skillDocId, { needsDiscovery: true });
        await ctx.db.patch(s._id, { needsDiscovery: true });
        marked++;
      }
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
      console.log(
        `Marked ${total} skills for content re-fetch or URL re-discovery`,
      );
    }

    // Chain into URL discovery
    await ctx.scheduler.runAfter(0, internal.skills.backfillDiscoverUrls, {});
  },
});

/** One-shot: flip needsContentFetch=true on rows whose stored description looks
 *  truncated by the pre-fix YAML parser (didn't end in terminal punctuation).
 *  See extractFrontmatterDescription — implicit multi-line plain scalars used
 *  to be cut at the first wrapped line.
 */
export const markTruncatedDescriptionsBatch = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const paginationOpts = cursor
      ? { numItems: 200, cursor }
      : { numItems: 200, cursor: null };
    const result = await ctx.db
      .query("skillSummaries")
      .paginate(paginationOpts);

    let marked = 0;
    for (const s of result.page) {
      if (s.isDelisted) continue;
      if (s.needsContentFetch) continue;
      if (!s.skillMdUrl || s.skillMdUrl === "") continue;
      if (!s.description) continue;

      const last = s.description.trim().slice(-1);
      if (".!?)\"']".includes(last)) continue;

      await ctx.db.patch(s.skillDocId, { needsContentFetch: true });
      await ctx.db.patch(s._id, { needsContentFetch: true });
      marked++;
    }

    return {
      nextCursor: result.continueCursor,
      isDone: result.isDone,
      marked,
    };
  },
});

export const markTruncatedDescriptions = internalAction({
  args: { drain: v.optional(v.boolean()) },
  handler: async (ctx, { drain }) => {
    let cursor: string | undefined;
    let isDone = false;
    let total = 0;

    while (!isDone) {
      const result: { nextCursor: string; isDone: boolean; marked: number } =
        await ctx.runMutation(
          internal.skills.markTruncatedDescriptionsBatch,
          { cursor },
        );
      total += result.marked;
      cursor = result.nextCursor;
      isDone = result.isDone;
    }

    console.log(
      `Marked ${total} skills with likely-truncated descriptions for re-fetch`,
    );

    if (drain && total > 0) {
      await ctx.scheduler.runAfter(0, internal.skills.backfillFetchContent, {});
    }
  },
});

export const listSkillsNeedingContentFetch = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const paginationOpts = cursor
      ? { numItems: 200, cursor }
      : { numItems: 200, cursor: null };
    // Scan summaries (~200 bytes) instead of skills (~30KB) to reduce bandwidth
    const result = await ctx.db
      .query("skillSummaries")
      .withIndex("by_needsContentFetch", (q) =>
        q.eq("needsContentFetch", true),
      )
      .paginate(paginationOpts);

    // Filter to only skills that have a valid URL
    const skills = result.page
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
          // Track failure — after 3 consecutive failures, re-discover the URL
          await ctx.runMutation(internal.skills.markContentFetchFailed, {
            skillId,
          });
          return;
        }

        const raw = await res.text();
        const description = extractFrontmatterDescription(raw);
        const body = extractBodyContent(raw);

        if (description !== null || body) {
          await ctx.runMutation(internal.skills.updateDescription, {
            skillId,
            description: description ?? undefined,
            content: body ?? undefined,
            skillMdUrl,
          });
        } else {
          // Content fetched but nothing parseable — still record the fetch time
          await ctx.runMutation(internal.skills.markContentFetched, {
            skillId,
          });
        }
        return;
      } catch (e) {
        if (attempt < MAX_RETRIES - 1) {
          console.warn(
            `Retry ${attempt + 1}/${MAX_RETRIES} for ${label}: ${e}`,
          );
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        } else {
          console.error(
            `Error fetching content for ${label} after ${MAX_RETRIES} attempts:`,
            e,
          );
        }
      }
    }
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
        `Scheduling content fetch for ${result.skills.length} skills`,
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
      const statsDelay = result.skills.length * STAGGER_MS + 30_000;
      console.log(
        `Content backfill complete — recalculating stats in ${Math.round(statsDelay / 1000)}s`,
      );
      await ctx.scheduler.runAfter(
        statsDelay,
        internal.devStats.recalculateStats,
        {},
      );
      // Embed any skills whose content just changed (or new skills with fresh
      // content). Cheap when nothing changed — drains the queue lazily.
      await ctx.scheduler.runAfter(
        statsDelay + 5_000,
        internal.skills.embedSkillsBatch,
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
  },
  handler: async (ctx, { skillId, description, content, skillMdUrl }) => {
    const skill = await ctx.db.get(skillId);
    if (!skill) return;

    const now = Date.now();

    // Clear broken legacy descriptions ("|" or ">") when no valid description parsed
    const isBrokenDesc =
      skill.description === "|" || skill.description === ">";
    const effectiveDescription =
      description ?? (isBrokenDesc ? "" : undefined);

    const newDescription = effectiveDescription ?? skill.description;

    // Detect if content actually changed — used to flag the skill for
    // re-embedding only when there's something new to embed.
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
      contentFetchedAt: now,
      ...(hasActualChange && { contentUpdatedAt: now }),
      ...(hasActualChange && { needsEmbedding: true }),
      needsContentFetch: false,
      contentFetchFailCount: 0,
      hasContentFetchError: false,
    });

    // Always sync summary with contentFetchedAt and needsContentFetch
    await upsertSkillSummary(ctx, {
      source: skill.source,
      skillId: skill.skillId,
      name: skill.name,
      description: newDescription,
      installs: skill.installs,
      skillDocId: skillId,
      contentFetchedAt: now,
      needsContentFetch: false,
      hasContentFetchError: false,
      skillMdUrl,
      hasSkillMdUrl: !!skillMdUrl && skillMdUrl !== "",
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
    });
    // Sync summary (infrequent call, so reading skill doc is acceptable)
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

    // Sync summary
    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", skill.source).eq("skillId", skill.skillId),
      )
      .unique();

    if (failCount >= 2) {
      // After 2 consecutive failures, clear the URL and re-discover
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
      // First failure: show warning immediately
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
// Delist skills not seen in the API for 30+ days
// ---------------------------------------------------------------------------

const DELIST_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const listStaleSummaries = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const paginationOpts = cursor
      ? { numItems: 100, cursor }
      : { numItems: 100, cursor: null };
    // Convex orders: undefined < false < true — lt(true) skips already-delisted summaries
    const result = await ctx.db
      .query("skillSummaries")
      .withIndex("by_isDelisted", (q) => q.lt("isDelisted", true))
      .paginate(paginationOpts);

    const cutoff = Date.now() - DELIST_THRESHOLD_MS;
    const staleEntries = result.page
      .filter((s) => s.lastSeenInApi !== undefined && s.lastSeenInApi < cutoff)
      .map((s) => ({ summaryId: s._id, source: s.source, skillId: s.skillId }));

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
          hasEmbedding: false,
          skillEmbeddingId: undefined,
        });
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

    while (!isDone) {
      const result = await ctx.runQuery(internal.skills.listStaleSummaries, {
        cursor,
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

/**
 * Full-text search over skill names. Returns up to 100 BM25-ordered results
 * (Convex search indexes do not support custom ordering).
 */
export const searchSkills = query({
  args: {
    query: v.string(),
  },
  // Reads from skillSummaries (~200 bytes/row) instead of skills (~25 KB/row)
  // so the full result set is ~20 KB on the wire instead of ~2.5 MB. The
  // frontend only needs source/skillId/name/description/installs/isDelisted/
  // hasContentFetchError, all of which are mirrored on the summary.
  handler: async (ctx, { query: searchQuery }) => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      return [];
    }
    return ctx.db
      .query("skillSummaries")
      .withSearchIndex("search_name", (q) =>
        q.search("name", trimmed).eq("isDelisted", false),
      )
      .take(100);
  },
});

/**
 * Paginated list of non-delisted skills sorted by installs (descending).
 * Used as the default "browse" view on the home page when no search query
 * is entered. Reads from skillSummaries (~200 bytes/row) for cheap wire size.
 */
export const listPopularSkills = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    return await ctx.db
      .query("skillSummaries")
      .withIndex("by_isDelisted_installs", (q) => q.eq("isDelisted", false))
      .order("desc")
      .paginate(paginationOpts);
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
        latestUpdate: number;
      }
    >();
    let totalSkillCount = 0;
    let totalInstalls = 0;
    let latestUpdate = 0;

    for (const skill of summaries) {
      if (skill.isDelisted) continue;
      totalSkillCount += 1;
      totalInstalls += skill.installs;
      const fetched = skill.contentFetchedAt ?? 0;
      if (fetched > latestUpdate) latestUpdate = fetched;

      const slash = skill.source.indexOf("/");
      const repo =
        slash === -1 ? skill.source : skill.source.slice(slash + 1);
      const existing = map.get(skill.source);
      if (existing) {
        existing.skillCount += 1;
        existing.totalInstalls += skill.installs;
        if (fetched > existing.latestUpdate) existing.latestUpdate = fetched;
      } else {
        map.set(skill.source, {
          repo,
          source: skill.source,
          skillCount: 1,
          totalInstalls: skill.installs,
          latestUpdate: fetched,
        });
      }
    }

    const repos = [...map.values()].sort(
      (a, b) => b.totalInstalls - a.totalInstalls,
    );

    return { repos, totalSkillCount, totalInstalls, latestUpdate };
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

// ---------------------------------------------------------------------------
// Backfill: set needsDiscovery / needsContentFetch / syncHash on existing rows
// ---------------------------------------------------------------------------

export const backfillSyncFlags = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const paginationOpts = cursor
      ? { numItems: 200, cursor }
      : { numItems: 200, cursor: null };
    const result = await ctx.db.query("skills").paginate(paginationOpts);
    const now = Date.now();
    let patched = 0;

    for (const s of result.page) {
      const updates: Record<string, unknown> = {};

      // Set syncHash if missing
      if (s.syncHash === undefined) {
        updates.syncHash = computeSyncHash(s.name, s.leaderboard);
      }

      // Set needsDiscovery if missing
      if (s.needsDiscovery === undefined) {
        updates.needsDiscovery = !s.skillMdUrl || s.skillMdUrl === "";
      }

      // Set needsContentFetch if missing
      if (s.needsContentFetch === undefined) {
        const hasUrl = !!s.skillMdUrl && s.skillMdUrl !== "";
        const needsFetch =
          hasUrl &&
          (!s.content ||
            s.description === "|" ||
            s.description === ">" ||
            s.description === "" ||
            now - (s.contentFetchedAt ?? 0) > CONTENT_REFRESH_INTERVAL_MS);
        updates.needsContentFetch = needsFetch;
      }

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(s._id, updates);
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

export const backfillAllSyncFlags = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | undefined;
    let isDone = false;
    let total = 0;

    while (!isDone) {
      const result: { nextCursor: string; isDone: boolean; patched: number } =
        await ctx.runMutation(internal.skills.backfillSyncFlags, { cursor });
      total += result.patched;
      cursor = result.nextCursor;
      isDone = result.isDone;
    }

    console.log(`Backfilled sync flags on ${total} skills`);
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

