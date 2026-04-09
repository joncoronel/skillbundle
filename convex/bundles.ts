import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getCurrentUser, getCurrentUserOrThrow } from "./users";
import { getUserPlanWithLimits } from "./lib/plans";

// ---------------------------------------------------------------------------
// URL ID helpers
// ---------------------------------------------------------------------------

function generateUrlId(length = 10): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length }, () =>
    chars[Math.floor(Math.random() * chars.length)],
  ).join("");
}

async function ensureUniqueUrlId(ctx: QueryCtx): Promise<string> {
  const id = generateUrlId();
  const existing = await ctx.db
    .query("bundles")
    .withIndex("by_urlId", (q) => q.eq("urlId", id))
    .unique();
  if (!existing) return id;
  return ensureUniqueUrlId(ctx);
}

async function countUserBundles(ctx: MutationCtx, userId: Id<"users">) {
  const bundles = await ctx.db
    .query("bundles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect();
  return bundles.length;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const createBundle = mutation({
  args: {
    name: v.string(),
    skills: v.array(
      v.object({
        source: v.string(),
        skillId: v.string(),
      }),
    ),
    isPublic: v.boolean(),
  },
  handler: async (ctx, { name, skills, isPublic }) => {
    const user = await getCurrentUserOrThrow(ctx);
    const { limits } = await getUserPlanWithLimits(ctx);

    const bundleCount = await countUserBundles(ctx, user._id);
    if (bundleCount >= limits.maxBundles) {
      throw new Error("Bundle limit reached. Upgrade to Pro for unlimited bundles.");
    }
    if (!isPublic && !limits.canMakePrivate) {
      throw new Error("Private bundles require a Pro plan.");
    }

    const urlId = await ensureUniqueUrlId(ctx);

    const now = Date.now();
    const bundleId = await ctx.db.insert("bundles", {
      userId: user._id,
      name,
      urlId,
      skills: skills.map((s) => ({ ...s, addedAt: now })),
      isPublic,
      createdAt: now,
    });

    return { bundleId, urlId };
  },
});

export const updateBundleVisibility = mutation({
  args: {
    bundleId: v.id("bundles"),
    isPublic: v.boolean(),
  },
  handler: async (ctx, { bundleId, isPublic }) => {
    const user = await getCurrentUserOrThrow(ctx);
    const bundle = await ctx.db.get(bundleId);

    if (!bundle || bundle.userId !== user._id) {
      throw new Error("Bundle not found or unauthorized");
    }

    if (!isPublic) {
      const { limits } = await getUserPlanWithLimits(ctx);
      if (!limits.canMakePrivate) {
        throw new Error("Private bundles require a Pro plan.");
      }
    }

    await ctx.db.patch(bundleId, { isPublic });
  },
});

export const updateBundleName = mutation({
  args: {
    bundleId: v.id("bundles"),
    name: v.string(),
  },
  handler: async (ctx, { bundleId, name }) => {
    const user = await getCurrentUserOrThrow(ctx);
    const bundle = await ctx.db.get(bundleId);

    if (!bundle || bundle.userId !== user._id) {
      throw new Error("Bundle not found or unauthorized");
    }

    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Name cannot be empty");
    }

    await ctx.db.patch(bundleId, { name: trimmed });
  },
});

export const generateShareToken = mutation({
  args: { bundleId: v.id("bundles") },
  handler: async (ctx, { bundleId }) => {
    const user = await getCurrentUserOrThrow(ctx);
    const bundle = await ctx.db.get(bundleId);

    if (!bundle || bundle.userId !== user._id) {
      throw new Error("Bundle not found or unauthorized");
    }

    const token = Array.from({ length: 4 }, () =>
      Math.random().toString(36).slice(2),
    ).join("");

    await ctx.db.patch(bundleId, { shareToken: token });
    return token;
  },
});

export const revokeShareToken = mutation({
  args: { bundleId: v.id("bundles") },
  handler: async (ctx, { bundleId }) => {
    const user = await getCurrentUserOrThrow(ctx);
    const bundle = await ctx.db.get(bundleId);

    if (!bundle || bundle.userId !== user._id) {
      throw new Error("Bundle not found or unauthorized");
    }

    await ctx.db.patch(bundleId, { shareToken: undefined });
  },
});

export const deleteBundle = mutation({
  args: { bundleId: v.id("bundles") },
  handler: async (ctx, { bundleId }) => {
    const user = await getCurrentUserOrThrow(ctx);
    const bundle = await ctx.db.get(bundleId);

    if (!bundle || bundle.userId !== user._id) {
      throw new Error("Bundle not found or unauthorized");
    }

    await ctx.db.delete(bundleId);
  },
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const countByUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return 0;
    const bundles = await ctx.db
      .query("bundles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();
    return bundles.length;
  },
});

export const getByUrlId = query({
  args: { urlId: v.string(), shareToken: v.optional(v.string()) },
  handler: async (ctx, { urlId, shareToken }) => {
    const bundle = await ctx.db
      .query("bundles")
      .withIndex("by_urlId", (q) => q.eq("urlId", urlId))
      .unique();

    if (!bundle) return null;

    const currentUser = await getCurrentUser(ctx);
    const isOwner = currentUser !== null && currentUser._id === bundle.userId;

    if (!bundle.isPublic) {
      const hasValidToken =
        shareToken !== undefined &&
        bundle.shareToken !== undefined &&
        shareToken === bundle.shareToken;

      if (!isOwner && !hasValidToken) return null;
    }

    const skillsWithData = await Promise.all(
      bundle.skills.map(async (s) => {
        const skill = await ctx.db
          .query("skills")
          .withIndex("by_source_skillId", (q) =>
            q.eq("source", s.source).eq("skillId", s.skillId),
          )
          .unique();

        const addedAt = s.addedAt;
        const contentUpdatedAt = skill?.contentUpdatedAt;
        const updatedSinceAdded =
          addedAt !== undefined &&
          contentUpdatedAt !== undefined &&
          contentUpdatedAt > addedAt;

        return {
          source: s.source,
          skillId: s.skillId,
          name: skill?.name ?? s.skillId,
          description: skill?.description,
          installs: skill?.installs ?? 0,
          updatedSinceAdded,
          contentUpdatedAt: skill?.contentUpdatedAt,
          createdAt: skill?._creationTime,
          isDelisted: skill?.isDelisted ?? false,
          hasContentFetchError: skill?.hasContentFetchError ?? false,
        };
      }),
    );

    const [creator, stats] = await Promise.all([
      ctx.db.get(bundle.userId),
      ctx.db
        .query("bundleStats")
        .withIndex("by_bundleId", (q) => q.eq("bundleId", bundle._id))
        .unique(),
    ]);

    // Resolve fork lineage
    let forkedFromInfo: { urlId: string; name: string; creatorName: string } | undefined;
    if (bundle.forkedFrom) {
      const parent = await ctx.db.get(bundle.forkedFrom);
      if (parent) {
        const parentCreator = await ctx.db.get(parent.userId);
        forkedFromInfo = {
          urlId: parent.urlId,
          name: parent.name,
          creatorName: parentCreator?.name ?? "Anonymous",
        };
      }
    }

    return {
      _id: bundle._id,
      name: bundle.name,
      urlId: bundle.urlId,
      isPublic: bundle.isPublic,
      createdAt: bundle.createdAt,
      skills: skillsWithData,
      creatorName: creator?.name ?? "Anonymous",
      isOwner,
      shareToken: isOwner ? bundle.shareToken : undefined,
      forkedFrom: forkedFromInfo,
      viewCount: stats?.viewCount ?? 0,
      copyCount: stats?.copyCount ?? 0,
      forkCount: stats?.forkCount ?? 0,
    };
  },
});

export const listByUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const bundles = await ctx.db
      .query("bundles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();

    return Promise.all(
      bundles.map(async (bundle) => {
        const stats = await ctx.db
          .query("bundleStats")
          .withIndex("by_bundleId", (q) => q.eq("bundleId", bundle._id))
          .unique();

        return {
          ...bundle,
          viewCount: stats?.viewCount ?? 0,
          copyCount: stats?.copyCount ?? 0,
          forkCount: stats?.forkCount ?? 0,
        };
      }),
    );
  },
});

