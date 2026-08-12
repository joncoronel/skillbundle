import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

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
  // Mirror the `@/*` path alias from tsconfig. Vitest doesn't read tsconfig
  // paths, so without this, any module reachable from a test that imports
  // through `@/` fails to resolve. That includes app code pulled in
  // indirectly, which is how it first surfaced: a route handler importing
  // `@/lib/shared-secret`.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // `server-only` is a build-time guard: it exists to make a bundler fail
      // when a Client Component imports server code. Under vitest there is no
      // client graph to protect, and the package's main export throws on
      // import, so route-handler tests need it stubbed out.
      "server-only": fileURLToPath(new URL("tests/stubs/empty.ts", import.meta.url)),
    },
  },
});
