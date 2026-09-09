import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // The `instant()` helper from @next/playwright drives Next's testing API,
    // which `next dev` exposes automatically but `next start` does not. The e2e
    // suite runs against a production build (Next does no prefetching in dev,
    // so instant() assertions there would be meaningless), hence this gate.
    //
    // Env-gated rather than always-on: the docs show it unconditional, but
    // there's no reason to ship a testing hook to real users. `pnpm e2e` sets
    // E2E=1 for both the build and the server it starts.
    exposeTestingApiInProductionBuild: process.env.E2E === "1",
    // Pin the current framework default. The docs warn this may change in a
    // future release to opt users into stricter validation, and that such a
    // change is NOT considered breaking because the feature is experimental —
    // so leaving it unpinned means a patch bump could flip us to
    // 'experimental-error', which gates `next build` on instant validation.
    //
    // 'warning' validates every navigation in dev without touching the build.
    instantInsights: { validationLevel: "warning" },
    // Tree-shake icon barrels. lucide-react is on Next's default-optimized list
    // already; HugeIcons isn't, and it's imported broadly across the app.
    //
    // Only `@hugeicons/react` is actually reachable by this. The icon package's
    // ESM index is one 6.3 MB file of inline declarations, not a re-export
    // barrel, and Next's barrel loader no-ops on those — the entry below is
    // kept so nobody re-adds it after re-discovering the same thing. Tree
    // shaking still drops the unused icons, so this costs build time, not
    // bytes. Anything landing in the graph of EVERY route should import the
    // per-icon subpath (`@hugeicons/core-free-icons/Foo`, a default export)
    // rather than the root.
    optimizePackageImports: ["@hugeicons/react", "@hugeicons/core-free-icons"],
  },
  // `@vercel/oidc` mints the token for /api/skills-token. Its async entry point
  // unconditionally dynamic-imports a local-dev refresh path that requires
  // node:fs and the Vercel CLI packages, and rethrows if those imports fail —
  // even when it has already read a perfectly valid token. Bundling it means
  // betting that tracing follows those dynamic requires; losing that bet 503s
  // the relay and silently drops the skills.sh sync onto the legacy API key.
  // Loading it via native require instead takes the bet off the table.
  serverExternalPackages: ["@vercel/oidc"],
  turbopack: {
    resolveAlias: {
      // Upstream bug workaround, not a preference.
      //
      // `@pierre/theming` (pulled in by @pierre/diffs, which renders the skill
      // version diffs) statically maps 65 Shiki themes to dynamic imports. 64
      // resolve. `horizon-bright` does not exist in ANY published release of
      // `@shikijs/themes` — checked 3.22, 3.23, 4.0 and 4.4 — so the module
      // graph fails to build even though nothing in this app ever selects that
      // theme. Because the map is a static import, no runtime option (including
      // `disableWorkerPool`) can avoid it.
      //
      // Aliased to `horizon`, its actual sibling, so the graph resolves. The
      // theme is unreachable in practice: the diff renderer is pinned to
      // github-light / github-dark in components/skill-history.tsx to match the
      // app's own code blocks. Delete this once @pierre/theming fixes the entry.
      "@shikijs/themes/horizon-bright": "@shikijs/themes/horizon",
    },
  },
  // The OG image routes read brand .ttf/.otf fonts from assets/og via fs.readFile.
  // Next's static analysis can't always trace a runtime-built path, so list the
  // files explicitly to guarantee they ship with the serverless functions.
  // Covers the root (/opengraph-image) and nested (/**/opengraph-image) image
  // routes, plus the bundle OG handler (versioned URL, not a file convention).
  outputFileTracingIncludes: {
    "/opengraph-image": ["./assets/og/**"],
    "/**/opengraph-image": ["./assets/og/**"],
    "/bundle/[id]/og/[v]": ["./assets/og/**"],
  },
  allowedDevOrigins: ["192.168.1.128"],
  // Security response headers, applied to every route.
  //
  // Deliberately NOT including a Content-Security-Policy. A useful CSP here
  // would have to allow Clerk's scripts and frames, the Convex websocket, the
  // Polar checkout redirect, Typesense's browser-direct search XHR, and the
  // OpenPanel script — and `'unsafe-inline'` for styles either way, since
  // Tailwind and next-themes both inject inline. A CSP that permissive buys
  // little and breaks loudly and remotely the first time a provider moves a
  // domain. Adding one properly means nonces and a report-only rollout, which
  // is its own change; the headers below are the part that is unambiguously
  // worth having and cannot break a provider.
  //
  // No `X-XSS-Protection`: it is a legacy IE/Chrome filter, removed from every
  // current browser, and was itself exploitable. No `X-Frame-Options`: it is
  // superseded by `frame-ancestors`, and Clerk's flows use frames — pick that
  // fight in the CSP change, not here.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Two years, preloadable. HSTS is the one header here that is hard to
          // undo: browsers cache it for its full max-age, so a site that
          // publishes this and later needs plain HTTP on a subdomain is stuck
          // until it expires. That is fine for this app (Vercel terminates TLS
          // on every domain we use) but it is the reason to read before
          // copying.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Stop browsers second-guessing our Content-Type. Relevant here
          // because the app serves generated non-HTML from routes that look
          // like pages: sitemap.xml, robots.txt, and ~16k OG images.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Send the full URL to ourselves, only the origin cross-site. The
          // default in current browsers is already strict-origin-when-
          // cross-origin, so this pins it rather than changing it.
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          // Deny the powerful APIs this app has no use for, so a compromised
          // third-party script cannot reach for them. Kept to a short list of
          // things we will genuinely never want, rather than an exhaustive
          // denylist that has to be edited every time a feature is added.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
  // NO OpenPanel rewrites here, deliberately (removed Sep 2026).
  //
  // `/op/analytics/*` and `/op1.js` used to be `rewrites()` to
  // api.openpanel.dev and openpanel.dev. A Next rewrite to an absolute external
  // URL forwards the incoming request headers as-is, and these paths are
  // same-origin by design, so the browser attached this site's cookies to them.
  // That shipped Clerk's `__session` JWT to a third-party analytics vendor on
  // every event. Verified against a local echo server, not assumed.
  //
  // A rewrite cannot strip a header, so both now go through OpenPanel's own
  // `createRouteHandler` at `app/api/op/[...path]/route.ts`, which forwards an
  // allowlist of five headers and nothing else. Do not "simplify" it back into
  // a rewrite.
};

export default nextConfig;
