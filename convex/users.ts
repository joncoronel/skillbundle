import {
  internalMutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { UserJSON } from "@clerk/backend";
import { v, Validator } from "convex/values";

export const current = query({
  args: {},
  handler: async (ctx) => {
    return await getCurrentUser(ctx);
  },
});

export const upsertFromClerk = internalMutation({
  args: { data: v.any() as Validator<UserJSON> }, // no runtime validation, trust Clerk
  async handler(ctx, { data }) {
    const userAttributes = {
      name:
        [data.first_name, data.last_name].filter(Boolean).join(" ") ||
        "Anonymous",
      email: verifiedPrimaryEmail(data),
      image: data.image_url,
      externalId: data.id,
    };

    const existing = await userByExternalId(ctx, data.id);
    if (existing === null) {
      await ctx.db.insert("users", userAttributes);
    } else {
      await ctx.db.patch(existing._id, userAttributes);
    }
  },
});

/**
 * The primary email, and only if Clerk has verified it.
 *
 * There used to be a fallback to `email_addresses[0]`, which can be an address
 * the user added but never verified. Nothing security-relevant reads the stored
 * value any more: billing (`convex/polar.ts` `getUserInfo`) and the admin
 * checks (`convex/devStats.ts`) read the verified email from the caller's token
 * instead, because rows written before this change keep their old value until
 * Clerk next sends `user.updated`. Storing only a verified address keeps the
 * column honest for anything that reads it later.
 */
export function verifiedPrimaryEmail(data: UserJSON): string | undefined {
  const primary = data.email_addresses?.find(
    (e) => e.id === data.primary_email_address_id,
  );
  return primary?.verification?.status === "verified"
    ? primary.email_address
    : undefined;
}

export const deleteFromClerk = internalMutation({
  args: { clerkUserId: v.string() },
  async handler(ctx, { clerkUserId }) {
    // Keyed on the Clerk id, so it goes even without a users row.
    const quota = await ctx.db
      .query("repoMatchQuota")
      .withIndex("by_subject", (q) => q.eq("subject", clerkUserId))
      .unique();
    if (quota) await ctx.db.delete(quota._id);

    const user = await userByExternalId(ctx, clerkUserId);
    if (user !== null) {
      // A deleted account's bundles go with it. Left behind, a public one
      // stayed reachable at its link, credited to "Anonymous". Bounded by
      // MAX_BUNDLES_PER_USER, so one mutation is enough.
      const bundles = await ctx.db
        .query("bundles")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .collect();
      for (const bundle of bundles) await ctx.db.delete(bundle._id);
      await ctx.db.delete(user._id);
    } else {
      console.warn(
        `Can't delete user, none found for Clerk ID: ${clerkUserId}`,
      );
    }
  },
});

/**
 * The caller's user row, created from their token if the Clerk webhook hasn't
 * landed yet (a new account's first write can beat it). The webhook then
 * patches this row; both check `byExternalId` in a transaction, so there's
 * never a duplicate.
 */
export async function getOrCreateCurrentUser(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) throw new Error("Can't get current user");
  const existing = await userByExternalId(ctx, identity.subject);
  if (existing) return existing;
  const id = await ctx.db.insert("users", {
    name: identity.name || "Anonymous",
    // Same rule as the webhook path: only a verified address is stored.
    email: identity.emailVerified === true ? identity.email : undefined,
    image: identity.pictureUrl,
    externalId: identity.subject,
  });
  return (await ctx.db.get(id))!;
}

export async function getCurrentUserOrThrow(ctx: QueryCtx) {
  const userRecord = await getCurrentUser(ctx);
  if (!userRecord) throw new Error("Can't get current user");
  return userRecord;
}

export async function getCurrentUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    return null;
  }
  return await userByExternalId(ctx, identity.subject);
}

async function userByExternalId(ctx: QueryCtx, externalId: string) {
  return await ctx.db
    .query("users")
    .withIndex("byExternalId", (q) => q.eq("externalId", externalId))
    .unique();
}