export async function enrichBundle(
  ctx: QueryCtx,
  bundle: {
    _id: ReturnType<typeof v.id<"bundles">>["type"];
    name: string;
    urlId: string;
    skills: Array<{ source: string; skillId: string; addedAt?: number }>;
    createdAt: number;
    userId: ReturnType<typeof v.id<"users">>["type"];
    forkedFrom?: ReturnType<typeof v.id<"bundles">>["type"];
  },
) {
  const [creator, stats] = await Promise.all([
    ctx.db.get(bundle.userId),
    ctx.db
      .query("bundleStats")
      .withIndex("by_bundleId", (q) => q.eq("bundleId", bundle._id))
      .unique(),
  ]);

  return {
    _id: bundle._id,
    name: bundle.name,
    urlId: bundle.urlId,
    skillCount: bundle.skills.length,
    createdAt: bundle.createdAt,
    creatorName: creator?.name ?? "Anonymous",
    creatorImage: creator?.image,
    forkedFrom: bundle.forkedFrom,
    viewCount: stats?.viewCount ?? 0,
    copyCount: stats?.copyCount ?? 0,
    forkCount: stats?.forkCount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Paginated public bundles (for explore page infinite scroll)
// ---------------------------------------------------------------------------

export const listPublicPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { paginationOpts }) => {
    const result = await ctx.db
      .query("bundles")
      .withIndex("by_public_createdAt", (q) => q.eq("isPublic", true))
      .order("desc")
      .paginate(paginationOpts);

    const enriched = await Promise.all(
      result.page.map((bundle) => enrichBundle(ctx, bundle)),
    );

    return {
      ...result,
      page: enriched,
    };
  },
});

