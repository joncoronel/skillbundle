// Dev-only seeding for the skill-page install charts.
//
// The daily `syncSkills` cron is what records `skillSnapshots` in production,
// but it's disabled on the dev deployment — so there's no install history to
// chart locally. Run this to fabricate a believable rising series (and a rank)
// for a skill so the Insights section renders populated.
//
//   npx convex run devSeed:seedInsights '{"source":"google-deepmind/science-skills","skillId":"protein-sequence-msa"}'
//   npx convex run devSeed:seedInsights '{"source":"...","skillId":"...","days":0}'   # clear
//
// These are `internalMutation`s, so no client can reach them. That is NOT what
// makes them safe — `--prod` is one flag away from every command shown above,
// and one of these deletes archive blobs irreversibly. EVERY export in this
// file calls `assertNotProduction` first; see convex/lib/devOnly.ts.
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { assertNotProduction } from "./lib/devOnly";

export const seedInsights = internalMutation({
  args: { source: v.string(), skillId: v.string(), days: v.optional(v.number()) },
  handler: async (ctx, { source, skillId, days = 45 }) => {
    assertNotProduction("devSeed:seedInsights");
    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", source).eq("skillId", skillId),
      )
      .unique();
    if (!summary) throw new Error(`No skill found for ${source}/${skillId}`);

    // A plausible all-time rank so the "#N · Top X%" stat shows.
    await ctx.db.patch(summary._id, { installRank: 142 });

    // Wipe existing snapshots first so re-running is idempotent. `days: 0`
    // leaves the table empty (use it to preview the "collecting" placeholder).
    const existing = await ctx.db
      .query("skillSnapshots")
      .withIndex("by_skill_day", (q) => q.eq("skillDocId", summary.skillDocId))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);

    const end = summary.installs;
    const start = Math.max(0, Math.round(end * 0.55));
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const day = d.toISOString().slice(0, 10);
      const t = (days - 1 - i) / Math.max(1, days - 1);
      // Ease-in growth + a little daily wobble so the bars vary day to day.
      const base = start + (end - start) * t * t;
      const wobble = Math.sin(i * 1.7) * (end - start) * 0.01;
      const installs = Math.max(start, Math.round(base + wobble));
      await ctx.db.insert("skillSnapshots", {
        skillDocId: summary.skillDocId,
        day,
        installs: i === 0 ? end : installs,
      });
    }
    return { source, skillId, seeded: days, installRank: 142 };
  },
});

// Seed an EXACT snapshot series (rather than the fabricated curve above), so a
// production data shape can be replicated locally to reproduce a chart bug.
//
//   npx convex run devSeed:seedExact '{"source":"vercel-labs/agent-skills","skillId":"vercel-react-best-practices","snapshots":[{"day":"2026-06-17","installs":482982},{"day":"2026-06-18","installs":484605}]}'
export const seedExact = internalMutation({
  args: {
    source: v.string(),
    skillId: v.string(),
    snapshots: v.array(v.object({ day: v.string(), installs: v.number() })),
  },
  handler: async (ctx, { source, skillId, snapshots }) => {
    assertNotProduction("devSeed:seedExact");
    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", source).eq("skillId", skillId),
      )
      .unique();
    if (!summary) throw new Error(`No skill found for ${source}/${skillId}`);

    // Sort chronologically so the inserts and the "latest" pick below don't
    // depend on the caller passing the array in order.
    const sorted = [...snapshots].sort((a, b) => a.day.localeCompare(b.day));

    const existing = await ctx.db
      .query("skillSnapshots")
      .withIndex("by_skill_day", (q) => q.eq("skillDocId", summary.skillDocId))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);

    for (const s of sorted) {
      await ctx.db.insert("skillSnapshots", {
        skillDocId: summary.skillDocId,
        day: s.day,
        installs: s.installs,
      });
    }

    // Align the headline install count (skills row + summary) with the latest
    // snapshot so the page reads consistently.
    const latest = sorted.at(-1);
    if (latest) {
      await ctx.db.patch(summary._id, { installs: latest.installs });
      await ctx.db.patch(summary.skillDocId, { installs: latest.installs });
    }

    return { source, skillId, seeded: snapshots.length };
  },
});

