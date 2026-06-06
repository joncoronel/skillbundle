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
    // Adds the "Instant Navs" panel to Next DevTools for inspecting the static
    // shell on page loads and client navigations.
    instantNavigationDevToolsToggle: true,
  },
};

export default nextConfig;
