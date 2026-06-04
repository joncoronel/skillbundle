# Polar Launch Checklist

Steps to switch from Polar sandbox to production and go live with billing.

## 1. Polar Production Setup

> **Important:** Create the webhook BEFORE creating products so `product.created` events are captured.

### Create Webhook

1. Go to [polar.sh](https://polar.sh) (production, not sandbox)
2. Navigate to **Settings > Webhooks > Add Webhook**
3. URL: `https://<your-prod-deployment>.convex.site/polar/events`
   - Use your **production** Convex site URL (from `npx convex deploy` / the Convex dashboard), NOT the dev `doting-bee-475` deployment.
4. Enable events:
   - `product.created`
   - `product.updated`
   - `subscription.created`
   - `subscription.updated`
5. Save and copy the **Webhook Secret**

### Create Products

Create 2 products in the Polar dashboard:

| Product Name             | Type               | Price     |
| ------------------------ | ------------------ | --------- |
| SkillBundle Pro Monthly  | Recurring (Monthly)| $8/month  |
| SkillBundle Pro Yearly   | Recurring (Yearly) | $72/year  |

Copy each **Product ID** after creating them.

### Create API Token

1. Go to **Settings > Developers**
2. Click **Create token**
3. Select all scopes, no expiration
4. Copy the token

## 2. Update Convex Environment Variables

Target the **production** deployment with `--prod` (these vars live on Convex, not Vercel):

```bash
npx convex env set --prod POLAR_ORGANIZATION_TOKEN "production-token"
npx convex env set --prod POLAR_WEBHOOK_SECRET "production-secret"
npx convex env set --prod POLAR_SERVER "production"
```

## 3. Product IDs (environment variables, not hardcoded)

Product IDs are read from env vars so sandbox (dev/local) and production each use their
own — nothing to edit in code. `convex/polar.ts` reads `POLAR_PRO_MONTHLY_PRODUCT_ID` /
`POLAR_PRO_YEARLY_PRODUCT_ID`; `app/(main)/pricing/pricing-content.tsx` reads the
`NEXT_PUBLIC_` mirrors. Polar product IDs are UUIDs (e.g. `81f91b1c-…`), not `prod_…`.

Set them in **four** places:

| Location | Vars | Values |
| --- | --- | --- |
| Convex **dev** (`npx convex env set …`) | `POLAR_PRO_MONTHLY_PRODUCT_ID`, `POLAR_PRO_YEARLY_PRODUCT_ID` | sandbox IDs |
| Convex **prod** (`npx convex env set --prod …`) | same two | production IDs |
| `.env.local` | `NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID`, `NEXT_PUBLIC_POLAR_PRO_YEARLY_PRODUCT_ID` | sandbox IDs |
| Vercel (Production scope) | same two `NEXT_PUBLIC_…` | production IDs |

> Set the prod-side vars (Convex prod **and** Vercel) **before deploying** — otherwise
> production checkout resolves `undefined` product IDs. The `NEXT_PUBLIC_` vars are inlined
> at build time, so a Vercel redeploy is required after changing them.

## 4. Decide on Feature Gating

`FEATURE_GATING_ENABLED` in `convex/lib/plans.ts` controls whether Free tier limits are enforced:

- **`true`:** Free users limited to 3 bundles, no private bundles, no GitHub auto-detect
- **`false`:** Everyone gets full access regardless of plan (billing still works)

## 5. Test with 100% Discount Code

1. Create a **100% discount code** in Polar dashboard under **Discounts**
2. Deploy Convex functions: `npx convex deploy`
3. Test the full checkout flow using the discount code (no real money)
4. Verify the webhook fires (`subscription.created`) in the Convex dashboard logs
5. Verify `useUserPlan()` returns the correct plan after checkout

> **Never use real card details for testing.** This violates Polar's payment processor terms and can trigger fraud flags.

## 6. Go Live

1. Hit **Go Live** in the Polar dashboard banner
2. Polar will request ID verification (passport/license + selfie) before your first real payout
3. Account reviews are typically completed within a week

## 7. Deploy

```bash
npx convex deploy    # production Convex deploy
pnpm build           # verify Next.js builds clean
```

Then deploy your Next.js app (Vercel, etc.).

## Switching Back to Sandbox

To revert to sandbox for testing:

```bash
npx convex env set POLAR_ORGANIZATION_TOKEN "sandbox-token"
npx convex env set POLAR_WEBHOOK_SECRET "sandbox-secret"
npx convex env set POLAR_SERVER "sandbox"
```

And swap the product IDs back to sandbox ones in the code.
