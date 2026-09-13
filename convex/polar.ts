import { Polar } from "@convex-dev/polar";
import { v } from "convex/values";
import { api, components, internal } from "./_generated/api";
import { action, internalAction, query } from "./_generated/server";
import { DataModel, Id } from "./_generated/dataModel";
import { parseCheckoutRequest } from "./lib/checkout";

// Product IDs are read from env so each environment uses its own Polar
// products without hardcoding: dev/local → sandbox IDs, prod → production IDs.
// Set POLAR_PRO_MONTHLY_PRODUCT_ID / POLAR_PRO_YEARLY_PRODUCT_ID on each Convex
// deployment. The frontend mirrors these as NEXT_PUBLIC_* in pricing-content.tsx.
const products = {
  proMonthly: process.env.POLAR_PRO_MONTHLY_PRODUCT_ID!,
  proYearly: process.env.POLAR_PRO_YEARLY_PRODUCT_ID!,
};

export const getUserInfo = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("User must be logged in to manage subscriptions");
    }
    const user = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
      .unique();
    if (!user) {
      throw new Error("User not found");
    }
    if (!user.email) {
      throw new Error("User email is required for billing");
    }
    return { userId: user._id, email: user.email };
  },
});

export const polar: Polar<DataModel, typeof products> = new Polar(
  components.polar,
  {
    getUserInfo: async (ctx) => {
      return await ctx.runQuery(api.polar.getUserInfo);
    },
    products,
  },
);

// NOTHING here comes from `polar.api()`, deliberately. That object is a set of
// ready-made public functions, and two of them are unsafe to expose:
// `generateCheckoutLink` lets the caller choose a free trial (see
// convex/lib/checkout.ts), and `changeCurrentSubscription` accepts any product
// in the Polar org. The rest were unused. The two actions the app calls are
// written out below instead, so each one's arguments and limits are visible.

// Both count against the caller's `billing` limit (rateLimits.ts): Polar's API
// limit is org-wide, so a loop on either could block everyone's checkout.
type UserInfo = { userId: Id<"users">; email: string };

// Replaces the component's `generateCheckoutLink`; called from
// `ProCheckoutButton` in app/(main)/pricing/pricing-cards.tsx. The validator
// takes only a product id and the two URLs, so a caller adding `trialInterval`,
// `metadata` or `subscriptionId` fails validation.
export const generateCheckoutLink = action({
  args: {
    productIds: v.array(v.string()),
    origin: v.string(),
    successUrl: v.string(),
  },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, args) => {
    const { productId, origin, successUrl } = parseCheckoutRequest(args, [
      products.proMonthly,
      products.proYearly,
    ]);
    const { userId, email }: UserInfo = await ctx.runQuery(
      api.polar.getUserInfo,
    );
    await ctx.runMutation(internal.rateLimits.enforce, {
      checks: [{ name: "billing", key: userId }],
    });
    const { url } = await polar.createCheckoutSession(ctx, {
      productIds: [productId],
      userId,
      email,
      origin,
      successUrl,
    });
    return { url };
  },
});

// Same as the component's `generateCustomerPortalUrl`, plus the billing limit.
export const generateCustomerPortalUrl = action({
  args: {},
  returns: v.object({ url: v.string() }),
  handler: async (ctx): Promise<{ url: string }> => {
    const { userId }: UserInfo = await ctx.runQuery(api.polar.getUserInfo);
    await ctx.runMutation(internal.rateLimits.enforce, {
      checks: [{ name: "billing", key: userId }],
    });
    return await polar.createCustomerPortalSession(ctx, { userId });
  },
});

// Manually backfill the component's product cache from the Polar API. The
// product.created/updated webhook normally keeps this in sync, but if products
// existed before the webhook was capturing events the cache is empty, which
// makes getCurrentSubscription throw "Product not found" when resolving a
// subscription's product. internalAction so it isn't publicly callable but
// stays runnable from the CLI:
//   npx convex run polar:syncProducts --prod
export const syncProducts = internalAction({
  args: {},
  handler: async (ctx) => {
    await polar.syncProducts(ctx);
  },
});
