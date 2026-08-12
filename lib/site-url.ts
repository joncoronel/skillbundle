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
 * Deliberately dependency-free (no `server-only`) so client and server modules
 * can share it. `NEXT_PUBLIC_SITE_URL` is inlined at build time; the other two
 * branches only ever evaluate on the server.
 */
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