// ---------------------------------------------------------------------------
// Dev-only seeding for the skill page's History section.
// ---------------------------------------------------------------------------
//
// Version rows are written by the content pipeline when it detects an upstream
// edit, and that pipeline doesn't run on the dev deployment — so locally a skill
// has no history and the section can only ever render its empty state. This
// fabricates a believable sequence: a baseline, a body-only edit, and a version
// bump that also rewrote the description (the high-severity case, and the one
// actually worth looking at).
//
//   npx convex run devSeed:seedVersions '{"source":"owner/repo","skillId":"my-skill"}'
//   npx convex run devSeed:seedVersions '{"source":"...","skillId":"...","clear":true}'
//
// Split into an action plus two mutations for the same reason the production
// path is: `ctx.storage.store` is action-only in Convex, while `ctx.db` writes
// and `ctx.storage.delete` belong to the mutation. Seeding a blob-backed table
// cannot be one function.

const SEED_BODY = [
  "## Setup",
  "",
  "1. Install the dependencies with your package manager of choice.",
  "2. Point the tool at the directory you want it to read.",
  "",
  "## How it works",
  "",
  "The skill inspects the project and reports what it finds. It does not",
  "write to disk unless you pass an explicit flag.",
].join("\n");

const SEED_DAY = 24 * 60 * 60 * 1000;

const SEED_STEPS = [
  {
    daysAgo: 61,
    version: "1.4.0",
    description:
      "Use when auditing a project's dependency tree for outdated or unmaintained packages.",
    extra: "",
    descriptionChanged: false,
    isBaseline: true,
  },
  {
    daysAgo: 23,
    version: "1.4.0",
    description:
      "Use when auditing a project's dependency tree for outdated or unmaintained packages.",
    extra:
      "\n\n## Limits\n\nLockfiles larger than 5 MB are skipped rather than parsed partially.",
    descriptionChanged: false,
    isBaseline: false,
  },
  {
    daysAgo: 2,
    version: "2.0.0",
    description:
      "Use when auditing dependencies OR reviewing a pull request for risky package changes. Also covers lockfile drift and transitive version conflicts.",
    extra:
      "\n\n## Limits\n\nLockfiles larger than 5 MB are skipped rather than parsed partially.\n\n## Pull request mode\n\nPass a diff and the skill reports only the packages the change touches.",
    descriptionChanged: true,
    isBaseline: false,
  },
];

export const clearSeededVersions = internalMutation({
  args: { source: v.string(), skillId: v.string() },
  returns: v.id("skills"),
  handler: async (ctx, { source, skillId }) => {
    // The most dangerous function in this file: it deletes every skillVersions
    // row for a skill AND its storage blob, with no "seeded" predicate despite
    // the name. On production that is the real archive, irreversibly.
    assertNotProduction("devSeed:clearSeededVersions");
    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", source).eq("skillId", skillId),
      )
      .unique();
    if (!summary) throw new Error(`No skill found for ${source}/${skillId}`);

    // Drop the blobs alongside the rows, or repeated seeding leaks files that
    // nothing references and nothing will ever collect.
    const existing = await ctx.db
      .query("skillVersions")
      .withIndex("by_skill_changedAt", (q) =>
        q.eq("skillDocId", summary.skillDocId),
      )
      .collect();
    for (const row of existing) {
      await ctx.storage.delete(row.rawStorageId);
      await ctx.db.delete(row._id);
    }
    return summary.skillDocId;
  },
});

export const insertSeededVersion = internalMutation({
  args: {
    skillDocId: v.id("skills"),
    source: v.string(),
    skillId: v.string(),
    changedAt: v.number(),
    syncHash: v.string(),
    previousSyncHash: v.optional(v.string()),
    rawStorageId: v.id("_storage"),
    rawBytes: v.number(),
    frontmatterVersion: v.string(),
    previousFrontmatterVersion: v.optional(v.string()),
    descriptionBefore: v.optional(v.string()),
    descriptionAfter: v.optional(v.string()),
    descriptionChanged: v.boolean(),
    isBaseline: v.boolean(),
    stampContentUpdatedAt: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertNotProduction("devSeed:insertSeededVersion");
    await ctx.db.insert("skillVersions", {
      skillDocId: args.skillDocId,
      source: args.source,
      skillId: args.skillId,
      changedAt: args.changedAt,
      syncHash: args.syncHash,
      previousSyncHash: args.previousSyncHash,
      rawStorageId: args.rawStorageId,
      rawBytes: args.rawBytes,
      frontmatterVersion: args.frontmatterVersion,
      previousFrontmatterVersion: args.previousFrontmatterVersion,
      descriptionBefore: args.descriptionBefore,
      descriptionAfter: args.descriptionAfter,
      descriptionChanged: args.descriptionChanged,
      contentChanged: true,
      isBaseline: args.isBaseline,
    });

    if (args.stampContentUpdatedAt) {
      // Keep the sidebar's "Updated" stat agreeing with the newest row, so the
      // anchor link down to History doesn't land on a contradicting date.
      await ctx.db.patch(args.skillDocId, { contentUpdatedAt: args.changedAt });
      const summary = await ctx.db
        .query("skillSummaries")
        .withIndex("by_skillDocId", (q) => q.eq("skillDocId", args.skillDocId))
        .unique();
      if (summary) {
        await ctx.db.patch(summary._id, { contentUpdatedAt: args.changedAt });
      }
    }
    return null;
  },
});

