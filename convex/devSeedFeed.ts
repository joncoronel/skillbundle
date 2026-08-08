// Dev-only seeding for the dashboard's change feed.
//
// Builds a bundle for a dev user out of skills that already have seeded version
// history, so the ranked panel can be seen doing its job. Crons are off on dev
// and the archive only holds real upstream edits, so there is otherwise no way
// to get a populated feed locally.
//
// Two steps, because version rows are blob-backed and `ctx.storage.store` is
// action-only:
//
//   npx convex run devSeed:seedVersions '{"source":"owner/repo","skillId":"a"}'
//   npx convex run devSeed:seedVersions '{"source":"owner/repo","skillId":"b"}'
//   npx convex run devSeedFeed:seedFeedBundle '{}'
//   npx convex run devSeedFeed:seedFeedBundle '{"clear":true}'
//
// Deliberately ONE function that calls nothing through `internal`. An earlier
// version orchestrated the seedVersions calls itself; three `internal`
// references were enough to push TypeScript past its instantiation limit while
// resolving the generated API, which does not fail loudly — it silently
// degrades `api` and `internal` to `any` and the visible symptom is unrelated
// files losing their types. Two CLI commands is a cheaper price than that.
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

const FEED_BUNDLE_NAME = "Dev feed";
const DAY = 24 * 60 * 60 * 1000;

export const seedFeedBundle = internalMutation({
  args: { email: v.optional(v.string()), clear: v.optional(v.boolean()) },
  returns: v.object({
    bundle: v.string(),
    skills: v.array(v.string()),
    cleared: v.boolean(),
  }),
  handler: async (ctx, { email, clear }) => {
    // Full scan, deliberately: `users` is indexed by Clerk id, not email, and a
    // dev deployment holds a handful of rows. Not worth an index only a seed
    // script would ever use.
    const users = await ctx.db.query("users").take(50);
    const user = email ? users.find((u) => u.email === email) : users[0];
    if (!user) {
      throw new Error(
        email ? `No user with email ${email}` : "No users on this deployment",
      );
    }

    // Skills that already carry seeded history — a feed row whose diff link
    // landed on an empty timeline would be worse than no seed at all.
    const versioned = await ctx.db.query("skillVersions").take(200);
    const bySkill = new Map<string, { source: string; skillId: string }>();
    for (const row of versioned) {
      bySkill.set(`${row.source}::${row.skillId}`, {
        source: row.source,
        skillId: row.skillId,
      });
    }
    const skills = Array.from(bySkill.values()).slice(0, 4);
    if (skills.length === 0) {
      throw new Error("Run devSeed:seedVersions on a few skills first");
    }

    const existing = await ctx.db
      .query("bundles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();
    for (const b of existing) {
      if (b.name === FEED_BUNDLE_NAME) await ctx.db.delete(b._id);
    }

    // Undo the seeded regression too, so `clear` really clears.
    for (const s of skills) {
      const audit = await ctx.db
        .query("skillAudits")
        .withIndex("by_source_skillId", (q) =>
          q.eq("source", s.source).eq("skillId", s.skillId),
        )
        .unique();
      if (audit?.previousWorstStatus !== undefined) {
        await ctx.db.patch(audit._id, {
          previousWorstStatus: undefined,
          worstStatusChangedAt: undefined,
        });
      }
    }

    const label = skills.map((s) => `${s.source}/${s.skillId}`);
    if (clear) return { bundle: FEED_BUNDLE_NAME, skills: label, cleared: true };

    const now = Date.now();
    await ctx.db.insert("bundles", {
      userId: user._id,
      name: FEED_BUNDLE_NAME,
      urlId: `dev-feed-${now.toString(36)}`,
      // Open, unlike a real bundle: local inspection of the bundle page has to
      // work without a signed-in session (Clerk's dev sign-up sits behind a
      // Cloudflare challenge), and a closed bundle answers only to its owner.
      isPublic: true,
      createdAt: now,
      updatedAt: now,
      // Old enough that every seeded change lands after it.
      lastViewedAt: now - 90 * DAY,
      skills: skills.map((s) => ({ ...s, addedAt: now - 90 * DAY })),
    });

    // The highest-consequence row: a verdict that was passing when the skill was
    // added and is failing now.
    const target = skills[0];
    const audit = await ctx.db
      .query("skillAudits")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", target.source).eq("skillId", target.skillId),
      )
      .unique();
    if (audit) {
      await ctx.db.patch(audit._id, {
        worstStatus: "fail",
        worstRiskLevel: "CRITICAL",
        previousWorstStatus: "pass",
        worstStatusChangedAt: now - 3 * DAY,
      });
      // The register's Audit column reads the verdict denormalized onto the
      // `skills` row, not the audit row, so a seed that patched only the latter
      // left that column empty and untested.
      await ctx.db.patch(audit.skillDocId, {
        worstAuditStatus: "fail",
        worstAuditRiskLevel: "CRITICAL",
      });
    }

    // `seedVersions` always ends on a description rewrite, so without this every
    // seeded row would render as the same kind. Demote the last skill's newest
    // version to a body-only edit so the panel shows all three weights and the
    // ranking is actually visible.
    const quiet = skills.at(-1);
    if (quiet && skills.length > 1) {
      const summary = await ctx.db
        .query("skillSummaries")
        .withIndex("by_source_skillId", (q) =>
          q.eq("source", quiet.source).eq("skillId", quiet.skillId),
        )
        .unique();
      const newest = summary
        ? await ctx.db
            .query("skillVersions")
            .withIndex("by_skill_changedAt", (q) =>
              q.eq("skillDocId", summary.skillDocId),
            )
            .order("desc")
            .first()
        : null;
      if (newest) {
        await ctx.db.patch(newest._id, {
          descriptionChanged: false,
          descriptionBefore: undefined,
          descriptionAfter: undefined,
        });
      }
    }

    return { bundle: FEED_BUNDLE_NAME, skills: label, cleared: false };
  },
});
