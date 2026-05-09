import { defineConfig } from "vitest/config";

// convex-test runs Convex functions inside an edge-runtime VM so the
// Convex environment APIs (ctx.scheduler, ctx.db, etc.) behave as they
// would in production. Setting `environment: "edge-runtime"` ensures
// our test code runs in that same VM rather than the Node default.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["tests/**/*.test.ts"],
  },
});
