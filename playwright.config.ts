import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Next loads .env.local for the app it builds, but the Playwright process gets
// nothing — so the Clerk keys the auth setup needs are invisible without this.
// Inlined rather than pulling in dotenv: it's a handful of lines and neither
// dotenv nor @next/env is resolvable in this install.
//
// Existing env always wins, so CI (which sets real secrets) is unaffected.
function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadEnvLocal();

// Port 3100, not 3000: `pnpm dev` usually holds 3000 during local development
// and the e2e server is a separate production build. Overridable for CI or for
// pointing at an already-running server.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

// The authenticated projects only exist when there are Clerk dev keys to sign
// in with. Registering them unconditionally means a contributor without keys
// gets five ENOENT failures on a missing storage-state file, which says nothing
// useful. This way the suite simply runs its signed-out half.
const STORAGE_STATE = path.join(process.cwd(), "playwright/.clerk/user.json");
const hasClerkDevKeys =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  process.env.CLERK_SECRET_KEY?.startsWith("sk_test_") === true;

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
  projects: [
    // Signed-out. The instant-navigation guards live here — they're about the
    // public catalog, which is the traffic that matters for those.
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: ["**/authenticated/**", "**/*.setup.ts"],
    },
    // Signs in once and writes the storage state the project below reuses, so
    // each authenticated spec doesn't repeat a full Clerk sign-in.
    ...(hasClerkDevKeys
      ? [
          // `trace: "off"` on both authenticated projects, overriding the
          // global `on-first-retry`.
          //
          // This repo is public, and the workflow uploads `playwright-report/`
          // on failure — the HTML reporter copies `trace.zip` into its `data/`
          // directory, and a trace records request and response headers. A
          // single flaky authenticated spec would therefore publish a usable
          // Clerk session token for the e2e user, and the setup project's trace
          // would capture the sign-in exchange itself. Bounded to the dev Clerk
          // instance rather than production, but it is the one path where a
          // credential leaves the runner.
          //
          // The signed-out project keeps traces: it carries no credentials and
          // is where debugging value actually is.
          {
            name: "setup",
            testMatch: /auth\.setup\.ts/,
            use: { ...devices["Desktop Chrome"], trace: "off" as const },
          },
          {
            name: "chromium-authed",
            dependencies: ["setup"],
            testDir: "./e2e/authenticated",
            use: {
              ...devices["Desktop Chrome"],
              storageState: STORAGE_STATE,
              trace: "off" as const,
            },
          },
        ]
      : []),
  ],
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