export const seedVersions = internalAction({
  args: {
    source: v.string(),
    skillId: v.string(),
    clear: v.optional(v.boolean()),
  },
  returns: v.object({
    source: v.string(),
    skillId: v.string(),
    seeded: v.number(),
  }),
  handler: async (ctx, { source, skillId, clear }) => {
    assertNotProduction("devSeed:seedVersions");
    const skillDocId: Id<"skills"> = await ctx.runMutation(
      internal.devSeed.clearSeededVersions,
      { source, skillId },
    );
    if (clear) return { source, skillId, seeded: 0 };

    const now = Date.now();
    let previousSyncHash: string | undefined;
    let previousFrontmatterVersion: string | undefined;
    let previousDescription: string | undefined;

    for (const [i, step] of SEED_STEPS.entries()) {
      const changedAt = now - step.daysAgo * SEED_DAY;
      const raw = `---\nname: ${skillId}\ndescription: ${step.description}\nversion: ${step.version}\n---\n\n${SEED_BODY}${step.extra}\n`;
      const rawStorageId = await ctx.storage.store(
        new Blob([raw], { type: "text/markdown" }),
      );
      const syncHash = `dev-${changedAt}`;

      await ctx.runMutation(internal.devSeed.insertSeededVersion, {
        skillDocId,
        source,
        skillId,
        changedAt,
        syncHash,
        previousSyncHash,
        rawStorageId,
        rawBytes: raw.length,
        frontmatterVersion: step.version,
        previousFrontmatterVersion,
        descriptionBefore: step.descriptionChanged
          ? previousDescription
          : undefined,
        descriptionAfter: step.descriptionChanged ? step.description : undefined,
        descriptionChanged: step.descriptionChanged,
        isBaseline: step.isBaseline,
        stampContentUpdatedAt: i === SEED_STEPS.length - 1,
      });

      previousSyncHash = syncHash;
      previousFrontmatterVersion = step.version;
      previousDescription = step.description;
    }

    return { source, skillId, seeded: SEED_STEPS.length };
  },
});

/**
 * Dev-only: put a watched skill into a FAULT state, or take it out of one.
 *
 *   npx convex run devSeed:seedFault '{"source":"owner/repo","skillId":"x","kind":"delisted"}'
 *   npx convex run devSeed:seedFault '{"source":"owner/repo","skillId":"x","kind":"fetch-error"}'
 *   npx convex run devSeed:seedFault '{"source":"owner/repo","skillId":"x","kind":"clear"}'
 *
 * Why this exists. `delisted` and `hasContentFetchError` drive a whole branch of
 * the monitoring UI — the "Needs attention" section, the alert-tone status
 * light, and the focus target "Mark all read" picks (a fault survives the
 * clear, so the panel does NOT crossfade and focus has to go somewhere else).
 * None of that is reachable on a dev deployment: faults only arise from a real
 * upstream delisting or a real fetch failure, and the crons that would produce
 * either are off. So the one branch of the panel most likely to regress was
 * also the only one that could not be exercised, which is exactly how it
 * regressed once already.
 *
 * Writes both the summary and the skills row, because the register reads the
 * bundle projection (skills) and the feed reads the summary mirror; setting one
 * would produce a state the two surfaces disagree about.
 */
export const seedFault = internalMutation({
  args: {
    source: v.string(),
    skillId: v.string(),
    kind: v.union(
      v.literal("delisted"),
      v.literal("fetch-error"),
      v.literal("clear"),
    ),
  },
  returns: v.object({ source: v.string(), skillId: v.string(), kind: v.string() }),
  handler: async (ctx, { source, skillId, kind }) => {
    assertNotProduction("devSeed:seedFault");

    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", source).eq("skillId", skillId),
      )
      .unique();
    if (!summary) throw new Error(`No skill found for ${source}/${skillId}`);

    const patch = {
      isDelisted: kind === "delisted",
      hasContentFetchError: kind === "fetch-error",
    };
    await ctx.db.patch(summary._id, patch);
    const skill = await ctx.db.get(summary.skillDocId);
    if (skill) await ctx.db.patch(summary.skillDocId, patch);

    return { source, skillId, kind };
  },
});
