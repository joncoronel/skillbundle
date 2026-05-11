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
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getCurated } from "./lib/skillsApi";

const APPLY_BATCH_SIZE = 200;
const CLEANUP_PAGE_SIZE = 200;
// Matches BATCH_SIZE in convex/skills.ts:syncSkills. upsertSkillsBatch's
// slow path inserts a skills row, a skillSummaries row, and reads an index
// probe — keep the batch small enough to stay well under the 4096-read cap.
const UPSERT_BATCH_SIZE = 20;

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

    // Flatten owner→skills map into a single list of (source, skillId, owner)
    // plus the per-skill fields upsertSkillsBatch needs in Pass 0. Carrying
    // them on the same shape avoids a second walk of response.data.
    const curatedEntries: Array<{
      source: string;
      skillId: string;
      owner: string;
      name: string;
      installs: number;
      isDuplicate: boolean;
    }> = [];
    for (const ownerEntry of response.data) {
      for (const skill of ownerEntry.skills) {
        curatedEntries.push({
          source: skill.source,
          skillId: skill.slug,
          owner: ownerEntry.owner,
          name: skill.name,
          installs: skill.installs,
          isDuplicate: skill.isDuplicate ?? false,
        });
      }
    }

    console.log(
      `Curated set: ${response.totalOwners} owners, ${response.totalSkills} skills (received ${curatedEntries.length} entries)`,
    );

    // Pass 0: ensure every curated skill exists in our DB. The regular sync
    // (syncSkills) drops anything below MIN_INSTALLS=50 before upserting, so
    // curated publishers with only low-install skills (e.g. Bitwarden) would
    // otherwise have zero rows here and 404 on /<owner>. Reuses the canonical
    // insert path so new rows get the full pipeline (discovery, content fetch,
    // embedding, audit) just like leaderboard rows. Idempotent for existing
    // rows — fast-path A in upsertSkillsBatch just touches lastSeenInApi.
    let totalUpserted = 0;
    for (let i = 0; i < curatedEntries.length; i += UPSERT_BATCH_SIZE) {
      const chunk = curatedEntries.slice(i, i + UPSERT_BATCH_SIZE);
      await ctx.runMutation(internal.skills.upsertSkillsBatch, {
        skills: chunk.map((e) => ({
          source: e.source,
          skillId: e.skillId,
          name: e.name,
          installs: e.installs,
          isDuplicate: e.isDuplicate,
        })),
        leaderboard: "curated",
      });
      totalUpserted += chunk.length;
    }

    // Pass 1: stamp curatedOwner. Chunk entries into APPLY_BATCH_SIZE-sized
    // mutation calls so each stays under Convex's 4096-read limit. Strip the
    // Pass-0-only fields (name/installs/isDuplicate) before sending — the
    // stamping mutation only needs source/skillId/owner.
    let totalStamped = 0;
    for (let i = 0; i < curatedEntries.length; i += APPLY_BATCH_SIZE) {
      const chunk = curatedEntries.slice(i, i + APPLY_BATCH_SIZE);
      const { stamped } = await ctx.runMutation(
        internal.curated.applyCuratedSetBatch,
        {
          entries: chunk.map((e) => ({
            source: e.source,
            skillId: e.skillId,
            owner: e.owner,
          })),
        },
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

    // Pass 3: rebuild the owner-level rollup that drives /official. This
    // is computed entirely from `curatedEntries` (the API response we
    // already have in scope), so it doesn't need to read the per-skill
    // table again. The rollup is small (~hundreds of owners) so it fits
    // in a single mutation under the 4096-read limit.
    type OwnerAcc = { skillCount: number; sources: Set<string> };
    const byOwner = new Map<string, OwnerAcc>();
    for (const e of curatedEntries) {
      const acc = byOwner.get(e.owner);
      if (acc) {
        acc.skillCount++;
        acc.sources.add(e.source);
      } else {
        byOwner.set(e.owner, { skillCount: 1, sources: new Set([e.source]) });
      }
    }
    const ownerRows = Array.from(byOwner.entries()).map(([owner, acc]) => ({
      owner,
      skillCount: acc.skillCount,
      repoCount: acc.sources.size,
    }));
    await ctx.runMutation(internal.curated.applyCuratedOwnerRollup, {
      owners: ownerRows,
    });

    console.log(
      `syncCurated: upserted ${totalUpserted}, stamped ${totalStamped}, cleared ${totalCleared}, owners ${ownerRows.length}`,
    );

    // Drain the discovery / content-fetch / audit chain for any rows Pass 0
    // just inserted. Without this, freshly-inserted curated rows wait for the
    // next syncSkills run (~17h later) before their SKILL.md is fetched.
    // Mirrors the chain kick-off at the end of markStaleContent. Idempotent
    // — if nothing new was inserted, backfillDiscoverUrls scans, finds zero rows
    // with needsDiscovery=true that aren't already scheduled, and exits.
    await ctx.scheduler.runAfter(0, internal.skills.backfillDiscoverUrls, {});
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

/**
 * Rebuild the curatedOwnerSummaries rollup table from the latest sync's
 * per-owner counts. Single mutation: the table is small (~hundreds of
 * owners), so the read budget is not a concern. Upserts current rows and
 * deletes any owner that's no longer present in `owners`.
 */
export const applyCuratedOwnerRollup = internalMutation({
  args: {
    owners: v.array(
      v.object({
        owner: v.string(),
        skillCount: v.number(),
        repoCount: v.number(),
      }),
    ),
  },
  handler: async (ctx, { owners }) => {
    const wanted = new Map(owners.map((o) => [o.owner, o]));

    // Update / insert. Patch only when something changed to avoid spurious
    // reactivity on subscribed components.
    const existing = await ctx.db.query("curatedOwnerSummaries").collect();
    const existingByOwner = new Map(existing.map((e) => [e.owner, e]));

    for (const target of owners) {
      const current = existingByOwner.get(target.owner);
      if (!current) {
        await ctx.db.insert("curatedOwnerSummaries", target);
      } else if (
        current.skillCount !== target.skillCount ||
        current.repoCount !== target.repoCount
      ) {
        await ctx.db.patch(current._id, {
          skillCount: target.skillCount,
          repoCount: target.repoCount,
        });
      }
    }

    // Delete owners that fell out of the curated set entirely.
    for (const row of existing) {
      if (!wanted.has(row.owner)) {
        await ctx.db.delete(row._id);
      }
    }
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
 * Reads the denormalized curatedOwnerSummaries table directly. Counts are
 * computed at sync time inside syncCurated, so this query is O(N owners)
 * — typically a few hundred — instead of O(N curated skills). Note: the
 * counts here include delisted/duplicate skills (they were curated when
 * stamped). If that drift becomes a problem, syncCurated can subtract
 * delisted/duplicate rows during Pass 3 — but it's a low-scale effect.
 */
export const listCuratedOwners = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("curatedOwnerSummaries").collect();
    return rows
      .map((r) => ({
        owner: r.owner,
        skillCount: r.skillCount,
        repoCount: r.repoCount,
      }))
      .sort((a, b) => a.owner.localeCompare(b.owner));
  },
});
