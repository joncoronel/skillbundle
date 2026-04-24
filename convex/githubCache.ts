import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export const getTreeCache = internalQuery({
  args: { repo: v.string() },
  handler: async (ctx, { repo }) => {
    const entry = await ctx.db
      .query("githubTreeCache")
      .withIndex("by_repo", (q) => q.eq("repo", repo))
      .unique();

    if (!entry) return null;

    return {
      branch: entry.branch,
      etag: entry.etag,
      dependencyFilePaths: entry.dependencyFilePaths,
      cachedAt: entry.cachedAt,
      isExpired: Date.now() - entry.cachedAt > CACHE_TTL_MS,
    };
  },
});

export const setTreeCache = internalMutation({
  args: {
    repo: v.string(),
    branch: v.string(),
    etag: v.string(),
    dependencyFilePaths: v.array(v.string()),
  },
  handler: async (ctx, { repo, branch, etag, dependencyFilePaths }) => {
    const existing = await ctx.db
      .query("githubTreeCache")
      .withIndex("by_repo", (q) => q.eq("repo", repo))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        branch,
        etag,
        dependencyFilePaths,
        cachedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("githubTreeCache", {
        repo,
        branch,
        etag,
        dependencyFilePaths,
        cachedAt: Date.now(),
      });
    }
  },
});

export const touchTreeCache = internalMutation({
  args: { repo: v.string() },
  handler: async (ctx, { repo }) => {
    const entry = await ctx.db
      .query("githubTreeCache")
      .withIndex("by_repo", (q) => q.eq("repo", repo))
      .unique();

    if (entry) {
      await ctx.db.patch(entry._id, { cachedAt: Date.now() });
    }
  },
});

// Action + batch mutation so the daily cleanup keeps chewing through expired
// rows if more than one batch has accumulated, without risking a single
// mutation's write limit.
export const cleanupExpiredCache = internalAction({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
    while (true) {
      const deleted: number = await ctx.runMutation(
        internal.githubCache.cleanupExpiredCacheBatch,
        { cutoff },
      );
      if (deleted === 0) break;
    }
  },
});

export const cleanupExpiredCacheBatch = internalMutation({
  args: { cutoff: v.number() },
  handler: async (ctx, { cutoff }) => {
    const expired = await ctx.db
      .query("githubTreeCache")
      .filter((q) => q.lt(q.field("cachedAt"), cutoff))
      .take(100);

    for (const entry of expired) {
      await ctx.db.delete(entry._id);
    }
    return expired.length;
  },
});
