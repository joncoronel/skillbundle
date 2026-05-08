import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { getCurrentUser, getCurrentUserOrThrow } from "./users";
import { getUserPlanWithLimits } from "./lib/plans";
import { assertAdmin, checkIsAdminByEmail } from "./devStats";

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

    // Mirror onto bundleStats so the compound public-aware index for
    // most-starred stays accurate. No-op when the stats row doesn't exist.
    const stats = await ctx.db
      .query("bundleStats")
      .withIndex("by_bundleId", (q) => q.eq("bundleId", bundleId))
      .unique();
    if (stats) {
      await ctx.db.patch(stats._id, { isPublic });
    }
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

    // Sync delete of bounded child rows: bundleStats has at most one row per
    // bundle, so .collect() is safe.
    const stats = await ctx.db
      .query("bundleStats")
      .withIndex("by_bundleId", (q) => q.eq("bundleId", bundleId))
      .collect();
    await Promise.all(stats.map((row) => ctx.db.delete(row._id)));

    // Delete the bundle row itself so the user sees it gone immediately.
    await ctx.db.delete(bundleId);

    // bundleStars is unbounded per bundle (one row per starring user). Doing
    // .collect() inline could blow Convex's 16MB / 8K-row caps for a popular
    // bundle. Schedule a paginated internal-action cleanup instead — the
    // mutation returns fast and the action loops in 500-row batches until
    // empty. Brief eventual-consistency window where stars linger is invisible
    // to UI (no surface queries bundleStars by a deleted bundleId).
    await ctx.scheduler.runAfter(
      0,
      internal.bundleStars.cleanupStarsForBundle,
      { bundleId },
    );
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
    // Layer 1: bundle lookup and current user are independent — parallelize.
    const [bundle, currentUser] = await Promise.all([
      ctx.db
        .query("bundles")
        .withIndex("by_urlId", (q) => q.eq("urlId", urlId))
        .unique(),
      getCurrentUser(ctx),
    ]);

    if (!bundle) return null;

    const isOwner = currentUser !== null && currentUser._id === bundle.userId;

    if (!bundle.isPublic) {
      const hasValidToken =
        shareToken !== undefined &&
        bundle.shareToken !== undefined &&
        shareToken === bundle.shareToken;

      if (!isOwner && !hasValidToken) return null;
    }

    // Layer 2: every remaining read is independent given (bundle, currentUser).
    // Parallelize: skills, creator, stats, forked-from chain, viewerHasStarred.
    const [skillsWithData, creator, stats, forkedFromInfo, viewerHasStarred] =
      await Promise.all([
        Promise.all(
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
        ),
        ctx.db.get(bundle.userId),
        ctx.db
          .query("bundleStats")
          .withIndex("by_bundleId", (q) => q.eq("bundleId", bundle._id))
          .unique(),
        // Fork lineage chain stays internally serial (parent → parent's
        // creator) but runs in parallel with everything else.
        bundle.forkedFrom
          ? (async () => {
              const parent = await ctx.db.get(bundle.forkedFrom!);
              if (!parent) return undefined;
              const parentCreator = await ctx.db.get(parent.userId);
              return {
                urlId: parent.urlId,
                name: parent.name,
                creatorName: parentCreator?.name ?? "Anonymous",
              };
            })()
          : Promise.resolve(undefined),
        currentUser !== null
          ? ctx.db
              .query("bundleStars")
              .withIndex("by_user_bundle", (q) =>
                q
                  .eq("userId", currentUser._id)
                  .eq("bundleId", bundle._id),
              )
              .unique()
              .then((star) => star !== null)
          : Promise.resolve(false),
      ]);

    // Viewer admin status — folded into the bundle query so the detail page
    // doesn't need a separate api.devStats.isAdmin round-trip just to gate
    // the FeatureToggleButton. Reuses currentUser.email to avoid a second
    // ctx.auth.getUserIdentity() call (already happened in getCurrentUser).
    // Sync — no DB read, runs after the parallel layer.
    const viewerIsAdmin = checkIsAdminByEmail(currentUser?.email);

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
      copyCount: stats?.copyCount ?? 0,
      forkCount: stats?.forkCount ?? 0,
      starCount: stats?.starCount ?? 0,
      featuredAt: bundle.featuredAt,
      viewerIsAdmin,
      viewerHasStarred,
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
    featuredAt?: number;
    isPublic: boolean;
  },
  // Pass when the caller already has the stats row in scope (e.g. listExplore's
  // starred branch paginates stats directly). Saves the extra by_bundleId
  // lookup per bundle. Typed as the full Doc so it stays in sync with schema
  // changes — partial structural shapes drift silently.
  preloadedStats?: Doc<"bundleStats"> | null,
) {
  const [creator, stats] = await Promise.all([
    ctx.db.get(bundle.userId),
    preloadedStats !== undefined
      ? Promise.resolve(preloadedStats)
      : ctx.db
          .query("bundleStats")
          .withIndex("by_bundleId", (q) => q.eq("bundleId", bundle._id))
          .unique(),
  ]);

  return {
    _id: bundle._id,
    name: bundle.name,
    urlId: bundle.urlId,
    isPublic: bundle.isPublic,
    skillCount: bundle.skills.length,
    createdAt: bundle.createdAt,
    creatorName: creator?.name ?? "Anonymous",
    creatorImage: creator?.image,
    forkedFrom: bundle.forkedFrom,
    copyCount: stats?.copyCount ?? 0,
    forkCount: stats?.forkCount ?? 0,
    starCount: stats?.starCount ?? 0,
    featuredAt: bundle.featuredAt,
  };
}

