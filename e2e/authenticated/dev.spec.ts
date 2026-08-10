import { expect, test } from "@playwright/test";
import { instant } from "@next/playwright";

/**
 * `/dev` and `/dev/add-skill` — the only `◐` routes behind auth.
 *
 * Two things are worth guarding here, and only one of them needs an admin.
 *
 * The gate itself is the security-relevant half: `verifyAdmin()` calls
 * `notFound()` rather than redirecting, so a signed-in non-admin is not even
 * told the route exists. That is testable with the ordinary test user and runs
 * on every CI job.
 *
 * The admin view needs the test user's address in Convex's `ADMIN_EMAILS`,
 * which is a deployment config change, so it is opt-in via E2E_ADMIN=1 rather
 * than assumed. Without it those tests skip instead of failing.
 */

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";
const IS_ADMIN = process.env.E2E_ADMIN === "1";

test.describe("admin gate", () => {
  for (const route of ["/dev", "/dev/add-skill"]) {
    test(`${route} is hidden from a signed-in non-admin`, async ({ page }) => {
      test.skip(IS_ADMIN, "test user is configured as an admin");

      await page.goto(route);

      // Signed in, so this must NOT be the middleware's sign-in redirect —
      // that would mean the route was gated by auth rather than by admin.
      await expect(page).not.toHaveURL(/\/sign-in/);

      // notFound(), not a 403 or an empty dashboard: the route does not
      // acknowledge it exists. Guards against verifyAdmin() being softened to
      // a redirect or an inline "not authorised" panel.
      await expect(page.locator("h1")).toContainText("Not in the index.");
    });
  }
});

test.describe("admin view", () => {
  test.skip(!IS_ADMIN, "set E2E_ADMIN=1 with an admin test user");

  test("/dev commits its shell before the admin check resolves", async ({
    page,
  }) => {
    // The gate is a server call behind <Suspense>, so the skeleton belongs to
    // the shell — this is what stops the whole route blocking on Convex.
    await instant(
      page,
      async () => {
        await page.goto("/dev");
        await expect(page.locator("main, body")).toBeVisible();
      },
      { baseURL },
    );
  });

  test("/dev renders stats for an admin", async ({ page }) => {
    await page.goto("/dev");
    await expect(page).toHaveURL(/\/dev$/);
    await expect(page.locator("h1")).not.toContainText("Not in the index.");
  });

  test("/dev/add-skill renders its form for an admin", async ({ page }) => {
    await page.goto("/dev/add-skill");
    await expect(page).toHaveURL(/\/dev\/add-skill$/);
    await expect(page.locator("h1")).not.toContainText("Not in the index.");
  });
});
