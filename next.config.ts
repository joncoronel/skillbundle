import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Tree-shake icon barrels. lucide-react is on Next's default-optimized list
    // already; HugeIcons isn't, and it's imported broadly across the app.
    optimizePackageImports: ["@hugeicons/react", "@hugeicons/core-free-icons"],
  },
  allowedDevOrigins: ["192.168.1.128"],
};

export default nextConfig;
