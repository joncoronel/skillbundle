/**
 * `skills.listSitemapEntries`, the Convex side of app/sitemap.ts. The URL
 * building is covered in sitemap-entries.test.ts; this covers which rows are
 * allowed in at all.
 */
import { test, expect } from "vitest";
import { api } from "../convex/_generated/api";
import { makeTest } from "./_setup";

test("GitHub-only and duplicate skills stay out of the sitemap", async () => {
  const t = makeTest();
  await t.run(async (ctx) => {
    const rows = [
      { skillId: "listed", isGitHubOnly: false, isDuplicate: false },
      { skillId: "github-only", isGitHubOnly: true, isDuplicate: false },
      { skillId: "duplicate", isGitHubOnly: false, isDuplicate: true },
    ];
    for (const { skillId, isGitHubOnly, isDuplicate } of rows) {
      const skillDocId = await ctx.db.insert("skills", {
        source: "owner/repo",
        skillId,
        name: skillId,
        installs: 0,
        leaderboard: isGitHubOnly ? "github" : "alltime",
        lastSynced: 0,
        isGitHubOnly,
      });
      await ctx.db.insert("skillSummaries", {
        source: "owner/repo",
        skillId,
        name: skillId,
        installs: 0,
        skillDocId,
        isDelisted: false,
        lastSeenInApi: 0,
        isGitHubOnly,
        isDuplicate,
      });
    }
  });

  const result = await t.query(api.skills.listSitemapEntries, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(result.page.map((e) => e.skillId)).toEqual(["listed"]);
});
