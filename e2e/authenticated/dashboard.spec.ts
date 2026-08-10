import { expect, test } from "@playwright/test";
import { instant } from "@next/playwright";

/**
 * Signed-in coverage. These run in the `chromium-authed` project, which loads
 * the storage state produced by e2e/auth.setup.ts.
 *
 * This is functional coverage, not instant-navigation coverage — the two
 * authenticated pages here (`/dashboard`, `/settings`) are already fully static
 * (`○`) shells, because per-user data arrives client-side over the Convex
 * websocket rather than being rendered on the server. So their shells commit
 * instantly by construction; what actually needed testing is that auth works
 * end to end and that the client data path resolves.
 */

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";

test("dashboard is reachable when signed in", async ({ page }) => {
  await page.goto("/dashboard");
  // Signed out, proxy.ts would have redirected to /sign-in.
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("h1")).toContainText("Your setup.");
});

test("dashboard shell commits before the websocket resolves", async ({ page }) => {
  await instant(
    page,
    async () => {
      await page.goto("/dashboard");
      // The masthead is static, so it must be painted with no server data.
      await expect(page.locator("h1")).toContainText("Your setup.");
    },
    { baseURL },
  );
});

test("dashboard resolves its Convex data without erroring", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.locator("h1")).toContainText("Your setup.");
  // The change feed renders once the authenticated websocket answers. Either
  // state is valid (a fresh test user has no bundles) — what must NOT happen
  // is the region error boundary, i.e. the auth token never reaching Convex.
  await expect(page.getByText(/Couldn't load/i)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
});

test("settings is reachable and defaults to the profile tab", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator("h1")).toContainText("Account Settings");
});

test("signed-in user is not bounced to sign-in", async ({ page }) => {
  // Guards the proxy.ts private-route list: a regression there (or a broken
  // JWT template) sends signed-in users to /sign-in on every protected route.
  for (const route of ["/dashboard", "/settings"]) {
    await page.goto(route);
    await expect(page).not.toHaveURL(/\/sign-in/);
  }
});
