import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Tree-shake icon barrels. lucide-react is on Next's default-optimized list
    // already; HugeIcons isn't, and it's imported broadly across the app.
    optimizePackageImports: ["@hugeicons/react", "@hugeicons/core-free-icons"],
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
};

export default nextConfig;
