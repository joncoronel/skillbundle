import { defineConfig, devices } from "@playwright/test";

// Port 3100, not 3000: `pnpm dev` usually holds 3000 during local development
// and the e2e server is a separate production build. Overridable for CI or for
// pointing at an already-running server.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

// Next disables prefetching in `next dev`, and instant() asserts on what a
// prefetch put in the client cache. Running these against the dev server would
// produce failures that say nothing about production, so the default web server
// is a real build. E2E_DEV=1 exists only for debugging the tests themselves.
const useDevServer = process.env.E2E_DEV === "1";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  use: { baseURL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: useDevServer
          ? `pnpm dev --port ${PORT}`
          : `pnpm build && pnpm start --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        // The build runs Convex-backed generateStaticParams and prerenders 39
        // pages, so a cold `pnpm build && pnpm start` is minutes, not seconds.
        timeout: 300_000,
        // E2E=1 turns on exposeTestingApiInProductionBuild in next.config.ts.
        // It has to be set for the *build*, not just the server, because that's
        // when the flag is read.
        env: { E2E: "1" },
      },
});
