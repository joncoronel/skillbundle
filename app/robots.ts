import type { MetadataRoute } from "next";

/**
 * Crawler guidance. The site had none before this, which matters more here than
 * on a typical app: the catalog is ~9.5k skill pages, each one rendered on
 * demand and cached per `'use cache'` entry, so an unguided crawl is a direct
 * bill item (Vercel ISR writes) rather than just load.
 *
 * Deliberately still permissive on the catalog itself. Organic search is the
 * discovery path for this product, so `/[org]`, `/[org]/[repo]` and the skill
 * pages stay fully crawlable. What's blocked is the stuff that is either
 * private, useless to index, or unbounded.
 *
 * **Every private route below is anchored, and that is load-bearing.**
 * robots.txt paths are PREFIX matches — only `*` and `$` are special — and
 * `/[org]` is a root-level single-segment route, so a bare `Disallow: /dev`
 * would also block `/devcontainers`, `/developit` and every other org slug
 * starting "dev". `Allow: /` does not rescue them: longest-match-wins hands the
 * 4-character disallow priority over the 1-character allow. So each private
 * route is written as a pair — `/x$` for the route itself, `/x/` for anything
 * beneath it. (`proxy.ts` documents the same root-catch-all shadowing hazard
 * for the Clerk matcher, which works around it with `(.*)` patterns.)
 *
 * `Crawl-delay` is ignored by Googlebot (it uses its own budget from Search
 * Console) but honoured by Bing and Yandex, so this throttles the secondary
 * crawlers without costing anything in Google.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        // The two route handlers under /api/: `revalidate` (secret-gated, see
        // app/api/revalidate/route.ts) and `skills-token` (mints a skills.sh
        // token). Neither is a crawl target. This prefix is genuinely a prefix
        // — /api/ is not shadowed by the `/[org]` catch-all, since no org page
        // lives under it.
        "/api/",
        // Private routes — the inverted private-route list in proxy.ts. A
        // crawler hitting them just eats a Clerk redirect. Anchored per the
        // note above; the `/x/` half covers /dev/add-skill and
        // /sign-in/sso-callback.
        "/dashboard$",
        "/dashboard/",
        "/settings$",
        "/settings/",
        "/dev$",
        "/dev/",
        "/sign-in$",
        "/sign-in/",
        "/sign-up$",
        "/sign-up/",
        // The one unbounded URL space on the site. `/compare` carries a
        // `?skills=a,b,c` param (the only multi-value query param in the app,
        // alongside the home page's bounded `?tab`), so the parameterised form
        // is combinatorial over the whole catalog. Needs no anchoring: a
        // literal `?` cannot appear in an org slug, and crawlers match the
        // query string as part of the path. The bare `/compare` is left
        // crawlable on purpose so shared comparison links still resolve for
        // preview fetchers that consult robots.txt.
        "/compare?",
      ],
      crawlDelay: 10,
    },
    // No `sitemap:` line yet — see the sitemap entry in TODO.md. Note that the
    // OG image routes (app/**/opengraph-image.tsx, ~9.5k of them, one per
    // skill) are deliberately NOT blocked: social preview fetchers need them,
    // and they are advertised in every page's `og:image`. They are the most
    // expensive per-request surface in the catalog, so if crawler load on them
    // ever shows up in the bill, throttle it with a per-user-agent rule array
    // rather than a blanket disallow that would break link previews.
  };
}
