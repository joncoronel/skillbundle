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
// These are `internalMutation`s: the CLI (admin key) can run them, but they are
// never exposed to clients, so this file is safe to leave in the repo.
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const seedInsights = internalMutation({
  args: { source: v.string(), skillId: v.string(), days: v.optional(v.number()) },
  handler: async (ctx, { source, skillId, days = 45 }) => {
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
    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", source).eq("skillId", skillId),
      )
      .unique();
    if (!summary) throw new Error(`No skill found for ${source}/${skillId}`);

    const existing = await ctx.db
      .query("skillSnapshots")
      .withIndex("by_skill_day", (q) => q.eq("skillDocId", summary.skillDocId))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);

    for (const s of snapshots) {
      await ctx.db.insert("skillSnapshots", {
        skillDocId: summary.skillDocId,
        day: s.day,
        installs: s.installs,
      });
    }

    // Align the headline install count (skills row + summary) with the latest
    // snapshot so the page reads consistently.
    const latest = snapshots.at(-1);
    if (latest) {
      await ctx.db.patch(summary._id, { installs: latest.installs });
      await ctx.db.patch(summary.skillDocId, { installs: latest.installs });
    }

    return { source, skillId, seeded: snapshots.length };
  },
});
