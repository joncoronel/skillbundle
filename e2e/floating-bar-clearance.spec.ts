import { expect, test, type Page } from "@playwright/test";

/**
 * The site footer's last row scrolls clear of an open floating bottom bar, and
 * the footer carries no bar clearance when no bar is open.
 *
 * The footer grows its bottom pad from a CSS match,
 * `body:has([data-floating-bar][data-open])` (components/site-footer.tsx). That
 * works only while `data-floating-bar`, passed to SheetContent, lands on the
 * same element Base UI marks `data-open`. Two things can break it without an
 * error, a type error or a lint warning: a `shadcn add` update to the vendored
 * `components/ui/cubby-ui/sheet.tsx` that stops forwarding props to the popup,
 * and a Tailwind change in how the arbitrary `[body:has(...)_&]` variant is
 * parsed. Either way the legal links go back under the bar.
 *
 * What this cannot catch: a NEW floating bar that never opts in. That rule
 * lives in DESIGN.md §4.
 *
 * The home BundleBar stands in for every marked bar, because it needs no
 * account. `/compare` is the page because it is short and is a browse route, so
 * the bar shows there. Both viewports, because the bar is a flush drawer below
 * `sm` and a floating pill above it.
 */

/** The lowest line of the footer on both layouts (stacked below `sm`). */
const lastFooterLine = (page: Page) =>
  page.getByRole("contentinfo").getByRole("link", { name: "skills.sh" });

async function gapBelowFooter(page: Page) {
  return page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const footer = document.querySelector("footer")!;
    const link = [...footer.querySelectorAll("a")].find(
      (a) => a.textContent === "skills.sh",
    )!;
    return (
      document.documentElement.scrollHeight -
      (link.getBoundingClientRect().bottom + window.scrollY)
    );
  });
}

const VIEWPORTS = [
  ["desktop", { width: 1280, height: 720 }],
  ["mobile", { width: 390, height: 844 }],
] as const;

for (const [name, viewport] of VIEWPORTS) {
  test.describe(`floating bar clearance (${name})`, () => {
    test.use({ viewport });

    test("footer clears an open bundle bar, and reserves nothing without one", async ({
      page,
    }) => {
      // Found by what the user sees, not by `data-floating-bar`: a bar that
      // lost the marker must fail on the geometry below ("the footer is
      // covered"), not on "bar not found".
      const bar = page
        .getByRole("dialog")
        .filter({ has: page.getByRole("button", { name: "Copy install" }) });

      await page.goto("/compare");
      await page.waitForLoadState("networkidle");
      await expect(bar).toHaveCount(0);
      const gapWithoutBar = await gapBelowFooter(page);

      // Select a skill on the home page. `check()` inside `toPass` because a
      // click that lands before hydration is dropped, and `check()` is a no-op
      // once the box is checked, so a retry cannot toggle it back off.
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      const firstRow = page.getByRole("main").getByRole("checkbox").first();
      await expect(async () => {
        await firstRow.check();
      }).toPass();
      await expect(bar).toBeVisible();

      // The selection persists, so the bar reopens on /compare.
      await page.goto("/compare");
      await expect(bar).toBeVisible();

      // Re-scroll on every attempt: the pad eases in over 400ms, and a scroll
      // taken mid-transition stops short of the final bottom.
      await expect(async () => {
        const gap = await gapBelowFooter(page);
        const line = await lastFooterLine(page).boundingBox();
        const barBox = await bar.boundingBox();
        expect(line && barBox).toBeTruthy();
        expect(line!.y + line!.height).toBeLessThanOrEqual(barBox!.y);
        expect(gap).toBeGreaterThan(gapWithoutBar);
      }).toPass({ timeout: 5_000 });
    });
  });
}
