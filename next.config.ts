import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
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
  // The OG image routes read brand .ttf fonts from assets/og via fs.readFile.
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
  // Proxy OpenPanel through our own domain so requests aren't blocked by
  // ad-blockers. The layout's OpenPanelComponent points at these paths via
  // apiUrl/cdnUrl.
  async rewrites() {
    return [
      {
        source: "/op/analytics/:path*",
        destination: "https://api.openpanel.dev/:path*",
      },
      {
        source: "/op1.js",
        destination: "https://openpanel.dev/op1.js",
      },
    ];
  },
};

export default nextConfig;
