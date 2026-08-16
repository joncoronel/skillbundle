import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

/**
 * Crawler guidance. The site had none before this, which matters more here than
 * on a typical app: the catalog is ~16k skill pages, each one rendered on
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
    rules: [
      {
        // Blocked outright, not throttled. Measured 2026-08-12 over 24h:
        // amazonbot alone was 755 of ~5.1k total edge requests (15%), semrush
        // another 163 — together ~18% of all traffic, and concentrated on the
        // ~16k skill detail pages, which cache at only 5.3% because traffic
        // that thin over that many URLs means an entry is almost never still
        // alive when the next visitor arrives. So each of those crawls is a
        // cold render.
        //
        // Neither sends referral traffic: amazonbot feeds Amazon's own
        // assistants, SemrushBot feeds an SEO index. Contrast the crawlers left
        // alone below. Deliberately NOT blocking gptbot (47 req, 89% cached) —
        // being known to ChatGPT is a plausible discovery channel for a
        // developer-tool catalog, and the volume is noise either way.
        //
        // Reversible in one line. Note the one real cost: if you ever run a
        // Semrush site audit against this domain, check whether it uses this
        // agent — the audit crawler is usually a different one, but confirm
        // before concluding the tool is broken.
        //
        // Both are verified crawlers in Vercel's dashboard, so they honour
        // this. If that ever stops being true, escalate to a Vercel firewall
        // rule — robots.txt stops the request being made, a firewall rule only
        // stops it reaching a function.
        userAgent: ["Amazonbot", "SemrushBot"],
        disallow: "/",
      },
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          // The two route handlers under /api/: `revalidate` (secret-gated, see
          // app/api/revalidate/route.ts) and `skills-token` (mints a skills.sh
          // token). Neither is a crawl target.
          //
          // This rule is NOT purely a prefix, contrary to what this comment
          // used to claim. `/[org]` is a root-level catch-all and the catalog
          // contains a GitHub org literally named `api` — `api/git`, 8 skills —
          // so this also blocks 9 real catalog pages. They stay blocked for
          // now, and `lib/sitemap-entries.ts` drops them from the sitemap so we
          // are at least not submitting URLs we forbid. If those pages ever
          // matter, the fix is to name the two handlers here rather than to
          // weaken the sitemap filter.
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
    ],
    // Absolute by requirement, not by preference: a `Sitemap:` line is the one
    // part of robots.txt that is not resolved against the host it was served
    // from, so a relative path here is simply ignored. The point of advertising
    // it is the one measured in the block rule above: Googlebot made ONE
    // request to this site in 24h. app/sitemap.ts carries the full argument.
    sitemap: `${SITE_URL}/sitemap.xml`,
    // Note that the OG image routes (app/**/opengraph-image.tsx, ~16k of them, one per
    // skill) are deliberately NOT blocked: social preview fetchers need them,
    // and they are advertised in every page's `og:image`. They are the most
    // expensive per-request surface in the catalog, so if crawler load on them
    // ever shows up in the bill, throttle it with a per-user-agent rule array
    // rather than a blanket disallow that would break link previews.
  };
}