export const searchPublic = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { query, limit = 20 }) => {
    const results = await ctx.db
      .query("bundles")
      .withSearchIndex("search_name", (q) =>
        q.search("name", query).eq("isPublic", true),
      )
      .take(limit);

    return Promise.all(results.map((bundle) => enrichBundle(ctx, bundle)));
  },
});

// ---------------------------------------------------------------------------
// Fork a bundle
// ---------------------------------------------------------------------------

export const forkBundle = mutation({
  args: {
    bundleId: v.id("bundles"),
    name: v.optional(v.string()),
  },
  handler: async (ctx, { bundleId, name }) => {
    const user = await getCurrentUserOrThrow(ctx);
    const { limits } = await getUserPlanWithLimits(ctx);

    const bundleCount = await countUserBundles(ctx, user._id);
    if (bundleCount >= limits.maxBundles) {
      throw new Error("Bundle limit reached. Upgrade to Pro for unlimited bundles.");
    }

    const source = await ctx.db.get(bundleId);
    if (!source) throw new Error("Bundle not found");

    // Must be public or owned by user
    if (!source.isPublic && source.userId !== user._id) {
      throw new Error("Cannot fork a private bundle");
    }

    const urlId = await ensureUniqueUrlId(ctx);
    const now = Date.now();

    const newBundleId = await ctx.db.insert("bundles", {
      userId: user._id,
      name: name ?? `${source.name} (fork)`,
      urlId,
      skills: source.skills.map((s) => ({
        source: s.source,
        skillId: s.skillId,
        addedAt: now,
      })),
      isPublic: true,
      forkedFrom: bundleId,
      createdAt: now,
    });

    // Record fork event on the source bundle
    await ctx.db.insert("bundleEvents", {
      bundleId,
      eventType: "fork",
      userId: user._id,
      createdAt: now,
    });

    // Update source bundle stats
    const stats = await ctx.db
      .query("bundleStats")
      .withIndex("by_bundleId", (q) => q.eq("bundleId", bundleId))
      .unique();

    if (stats) {
      await ctx.db.patch(stats._id, {
        forkCount: stats.forkCount + 1,
        lastEventAt: now,
      });
    } else {
      await ctx.db.insert("bundleStats", {
        bundleId,
        viewCount: 0,
        copyCount: 0,
        forkCount: 1,
        recentCopyCount: 0,
        lastEventAt: now,
      });
    }

    return { bundleId: newBundleId, urlId };
  },
});

