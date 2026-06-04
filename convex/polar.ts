import { Polar } from "@convex-dev/polar";
import { api, components } from "./_generated/api";
import { internalAction, query } from "./_generated/server";
import { DataModel } from "./_generated/dataModel";

// Product IDs from Polar (production). Also referenced in:
// - app/(main)/pricing/pricing-content.tsx (PRO_MONTHLY_PRODUCT_ID)
const products = {
  proMonthly: "648a8fd1-9982-4881-a719-f34b0e809276",
  proYearly: "6dcec0ce-e54d-41b9-a910-9255ea336d43",
} as const;

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

export const {
  changeCurrentSubscription,
  cancelCurrentSubscription,
  getConfiguredProducts,
  listAllProducts,
  listAllSubscriptions,
  generateCheckoutLink,
  generateCustomerPortalUrl,
} = polar.api();

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
