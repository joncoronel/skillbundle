import { expect, test } from "@playwright/test";

/**
 * Saving a bundle with no account: it goes to the browser (lib/local-bundles.ts)
 * and shows up on the signed-out dashboard. This is the flow that used to end
 * at "Sign in to save", which a reviewer read as "you can't use bundles
 * without an account".
 *
 * Signed out only. The import into an account on sign-in is covered by
 * tests/local-bundles.test.ts against the mutation.
 */
test("a signed-out visitor can save a bundle and find it on the dashboard", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // `check()` inside `toPass`: a click that lands before hydration is dropped,
  // and `check()` is a no-op once checked, so a retry can't toggle it off.
  const firstRow = page.getByRole("main").getByRole("checkbox").first();
  await expect(async () => {
    await firstRow.check();
  }).toPass();

  await page.getByRole("button", { name: "Save bundle" }).click();
  const dialog = page.getByRole("dialog", { name: "Save bundle" });
  await expect(dialog.getByText("saved in this browser")).toBeVisible();
  await dialog.getByLabel("Bundle name").fill("E2E browser bundle");
  await dialog.getByRole("button", { name: "Save bundle" }).click();

  await expect(page).toHaveURL(/\/bundle\/local\?id=/);
  await expect(page.locator("h1")).toHaveText("E2E browser bundle");
  await expect(page.getByText("Saved in this browser.")).toBeVisible();

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("E2E browser bundle")).toBeVisible();
});
