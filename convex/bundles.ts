import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getCurrentUser, getCurrentUserOrThrow } from "./users";
import { getUserPlanWithLimits } from "./lib/plans";
import {
  MAX_BUNDLE_DESCRIPTION_LENGTH,
  MAX_BUNDLE_SKILLS,
} from "../lib/bundle-limits";

// ---------------------------------------------------------------------------
// URL ID helpers
// ---------------------------------------------------------------------------

const ID_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// 62 doesn't divide 256, so use % with a slight bias — acceptable here.
function randomId(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join("");
}

function generateUrlId(length = 10): string {
  return randomId(length);
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

/**
 * Verifies every `(source, skillId)` pair points at a real row in the
 * `skills` table. Used by the surfaces that accept user-supplied skill
 * arrays (`createBundle`, `updateBundleSkills`) to keep ghost references
 * out of the bundles table.
 *
 * Lookups run in parallel via the `by_source_skillId` index. The
 * caller can pass duplicates safely; we dedupe by `${source}::${skillId}`
 * before querying so the worst case is one query per unique skill.
 */
async function assertSkillsExist(
  ctx: MutationCtx,
  skills: Array<{ source: string; skillId: string }>,
) {
  const uniqueByKey = new Map<string, { source: string; skillId: string }>();
  for (const s of skills) {
    uniqueByKey.set(`${s.source}::${s.skillId}`, s);
  }
  const unique = Array.from(uniqueByKey.values());
  if (unique.length === 0) return;

  const results = await Promise.all(
    unique.map((s) =>
      ctx.db
        .query("skills")
        .withIndex("by_source_skillId", (q) =>
          q.eq("source", s.source).eq("skillId", s.skillId),
        )
        .unique(),
    ),
  );

  const missing: string[] = [];
  for (let i = 0; i < unique.length; i++) {
    if (results[i] === null) {
      missing.push(`${unique[i].source}/${unique[i].skillId}`);
    }
  }

  if (missing.length > 0) {
    // Cap the listed names to avoid a huge error payload when a client
    // sends a large bogus array.
    const sample = missing.slice(0, 5).join(", ");
    const tail = missing.length > 5 ? `, +${missing.length - 5} more` : "";
    throw new ConvexError(
      `Unknown skill${missing.length > 1 ? "s" : ""}: ${sample}${tail}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const createBundle = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    skills: v.array(
      v.object({
        source: v.string(),
        skillId: v.string(),
      }),
    ),
  },
  // No visibility argument. A bundle is the set of skills you depend on, so it
  // starts closed and opening it is a deliberate, reversible act on the bundle
  // page. Creation is not the moment to ask.
  handler: async (ctx, { name, description, skills }) => {
    const user = await getCurrentUserOrThrow(ctx);
    const { limits } = await getUserPlanWithLimits(ctx);

    const bundleCount = await countUserBundles(ctx, user._id);
    if (bundleCount >= limits.maxBundles) {
      throw new ConvexError("Bundle limit reached. Upgrade to Pro for unlimited bundles.");
    }

    // Defense-in-depth: the client form gates on `name.trim()` before
    // submitting, but the server has to defend too — a direct call via
    // the Convex dashboard or a custom client would otherwise be able to
    // insert empty/whitespace-only names. Matches updateBundleName.
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new ConvexError("Name cannot be empty");
    }

    const trimmedDescription = description?.trim();
    if (
      trimmedDescription !== undefined &&
      trimmedDescription.length > MAX_BUNDLE_DESCRIPTION_LENGTH
    ) {
      throw new ConvexError(
        `Description must be ${MAX_BUNDLE_DESCRIPTION_LENGTH} characters or fewer.`,
      );
    }

    if (skills.length > MAX_BUNDLE_SKILLS) {
      throw new ConvexError(
        `Bundles are limited to ${MAX_BUNDLE_SKILLS} skills (got ${skills.length}).`,
      );
    }
    await assertSkillsExist(ctx, skills);

    const urlId = await ensureUniqueUrlId(ctx);

    const now = Date.now();
    const bundleId = await ctx.db.insert("bundles", {
      userId: user._id,
      name: trimmedName,
      description:
        trimmedDescription && trimmedDescription.length > 0
          ? trimmedDescription
          : undefined,
      urlId,
      skills: skills.map((s) => ({ ...s, addedAt: now })),
      isPublic: false,
      createdAt: now,
      // Stamp updatedAt on insert so every row has it from day one. Without
      // this, new bundles have `updatedAt: undefined` until their first
      // patch, which would force any future index/sort on `updatedAt` to
      // either filter out `undefined` or backfill legacy rows.
      updatedAt: now,
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
      throw new ConvexError("Bundle not found or unauthorized");
    }

    // No plan gate. Closed is the default now, so charging for it would be
    // charging for the default; `canMakePrivate` is dead here and the pricing
    // rewrite (TODO.md) removes it.
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
      throw new ConvexError("Bundle not found or unauthorized");
    }

    const trimmed = name.trim();
    if (!trimmed) {
      throw new ConvexError("Name cannot be empty");
    }

    await ctx.db.patch(bundleId, { name: trimmed, updatedAt: Date.now() });
  },
});

export const updateBundleDescription = mutation({
  args: {
    bundleId: v.id("bundles"),
    description: v.string(),
  },
  handler: async (ctx, { bundleId, description }) => {
    const user = await getCurrentUserOrThrow(ctx);
    const bundle = await ctx.db.get(bundleId);

    if (!bundle || bundle.userId !== user._id) {
      throw new ConvexError("Bundle not found or unauthorized");
    }

    const trimmed = description.trim();
    if (trimmed.length > MAX_BUNDLE_DESCRIPTION_LENGTH) {
      throw new ConvexError(
        `Description must be ${MAX_BUNDLE_DESCRIPTION_LENGTH} characters or fewer.`,
      );
    }

    await ctx.db.patch(bundleId, {
      description: trimmed.length === 0 ? undefined : trimmed,
      updatedAt: Date.now(),
    });
  },
});

// Single bulk mutation for add/remove/reorder. The caller submits the final
// skill list; we dedupe by (source, skillId) keeping the first occurrence,
// preserve `addedAt` for skills already in the bundle, and stamp `addedAt`
// on new entries.
export const updateBundleSkills = mutation({
  args: {
    bundleId: v.id("bundles"),
    skills: v.array(
      v.object({
        source: v.string(),
        skillId: v.string(),
      }),
    ),
  },
  handler: async (ctx, { bundleId, skills }) => {
    const user = await getCurrentUserOrThrow(ctx);
    const bundle = await ctx.db.get(bundleId);

    if (!bundle || bundle.userId !== user._id) {
      throw new ConvexError("Bundle not found or unauthorized");
    }

    if (skills.length > MAX_BUNDLE_SKILLS) {
      throw new ConvexError(
        `Bundles are limited to ${MAX_BUNDLE_SKILLS} skills (got ${skills.length}).`,
      );
    }
    await assertSkillsExist(ctx, skills);

    const existingByKey = new Map(
      bundle.skills.map((s) => [`${s.source}::${s.skillId}`, s]),
    );

    const now = Date.now();
    const seen = new Set<string>();
    const nextSkills: typeof bundle.skills = [];

    for (const s of skills) {
      const key = `${s.source}::${s.skillId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const prior = existingByKey.get(key);
      nextSkills.push({
        source: s.source,
        skillId: s.skillId,
        addedAt: prior?.addedAt ?? now,
      });
    }

    await ctx.db.patch(bundleId, {
      skills: nextSkills,
      updatedAt: now,
    });

    return { skillCount: nextSkills.length };
  },
});

// REMOVED: `generateShareToken` / `revokeShareToken`.
//
// A share token was a SECOND URL for a bundle whose first URL was closed —
// two links to one thing, with different rules, and the owner had to know
// which one they had copied. Sharing is now one link (the bundle's own) and
// one switch (`updateBundleVisibility`). Existing tokens are dead: the access
// check no longer reads them, and `migrateCloseAllBundles` closed every
// bundle so nothing is unintentionally reachable by an old URL.

/**
 * Stamp "the owner has now seen this bundle", clearing its unread state.
 *
 * CURRENTLY UNCALLED. It was built to fire on bundle page view, and briefly did,
 * but that stamps the whole bundle read the moment you open it — clearing every
 * changed skill from the dashboard panel including the ones you never looked at,
 * because the bundle page still lists skills rather than showing what changed
 * about them. Marking something read that was never shown is the one thing a
 * monitoring product cannot do, so the call came back out. Restore it as part of
 * the bundle-page redesign, once the page surfaces what it would acknowledge.
 *
 * Every rejection path is a SILENT no-op rather than a throw, because the
 * intended caller is a page view: the bundle page is reachable signed-out and by
 * share link, so throwing would spray console errors across entirely legitimate
 * visits, and there is nothing to protect — the worst a bad call can do is fail
 * to record a timestamp.
 *
 * Owner-only by design. A share-link visitor marking someone else's bundle read
 * would silently destroy that person's unread state from across the internet.
 */
export const markBundleViewed = mutation({
  args: { bundleId: v.id("bundles") },
  returns: v.null(),
  handler: async (ctx, { bundleId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const bundle = await ctx.db.get(bundleId);
    if (!bundle || bundle.userId !== user._id) return null;

    await ctx.db.patch(bundleId, { lastViewedAt: Date.now() });
    return null;
  },
});

/**
 * Clear the whole dashboard feed in one action.
 *
 * The feed spans bundles, so it needs a clearing action that does too —
 * otherwise the only way to dismiss a change is to open the bundle that
 * contains it, and a feed you cannot acknowledge is a feed that is always full.
 *
 * Stamps one timestamp across every bundle rather than per-row read state,
 * which keeps this a patch of N small rows and matches how the baseline is
 * already computed everywhere else (`max(lastViewedAt, addedAt)`). The cost is
 * that it is all-or-nothing; a per-skill dismissal would need its own table and
 * is not worth one yet.
 */
export const markAllBundlesViewed = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const bundles = await ctx.db
      .query("bundles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();

    const now = Date.now();
    await Promise.all(
      bundles.map((b) => ctx.db.patch(b._id, { lastViewedAt: now })),
    );
    return null;
  },
});

