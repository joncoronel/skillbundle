import { expect, test } from "@playwright/test";
import { HISTORY_SKILL_PATH } from "./fixtures";

/**
 * The History section's diff panel.
 *
 * This is the one substantial interactive surface on the app's highest-traffic
 * route, and until this file it had no automated coverage at all — the
 * instant-navigation suite only asserts that shells commit, never that anything
 * behaves once you click it. Every assertion below corresponds to a regression
 * that actually shipped and was fixed by hand:
 *
 * - the panel opening to a near-empty box and then jumping, because it revealed
 *   before its content had loaded;
 * - a second "Loading diff" state appearing *after* the panel had opened;
 * - a busy indicator flashing on and off too fast to read;
 * - a busy indicator shown for work that was not happening;
 * - a slow range swap landing after a faster one and dragging the selection
 *   backwards.
 *
 * Deliberately NOT asserted: that the panel is at its final height the instant
 * it opens. `@pierre/diffs`' CodeView populates its shadow root asynchronously
 * after mount, so the height genuinely grows a frame or two later — that is the
 * known upstream behaviour the `duration-0` workaround exists for (see TODO.md).
 * Asserting it would encode a wish, not the contract.
 */

/** Requests that mean real work: the diff chunk, or version content from Convex storage. */
const WORK_REQUEST = /convex\.(cloud|site)|\/_next\/static\/chunks\//;

/** Matches `MIN_BUSY_MS` in components/skill-history-row.tsx, minus scheduling slack. */
const BUSY_FLOOR_MS = 200;

test.describe("skill history diff panel", () => {
  test("expands a diff, and only fetches on click", async ({ page }) => {
    const work: string[] = [];
    page.on("request", (r) => {
      if (WORK_REQUEST.test(r.url())) work.push(r.url());
    });

    await page.goto(HISTORY_SKILL_PATH, { waitUntil: "networkidle" });

    const trigger = page.locator("#history button[aria-expanded]").first();
    test.skip(
      (await trigger.count()) === 0,
      "no expandable history row on this deployment",
    );

    // 1. Hovering must be inert. The row used to warm the renderer chunk and
    //    both file versions on pointer-enter, which meant sweeping down a long
    //    timeline issued two fetches per row nobody opened.
    const beforeHover = work.length;
    await trigger.hover();
    await page.waitForTimeout(1200);
    expect(
      work.slice(beforeHover),
      "hovering a history row must not fetch anything",
    ).toEqual([]);

    // 2. Clicking loads first and reveals after, holding the busy state long
    //    enough to read rather than flickering.
    const startedAt = Date.now();
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true", {
      timeout: 20_000,
    });
    expect(
      Date.now() - startedAt,
      "the busy state must not flash by faster than its floor",
    ).toBeGreaterThanOrEqual(BUSY_FLOOR_MS);

    // 3. The panel holds a real diff, and no second loading phase follows the
    //    open. "Loading diff" appearing here is the exact regression that made
    //    the row reveal an empty box and fill it in afterwards.
    const panel = page.locator(`#${await trigger.getAttribute("aria-controls")}`);
    await expect(panel).toBeVisible();
    await expect(page.getByText("Loading diff")).toHaveCount(0);
    await expect
      .poll(
        async () =>
          panel.evaluate((el) => {
            const host = [...el.querySelectorAll("*")].find((n) => n.shadowRoot);
            return host?.shadowRoot?.textContent?.trim().length ?? 0;
          }),
        { message: "the diff renderer should paint content into its shadow root" },
      )
      .toBeGreaterThan(0);
  });

  test("re-opening cached content skips the busy state", async ({ page }) => {
    await page.goto(HISTORY_SKILL_PATH, { waitUntil: "networkidle" });

    const trigger = page.locator("#history button[aria-expanded]").first();
    test.skip(
      (await trigger.count()) === 0,
      "no expandable history row on this deployment",
    );

    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true", {
      timeout: 20_000,
    });
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    // Nothing left to fetch, so the floor must not apply. Showing a timed
    // indicator here would be reporting work that is not happening — the rule
    // `isReady` exists to enforce.
    const startedAt = Date.now();
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true", {
      timeout: 20_000,
    });
    expect(
      Date.now() - startedAt,
      "a cached re-open should not wait out the busy floor",
    ).toBeLessThan(BUSY_FLOOR_MS);
  });

  test("changing the comparison range keeps the panel open", async ({ page }) => {
    await page.goto(HISTORY_SKILL_PATH, { waitUntil: "networkidle" });

    const trigger = page.locator("#history button[aria-expanded]").first();
    test.skip(
      (await trigger.count()) === 0,
      "no expandable history row on this deployment",
    );

    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true", {
      timeout: 20_000,
    });

    // The range selector only exists on the newest row, and only when there is
    // more than one older version to look back to.
    const range = page.locator("#history [role='combobox']").first();
    test.skip(
      (await range.count()) === 0,
      "this skill has too little history for a lookback range",
    );

    const before = (await range.textContent())?.trim();
    await range.click();
    const option = page.locator("[role='option']").nth(1);
    await expect(option).toBeVisible();
    await option.click();

    // Hold-then-swap: the diff on screen is replaced, but the panel never
    // collapses. Collapsing mid-swap was a full-height jump for what reads as a
    // filter change.
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect
      .poll(async () => (await range.textContent())?.trim(), {
        message: "the selected range should update once the swap lands",
      })
      .not.toBe(before);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
  });
});
