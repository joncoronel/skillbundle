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
  MAX_BUNDLES_PER_USER,
  watchKey,
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

/**
 * How many distinct skills this user watches, across every bundle.
 *
 * Distinct on `source::skillId`, and optionally ignoring one bundle — the
 * caller is usually about to replace that bundle's contents, so counting its
 * current skills would charge the user twice for the ones they are keeping.
 *
 * This replaced a bundle counter. Capping bundles capped ORGANISATION: two tidy
 * lists cost more than one messy one, which is a rule about filing rather than
 * about how much someone depends on the product.
 */
async function watchedSkillKeys(
  // QueryCtx, not MutationCtx, so the read-side query below shares this exact
  // loop. It was retyped verbatim 480 lines away, and the dashboard had a third
  // copy client-side — three implementations of the number the whole plan
  // re-cut meters on, and three chances for the enforced count, the preempt and
  // the displayed count to disagree.
  ctx: QueryCtx,
  userId: Id<"users">,
  ignoreBundleId?: Id<"bundles">,
): Promise<Set<string>> {
  const bundles = await ctx.db
    .query("bundles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect();

  const keys = new Set<string>();
  for (const b of bundles) {
    if (ignoreBundleId && b._id === ignoreBundleId) continue;
    for (const sk of b.skills) keys.add(watchKey(sk));
  }
  return keys;
}

/**
 * Throw if adding `incoming` would push the user past their watch limit.
 *
 * Counts the UNION, so re-adding a skill already watched in another bundle is
 * free — the limit is on distinct skills watched, and someone filing the same
 * dependency in two lists has not started depending on more things.
 */
function assertWatchLimit(
  existing: Set<string>,
  incoming: Array<{ source: string; skillId: string }>,
  maxWatchedSkills: number,
) {
  if (!Number.isFinite(maxWatchedSkills)) return;

  const union = new Set(existing);
  for (const sk of incoming) union.add(watchKey(sk));
  if (union.size <= maxWatchedSkills) return;

  throw new ConvexError(
    `That would put you at ${union.size} watched skills; the free plan covers ${maxWatchedSkills}. ` +
      `Upgrade to Pro to watch as many as you like.`,
  );
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

    // Plan limits last, after the request has been shown to be well-formed. A
    // malformed request should be told it is malformed rather than sold an
    // upgrade — and this ordering keeps the cheap local checks ahead of a read
    // over every bundle the user owns.
    const { limits } = await getUserPlanWithLimits(ctx);

    // Not a plan gate — see `MAX_BUNDLES_PER_USER`. An empty bundle passes
    // every other check for free, so without this nothing bounded row creation
    // at all, and each row multiplies the dashboard feed's fan-out.
    const existingBundles = await ctx.db
      .query("bundles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();
    if (existingBundles.length >= MAX_BUNDLES_PER_USER) {
      throw new ConvexError(
        `You already have ${existingBundles.length} bundles, which is the maximum. Delete one to make room.`,
      );
    }

    const existingKeys = new Set<string>();
    for (const b of existingBundles) {
      for (const sk of b.skills) existingKeys.add(watchKey(sk));
    }
    assertWatchLimit(existingKeys, skills, limits.maxWatchedSkills);

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
    //
    // `updatedAt` is NOT optional here, though it looks like a no-op field on a
    // boolean flip. The bundle page builds its OG image URL as
    // `/bundle/:id/og/:updatedAt` (page.tsx), so this timestamp IS the social
    // card's cache key, and the card is cached for a day fresh plus a day
    // stale-while-revalidate on top of a `cacheLife("days")` data-cache entry.
    // Without the stamp:
    //   - closing a bundle does not revoke its card, so everyone holding the
    //     link — precisely the people just cut off — keeps seeing its name,
    //     description and skill count for ~48h; and
    //   - opening one does not publish its card either, because the generic
    //     brand fallback cached at `createdAt` stays on the same URL.
    // The one-link model made this load-bearing: this switch is now the only
    // privacy control AND the only share control. Every sibling mutation
    // already stamps the clock; this one was the anomaly.
    await ctx.db.patch(bundleId, { isPublic, updatedAt: Date.now() });
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

    // This bundle's own skills are excluded from the baseline, because `skills`
    // REPLACES them — counting both would bill the user twice for every skill
    // they are keeping, and make a pure removal fail the check.
    const { limits } = await getUserPlanWithLimits(ctx);
    assertWatchLimit(
      await watchedSkillKeys(ctx, user._id, bundleId),
      skills,
      limits.maxWatchedSkills,
    );

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
// check no longer reads them, and `migrateOneLinkModel` closed every
// bundle so nothing is unintentionally reachable by an old URL.

/**
 * Stamp "the owner has now seen this bundle", clearing its unread state.
 *
 * Called from the bundle page, but only once its change query has RESOLVED.
 *
 * This was withdrawn once and the reason still governs the wiring. It fired on
 * page view while the page was a card grid that named no changes, so opening a
 * bundle cleared every changed skill from the dashboard panel including ones
 * the reader never saw. Marking something read that was never shown is the one
 * thing a monitoring product cannot do.
 *
 * The register earns the stamp by displaying each change inline — but only
 * after `listChangesForBundle` answers, which is why the caller's effect is
 * gated on that query rather than on mount (bundle-view.tsx). The register
 * itself is unaffected by the stamp: it baselines on `addedAt`, not on the last
 * visit, so the page cannot erase its own contents.
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

/*
 * `listUnreadCounts` used to live here and has been deleted.
 *
 * Nothing outside its own test ever called it, and it implemented "changed
 * since baseline" as a bare `contentUpdatedAt > baseline` — which counts
 * baseline archive rows, ignores audit regressions and ignores delisting. That
 * is a DIFFERENT answer from `resolveSkillChange` in skillVersions.ts, which
 * drives both surfaces a user actually reads. Shipped, validator-typed and
 * tested, it read as load-bearing to the next person, who would wire it into a
 * badge and get numbers contradicting the page beside it.
 *
 * If a per-bundle unread badge is wanted, derive it from `resolveSkillChange`
 * so there is one definition of "changed".
 */

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

/**
 * The distinct skills this user watches, as `source::skillId` keys.
 *
 * Returns the KEYS, not just a count, because the client-side "you're at your
 * limit" preempt has to answer the same question the server does — and the
 * server unions the incoming skills against these (`assertWatchLimit`), so
 * re-filing skills you already watch is free. A bare count forced both call
 * sites to hard-block at exactly the limit, which showed an upgrade banner in
 * place of the form for an operation that would have succeeded.
 *
 * The server still enforces on write; this only exists so the UI can swap in an
 * upgrade prompt instead of letting someone fill a form in and fail at submit.
 */
export const listWatchedSkillKeys = query({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    return Array.from(await watchedSkillKeys(ctx, user._id));
  },
});

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

            // No `updatedSinceAdded` / `changedSinceViewed` here any more. Both
            // were computed per skill and read by nothing: the register renders
            // neither, and their only former consumer (skill-card) no longer
            // renders on this page. Worse, they derived from the FAT skills row
            // while `resolveSkillChange` reads the `skillSummaries` mirror, so
            // the two sources could hold different histories — a third,
            // divergent definition of "changed" sitting in a shipped validator.
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
