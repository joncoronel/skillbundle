import { expect, test } from "@playwright/test";

/**
 * Saving a bundle with no account goes to the browser and shows on the
 * signed-out dashboard. The import on sign-in is covered in
 * tests/local-bundles.test.ts.
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
  // By role: the hidden home page stays mounted, so there are two h1s.
  await expect(
    page.getByRole("heading", { level: 1, name: "E2E browser bundle" }),
  ).toBeVisible();
  await expect(page.getByText("Saved in this browser.")).toBeVisible();

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("E2E browser bundle")).toBeVisible();
});