/**
 * Per-bundle "how much changed since you last looked", for the dashboard.
 *
 * Reads `skillSummaries` (~200 B) rather than `skills` (~13 KB) purely for this:
 * a user with ten bundles of twenty skills would otherwise pull ~2.6 MB to
 * render a set of small badges. `contentUpdatedAt` is mirrored onto the summary
 * to make that possible.
 *
 * Counts SKILLS, not changes. "3 skills changed" is the number a person can act
 * on; "7 changes across 3 skills" is trivia that makes the badge worse.
 */
export const listUnreadCounts = query({
  args: {},
  returns: v.array(
    v.object({
      bundleId: v.id("bundles"),
      urlId: v.string(),
      name: v.string(),
      unreadCount: v.number(),
      skillCount: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const bundles = await ctx.db
      .query("bundles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();

    return await Promise.all(
      bundles.map(async (bundle) => {
        const summaries = await Promise.all(
          bundle.skills.map((s) =>
            ctx.db
              .query("skillSummaries")
              .withIndex("by_source_skillId", (q) =>
                q.eq("source", s.source).eq("skillId", s.skillId),
              )
              .unique(),
          ),
        );

        let unreadCount = 0;
        bundle.skills.forEach((s, i) => {
          const updated = summaries[i]?.contentUpdatedAt;
          // Same baseline rule as the bundle page: later of the last visit and
          // the moment this skill joined, so a freshly added skill does not
          // arrive pre-marked unread by its own back catalogue.
          const baseline = Math.max(bundle.lastViewedAt ?? 0, s.addedAt ?? 0);
          if (updated !== undefined && updated > baseline) unreadCount++;
        });

        return {
          bundleId: bundle._id,
          urlId: bundle.urlId,
          name: bundle.name,
          unreadCount,
          skillCount: bundle.skills.length,
        };
      }),
    );
  },
});

export const deleteBundle = mutation({
  args: { bundleId: v.id("bundles") },
  handler: async (ctx, { bundleId }) => {
    const user = await getCurrentUserOrThrow(ctx);
    const bundle = await ctx.db.get(bundleId);

    if (!bundle || bundle.userId !== user._id) {
      throw new ConvexError("Bundle not found or unauthorized");
    }

    // A bundle owns no child rows any more — the stats row and the scheduled
    // paginated star cleanup both went with the social teardown — so this is a
    // single delete rather than a fan-out.
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
  args: { urlId: v.string() },
  handler: async (ctx, { urlId }) => {
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

    // One link, one rule: the bundle's own URL works for everyone or for
    // nobody but the owner. There is no second token-bearing URL to reason
    // about, which is the whole point of the one-link model.
    if (!bundle.isPublic && !isOwner) return null;

    // Layer 2: every remaining read is independent given (bundle, currentUser).
    // Parallelize: skills, creator, forked-from chain.
    const [skillsWithData, creator, forkedFromInfo] =
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

            // "New since you last opened this bundle", the read-state half of
            // the same signal. Distinct from `updatedSinceAdded` above, which is
            // permanent ("this moved at some point after you added it") — this
            // one clears when the owner actually looks.
            //
            // The baseline takes whichever is LATER of the last visit and the
            // moment the skill joined the bundle. Using lastViewedAt alone would
            // present a skill added five minutes ago as carrying months of
            // unread history; using addedAt alone would never clear.
            const unreadSince = Math.max(
              bundle.lastViewedAt ?? 0,
              addedAt ?? 0,
            );
            const changedSinceViewed =
              contentUpdatedAt !== undefined && contentUpdatedAt > unreadSince;

            return {
              source: s.source,
              skillId: s.skillId,
              // Returned, not just used locally above: the register shows when
              // each skill joined, and omitting it left that column reading
              // "—" for every row of every bundle, forever.
              addedAt,
              name: skill?.name ?? s.skillId,
              description: skill?.description,
              installs: skill?.installs ?? 0,
              updatedSinceAdded,
              changedSinceViewed,
              contentUpdatedAt: skill?.contentUpdatedAt,
              createdAt: skill?._creationTime,
              isDelisted: skill?.isDelisted ?? false,
              hasContentFetchError: skill?.hasContentFetchError ?? false,
              // Drives the inline verified-publisher mark on bundle cards.
              curatedOwner: skill?.curatedOwner,
              // Drives the audit-status text in the bundle card's footer
              // ("Review · MEDIUM" / "Risk · CRITICAL") for skills whose
              // audit verdict came back warn or fail.
              worstAuditStatus: skill?.worstAuditStatus,
              worstAuditRiskLevel: skill?.worstAuditRiskLevel,
            };
          }),
        ),
        ctx.db.get(bundle.userId),
        // Fork lineage chain stays internally serial (parent → parent's
        // creator) but runs in parallel with everything else. Forking itself is
        // gone, but rows created before the teardown still carry `forkedFrom`,
        // and dropping the attribution would misrepresent whose work it was.
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
      ]);

    return {
      _id: bundle._id,
      name: bundle.name,
      description: bundle.description,
      urlId: bundle.urlId,
      isPublic: bundle.isPublic,
      createdAt: bundle.createdAt,
      updatedAt: bundle.updatedAt,
      skills: skillsWithData,
      creatorName: creator?.name ?? "Anonymous",
      isOwner,
      // Owner-only: a share-link visitor has no read state of their own here,
      // and exposing the owner's would leak when they last looked at it.
      lastViewedAt: isOwner ? bundle.lastViewedAt : undefined,
      forkedFrom: forkedFromInfo,
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

    return bundles;
  },
});

// REMOVED: `enrichBundle`, `listExplore`, `searchPublic`, `forkBundle`,
// `setBundleFeatured`, `listFeatured`.
//
// Every one of them existed to browse, rank, or copy OTHER people's bundles on
// the /explore page. That page is gone: a directory of community bundles is a
// discovery surface, and discovery here is the skill catalog, not a leaderboard
// of strangers' folders. Bundles are private working sets now.

// The one-link migration (`migrateOneLinkModel`) lived here and is gone: it ran
// on dev and prod in Aug 2026, closing every bundle created under the old
// public-by-default rule and stripping `shareToken` / `featuredAt`. It could not
// outlive the fields it removed — a mutation cannot reference a field the schema
// no longer declares — which is the natural end of a migration's life once it
// has run everywhere. `git log` has it if a new deployment ever needs it.
