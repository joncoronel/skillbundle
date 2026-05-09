/**
 * Curated/official skill sync.
 *
 * Hits skills.sh /api/v1/skills/curated and stamps `curatedOwner` onto every
 * skill that belongs to a curated org's set. Drives the "Official" badge on
 * skill cards and the /official page.
 *
 * Paginated through batches because Convex caps reads at 4096 per mutation
 * and the curated set has ~4400 entries — too many to handle in one shot.
 * The action chunks entries into 200-row batches, then runs a separate
 * paginated cleanup pass to clear stale curatedOwner from rows that fell
 * out of the curated set.
 */

import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getCurated } from "./lib/skillsApi";

const APPLY_BATCH_SIZE = 200;
const CLEANUP_PAGE_SIZE = 200;

export const syncCurated = internalAction({
  args: {},
  handler: async (ctx) => {
    let response;
    try {
      response = await getCurated();
    } catch (e) {
      console.error("syncCurated failed:", e);
      return;
    }

    // Defensive guard: skills.sh occasionally returns an empty curated set
    // (probably internal cache miss). Don't proceed — that would clear every
    // existing curatedOwner stamp on the next pass and leave us with nothing.
    if (response.totalSkills === 0 || response.data.length === 0) {
      console.warn(
        `Curated API returned empty set (totalOwners=${response.totalOwners}, totalSkills=${response.totalSkills}). Skipping sync to avoid wiping existing stamps.`,
      );
      return;
    }

    // Flatten owner→skills map into a single list of (source, skillId, owner).
    const curatedEntries: Array<{
      source: string;
      skillId: string;
      owner: string;
    }> = [];
    for (const ownerEntry of response.data) {
      for (const skill of ownerEntry.skills) {
        curatedEntries.push({
          source: skill.source,
          skillId: skill.slug,
          owner: ownerEntry.owner,
        });
      }
    }

    console.log(
      `Curated set: ${response.totalOwners} owners, ${response.totalSkills} skills (received ${curatedEntries.length} entries)`,
    );

    // Pass 1: stamp curatedOwner. Chunk entries into APPLY_BATCH_SIZE-sized
    // mutation calls so each stays under Convex's 4096-read limit.
    let totalStamped = 0;
    for (let i = 0; i < curatedEntries.length; i += APPLY_BATCH_SIZE) {
      const chunk = curatedEntries.slice(i, i + APPLY_BATCH_SIZE);
      const { stamped } = await ctx.runMutation(
        internal.curated.applyCuratedSetBatch,
        { entries: chunk },
      );
      totalStamped += stamped;
    }

    // Pass 2: paginated cleanup of rows whose curatedOwner is no longer in
    // the wanted set. Build the wanted-keys set as a sorted array so we can
    // pass it through to the paginated cleanup mutation.
    const wantedKeys = curatedEntries.map((e) => `${e.source}|${e.skillId}`);

    let cursor: string | undefined;
    let isDone = false;
    let totalCleared = 0;
    while (!isDone) {
      const result: {
        nextCursor: string;
        isDone: boolean;
        cleared: number;
      } = await ctx.runMutation(
        internal.curated.clearStaleCuratedOwnersBatch,
        { wantedKeys, cursor },
      );
      totalCleared += result.cleared;
      cursor = result.nextCursor;
      isDone = result.isDone;
    }

    console.log(
      `syncCurated: stamped ${totalStamped}, cleared ${totalCleared}`,
    );
  },
});

export const applyCuratedSetBatch = internalMutation({
  args: {
    entries: v.array(
      v.object({
        source: v.string(),
        skillId: v.string(),
        owner: v.string(),
      }),
    ),
  },
  handler: async (ctx, { entries }) => {
    let stamped = 0;
    for (const entry of entries) {
      const summary = await ctx.db
        .query("skillSummaries")
        .withIndex("by_source_skillId", (q) =>
          q.eq("source", entry.source).eq("skillId", entry.skillId),
        )
        .unique();
      if (!summary) continue;

      if (summary.curatedOwner !== entry.owner) {
        await ctx.db.patch(summary._id, { curatedOwner: entry.owner });
        await ctx.db.patch(summary.skillDocId, { curatedOwner: entry.owner });
        stamped++;
      }
    }
    return { stamped };
  },
});

export const clearStaleCuratedOwnersBatch = internalMutation({
  args: {
    wantedKeys: v.array(v.string()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { wantedKeys, cursor }) => {
    // Index range `gt("curatedOwner", "")` walks ONLY currently-stamped rows
    // (skips the ~75k undefined rows that come first in the index).
    const result = await ctx.db
      .query("skillSummaries")
      .withIndex("by_curatedOwner", (q) => q.gt("curatedOwner", ""))
      .paginate({ numItems: CLEANUP_PAGE_SIZE, cursor: cursor ?? null });

    const wantedSet = new Set(wantedKeys);
    let cleared = 0;
    for (const summary of result.page) {
      const key = `${summary.source}|${summary.skillId}`;
      if (!wantedSet.has(key)) {
        await ctx.db.patch(summary._id, { curatedOwner: undefined });
        await ctx.db.patch(summary.skillDocId, { curatedOwner: undefined });
        cleared++;
      }
    }

    return {
      nextCursor: result.continueCursor,
      isDone: result.isDone,
      cleared,
    };
  },
});

// ---------------------------------------------------------------------------
// Public queries — Official / Curated browse page
// ---------------------------------------------------------------------------

/**
 * Owner-level rollup for the /official page. Returns one entry per curated
 * owner — name, skill count, and distinct-source (repo) count. Sorted
 * alphabetically (this is a directory, not a popularity ranking).
 *
 * Lightweight by design: no skill arrays. The /official page is a directory
 * linking to per-org pages (`/[org]`) that already render the full skill
 * list, so duplicating that data here would be redundant.
 */
export const listCuratedOwners = query({
  args: {},
  handler: async (ctx) => {
    const summaries = await ctx.db
      .query("skillSummaries")
      .withIndex("by_curatedOwner", (q) => q.gt("curatedOwner", ""))
      .collect();

    type OwnerAcc = {
      owner: string;
      skillCount: number;
      sources: Set<string>;
    };
    const byOwner = new Map<string, OwnerAcc>();

    for (const s of summaries) {
      if (s.isDelisted || s.isDuplicate) continue;
      const owner = s.curatedOwner!;
      const existing = byOwner.get(owner);
      if (existing) {
        existing.skillCount += 1;
        existing.sources.add(s.source);
      } else {
        byOwner.set(owner, {
          owner,
          skillCount: 1,
          sources: new Set([s.source]),
        });
      }
    }

    return Array.from(byOwner.values())
      .map(({ sources, ...rest }) => ({
        ...rest,
        repoCount: sources.size,
      }))
      .sort((a, b) => a.owner.localeCompare(b.owner));
  },
});
