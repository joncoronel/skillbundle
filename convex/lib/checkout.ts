/**
 * Validation for the public checkout action in convex/polar.ts.
 *
 * Why it exists: `@convex-dev/polar`'s ready-made `generateCheckoutLink` passes
 * every argument straight to Polar's checkoutsCreate, including
 * `trialInterval` / `trialIntervalCount`. A checkout session's trial overrides
 * the product's, so any signed-in caller could open a Pro checkout with a
 * multi-year free trial from the browser console. Confirmed against the
 * sandbox in Sep 2026: a product with no trial came back with
 * `active_trial_interval: "year"`, `count: 5`, `trial_end` five years out.
 *
 * So the checkout args are an allowlist, not a pass-through. Only a product id
 * and the two URLs `CheckoutLink` sends are accepted; trial, metadata and
 * subscription fields are rejected by the action's validator before this runs.
 */

import { ConvexError } from "convex/values";

const INVALID_CHECKOUT =
  "This checkout link isn't valid. Refresh the page and try again.";

export function parseCheckoutRequest(
  args: { productIds: string[]; origin: string; successUrl: string },
  allowedProductIds: readonly (string | undefined)[],
): { productId: string; origin: string; successUrl: string } {
  const allowed = allowedProductIds.filter((id): id is string => !!id);
  const [productId] = args.productIds;
  if (args.productIds.length !== 1 || !allowed.includes(productId)) {
    throw new ConvexError(INVALID_CHECKOUT);
  }

  const origin = parseSiteUrl(args.origin);
  const successUrl = parseSiteUrl(args.successUrl);
  // The success URL has to be on the page that asked for the checkout, so
  // Polar never redirects a paying customer somewhere else.
  if (!origin || !successUrl || successUrl.origin !== origin.origin) {
    throw new ConvexError(INVALID_CHECKOUT);
  }

  return {
    productId,
    origin: origin.origin,
    successUrl: successUrl.href,
  };
}

// https anywhere, plain http only for local development.
function parseSiteUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === "https:") return url;
  if (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  ) {
    return url;
  }
  return null;
}
