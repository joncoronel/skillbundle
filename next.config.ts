import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    // Tree-shake icon barrels. lucide-react is on Next's default-optimized list
    // already; HugeIcons isn't, and it's imported broadly across the app.
    optimizePackageImports: [
      "@hugeicons/react",
      "@hugeicons/core-free-icons",
    ],
  },
};

export default nextConfig;