// ---------------------------------------------------------------------------
// Unified paginated explore query
//
// One entry point for the /explore page's filter row. The grid re-sorts
// by `sort`, the underlying index changes, but the response shape stays
// identical so the React component code path is the same per filter.
// ---------------------------------------------------------------------------

export const listExplore = query({
  args: {
    sort: v.union(v.literal("newest"), v.literal("starred")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { sort, paginationOpts }) => {
    if (sort === "newest") {
      const result = await ctx.db
        .query("bundles")
        .withIndex("by_public_createdAt", (q) => q.eq("isPublic", true))
        .order("desc")
        .paginate(paginationOpts);

      const enriched = await Promise.all(
        result.page.map((bundle) => enrichBundle(ctx, bundle)),
      );
      return { ...result, page: enriched };
    }

    // Most-starred ranks by `bundleStats.starCount`. `isPublic` is denormalized
    // onto stats so the compound index applies the public filter at the index
    // level — no post-pagination trimming on visibility. `.gt("starCount", 0)`
    // skips bundles with no stars at all.
    const statsPage = await ctx.db
      .query("bundleStats")
      .withIndex("by_public_starCount", (q) =>
        q.eq("isPublic", true).gt("starCount", 0),
      )
      .order("desc")
      .paginate(paginationOpts);

    // Pair each stat with its bundle. Defensive null filter below: stats can't
    // legitimately outlive their bundle (deleteBundle removes the stats row
    // before the bundle row, and Convex OCC prevents inserts racing past a
    // deletion), so this filter is effectively dead code — kept as belt-and-
    // suspenders against any future invariant drift.
    const pairs = await Promise.all(
      statsPage.page.map(async (stat) => ({
        stat,
        bundle: await ctx.db.get(stat.bundleId),
      })),
    );

    const enriched = await Promise.all(
      pairs
        .filter(
          (p): p is { stat: (typeof statsPage.page)[number]; bundle: NonNullable<typeof p.bundle> } =>
            p.bundle !== null,
        )
        .map(({ stat, bundle }) => enrichBundle(ctx, bundle, stat)),
    );

    return {
      ...statsPage,
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

    // Update source bundle stats — increment fork counter only.
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
        isPublic: source.isPublic,
        copyCount: 0,
        forkCount: 1,
        starCount: 0,
        lastEventAt: now,
      });
    }

    return { bundleId: newBundleId, urlId };
  },
});

// ---------------------------------------------------------------------------
// Admin: feature / unfeature bundles for the Explore fallback
// ---------------------------------------------------------------------------

export const setBundleFeatured = mutation({
  args: { bundleId: v.id("bundles"), featured: v.boolean() },
  handler: async (ctx, { bundleId, featured }) => {
    // Auth-gated mutation: cheap admin check first, then the DB read. Going
    // parallel would shave ~ms on the success path but waste a db.get on
    // every unauthorized call (and slightly widen attack surface). Serial is
    // the canonical shape for auth-then-act paths.
    await assertAdmin(ctx);
    const bundle = await ctx.db.get(bundleId);
    if (!bundle) throw new Error("Bundle not found");
    if (featured && !bundle.isPublic) {
      throw new Error("Cannot feature a private bundle");
    }
    await ctx.db.patch(bundleId, {
      featuredAt: featured ? Date.now() : undefined,
    });
  },
});

// The editorial Featured section on /explore reads this with the default
// `includePrivate: false`. The /dev management section passes `true` so admin
// can see and unfeature bundles whose owner has since flipped private.
const FEATURED_FETCH_CAP = 50;
export const listFeatured = query({
  args: {
    limit: v.optional(v.number()),
    includePrivate: v.optional(v.boolean()),
  },
  handler: async (ctx, { limit, includePrivate = false }) => {
    if (includePrivate) await assertAdmin(ctx);

    // Cap the requested limit so an arbitrary caller can't force a huge
    // take() + N enrichments. The cap applies on both paths — it's well
    // above any realistic UI need (the public Featured section asks for 3,
    // the /dev management section asks for the default).
    const fetchSize = Math.min(limit ?? FEATURED_FETCH_CAP, FEATURED_FETCH_CAP);

    const bundles = includePrivate
      ? await ctx.db
          .query("bundles")
          .withIndex("by_featured", (q) => q.gt("featuredAt", 0))
          .order("desc")
          .take(fetchSize)
      : await ctx.db
          .query("bundles")
          .withIndex("by_public_featured", (q) =>
            q.eq("isPublic", true).gt("featuredAt", 0),
          )
          .order("desc")
          .take(fetchSize);

    return Promise.all(bundles.map((b) => enrichBundle(ctx, b)));
  },
});

