import { expect, test } from "@playwright/test";
import { COPIES_SKILL_PATH } from "./fixtures";

/**
 * The Copies tab.
 *
 * Skipped unless `E2E_COPIES_PATH` names a skill that actually has copies. That
 * is not laziness about the fixture: a skill has aliases or forks only after
 * the weekly duplicate chain has resolved repo identities, so on a fresh or
 * dev-seeded deployment no skill qualifies and any pinned slug would report a
 * working tab as broken. `e2e/fixtures.ts` carries the full reasoning.
 *
 * What this guards, none of which the other suites cover:
 *
 * - the tab is CONDITIONAL, so its presence on a skill with copies is the only
 *   proof the `hasCopies` thread from the layout's loader through the masthead
 *   to the strip is still connected. It is easy to break silently: the strip
 *   would simply render four tabs and the route would stay reachable by URL.
 * - the ranked list includes the skill you are on. Without its own row the
 *   comparison the page exists for is impossible, and nothing else would fail.
 * - every row carries an install count, which is what the ranking sorts by.
 */
test.describe("copies tab", () => {
  test.skip(
    !COPIES_SKILL_PATH,
    "E2E_COPIES_PATH not set — no skill known to have copies",
  );

  test("the tab appears and ranks this skill among its copies", async ({
    page,
  }) => {
    await page.goto(COPIES_SKILL_PATH!);

    // role=tab, not link: the strip renders Base UI tabs whose triggers are
    // <Link>s, so the anchor carries the tab role.
    const copiesTab = page.getByRole("tab", { name: "Copies" });
    await expect(copiesTab).toBeVisible();

    await copiesTab.click();
    await page.waitForURL((url) => url.pathname.endsWith("/copies"));

    const rows = page.locator("#copies li");
    // `count()` resolves once and does not retry, so it has to run behind
    // something that waits: the pane streams in behind the tab's Suspense
    // boundary, and a bare count raced it.
    await expect(rows.first()).toBeVisible();

    // Two or more: a copy set is the skill plus at least one other place.
    await expect
      .poll(() => rows.count(), {
        message: "a copy set is this skill plus at least one other place",
      })
      .toBeGreaterThan(1);

    // The skill being viewed sits in the ranking rather than above it.
    // Asserted on the ROW, not the label: the label is rendered twice per row,
    // once for the narrow layout and once for the wide one, so matching its
    // text directly trips strict mode with two elements. Exactly one row being
    // marked is also the stronger claim.
    await expect(rows.filter({ hasText: "This page" })).toHaveCount(1);

    // Every row reports the count the ranking is ordered by.
    await expect(rows.filter({ hasText: /installs/ })).toHaveCount(
      await rows.count(),
    );
  });

  test("a copy row links to that copy's own page", async ({ page }) => {
    await page.goto(`${COPIES_SKILL_PATH!}/copies`);

    // The current skill's row is deliberately not a link, so any anchor in the
    // list is one of the other copies.
    const other = page.locator("#copies li a").first();
    await expect(other).toBeVisible();
    const href = await other.getAttribute("href");
    expect(href).toBeTruthy();
    expect(href).not.toBe(COPIES_SKILL_PATH);

    await other.click();
    await page.waitForURL((url) => url.pathname === href);
  });
});
