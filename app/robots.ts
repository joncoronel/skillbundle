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
        // Route handlers. /api/revalidate is secret-gated and the OG routes are
        // reachable via each page's metadata; neither is a crawl target.
        "/api/",
        // Private routes. These are the inverted private-route list in
        // proxy.ts — a crawler hitting them just eats a Clerk redirect.
        "/dashboard",
        "/settings",
        "/dev",
        "/sign-in",
        "/sign-up",
        // The one unbounded URL space on the site. `/compare` carries a
        // `?skills=a,b,c` param (the only multi-value query param in the app,
        // alongside the home page's bounded `?tab`), so the parameterised form
        // is combinatorial over the whole catalog. The bare page is left
        // crawlable on purpose so shared comparison links still resolve for
        // preview fetchers that consult robots.txt.
        "/compare?",
      ],
      crawlDelay: 10,
    },
  };
}
