/**
 * The site's public origin, with no trailing slash.
 *
 * Three consumers need the same answer and two of them cannot get it from
 * `metadataBase`: `app/robots.ts` and `app/sitemap.ts` emit plain text and XML,
 * not `<head>` tags, so nothing resolves relative URLs for them — the
 * `Sitemap:` line and every `<loc>` must be absolute or crawlers ignore them.
 * `app/layout.tsx` is the third, and it owns `metadataBase`.
 *
 * The fallback chain, in order:
 *   1. `NEXT_PUBLIC_SITE_URL` — the real domain, set explicitly.
 *   2. `VERCEL_PROJECT_PRODUCTION_URL` — the *production* deployment's domain,
 *      not the per-deploy `VERCEL_URL`. Preview builds resolve this to the
 *      production host on purpose: a preview must never advertise its own
 *      throwaway URL to a crawler.
 *   3. localhost, for dev.
 *
 * `server-only`, and that is a correctness guard rather than a style choice.
 * Only `NEXT_PUBLIC_`-prefixed variables are inlined into the client bundle, so
 * in a Client Component `VERCEL_PROJECT_PRODUCTION_URL` reads `undefined` and
 * this module silently resolves to localhost — the same import returning a
 * different origin depending on where it lands. Nothing imports it from the
 * client today; this makes sure nothing starts.
 */
import "server-only";
import { IS_PRODUCTION_DEPLOYMENT } from "./deployment-env";

const rawSiteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

/**
 * Trailing slash stripped so callers can always write `${SITE_URL}/path`
 * without producing `https://host//path` — which is a distinct URL to a
 * crawler, and would make every sitemap entry a soft duplicate of the page it
 * meant to point at.
 */
export const SITE_URL = rawSiteUrl.replace(/\/+$/, "");

/**
 * Fail the production build rather than ship an inert sitemap.
 *
 * A wrong origin here has no symptom anyone would notice: every page renders
 * normally, and the damage is confined to two files nobody opens — a robots.txt
 * advertising a sitemap on the wrong host, and ~18.7k `<loc>` entries pointing
 * at one. `.env.example` ships `NEXT_PUBLIC_SITE_URL=http://localhost:3000`, so
 * a copied env file is the realistic way it happens, and it would shadow the
 * Vercel fallback that otherwise makes this self-configuring. Nothing in
 * `pnpm check` or the test suite reads this module.
 *
 * Gated on production so local builds, `pnpm build`, and preview deployments are
 * untouched — the check only speaks up where the value is load-bearing. That
 * predicate is shared with `app/sitemap.ts` because both fail silently in the
 * same way if it is wrong; `lib/deployment-env.ts` carries the hazard.
 */
if (IS_PRODUCTION_DEPLOYMENT && !SITE_URL.startsWith("https://")) {
  throw new Error(
    `NEXT_PUBLIC_SITE_URL must be an https origin in production (got "${SITE_URL}"). ` +
      `robots.txt and sitemap.xml embed it absolutely, so a wrong value makes both inert.`,
  );
}
