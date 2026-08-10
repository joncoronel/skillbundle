import { expect, test } from "@playwright/test";
import { instant } from "@next/playwright";
import {
  BUNDLE_ID,
  GITHUB_ORG_PATH,
  GITHUB_SKILL,
  GITHUB_SKILL_PATH,
} from "./fixtures";

/**
 * Instant-navigation guards.
 *
 * `instant(page, fn)` pauses the navigation at its static shell for the
 * duration of `fn`, so anything asserted *inside* the callback must have been
 * available without waiting on the network. Anything asserted *after* the
 * callback is allowed to stream in.
 *
 * Two rules the helper imposes, both load-bearing:
 *
 * 1. Pass `{ baseURL }` when `page.goto()` is the first navigation of a test —
 *    the helper needs an origin to scope its cookie to before the document is
 *    requested.
 * 2. On a client navigation, `waitForURL` before asserting. Assertions on
 *    shared selectors (`h1`, column headers) would otherwise match the
 *    *source* page and pass for the wrong reason.
 *
 * These run against a production build, not `next dev` — Next does no
 * prefetching in dev, so there would be no prefetched shell to pause at. See
 * `webServer` in playwright.config.ts.
 *
 * Selector note: this app's cubby-ui `Button render={<Link/>}` pattern produces
 * elements with role=button that navigate like links. Nav items and the skill
 * rows on `/` are buttons/checkboxes, not links — only the catalog listing rows
 * are real anchors. Assertions below reflect the actual accessibility tree, not
 * what the JSX looks like.
 */

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";

test.describe("initial load", () => {
  test("/ serves its hero in the shell", async ({ page }) => {
    await instant(
      page,
      async () => {
        await page.goto("/");
        // The Suspense fallback renders the real default no-params state
        // (see docs/architecture.md §2), so the hero is prerendered HTML
        // rather than a skeleton.
        await expect(page.locator("h1")).toContainText(
          "Pick skills. Ship one install command.",
        );
      },
      { baseURL },
    );
  });

  test("/compare serves its header in the shell", async ({ page }) => {
    await instant(
      page,
      async () => {
        await page.goto("/compare");
        await expect(page.locator("h1")).toContainText("Compare.");
        await expect(
          page.getByText("Installs, rank, audits, and docs side by side"),
        ).toBeVisible();
      },
      { baseURL },
    );
  });

  test("/official serves its header in the shell", async ({ page }) => {
    await instant(
      page,
      async () => {
        await page.goto("/official");
        await expect(page.locator("h1")).toContainText("Official.");
        await expect(
          page.getByText("Skills published by the companies and organizations"),
        ).toBeVisible();
        // The publisher rows are in the shell too, not just the header:
        // `loadCuratedOwners` is `'use cache'` with `cacheLife("days")`, and
        // cached content whose `stale` is >= 5 minutes is included in the
        // route's App Shell. So the whole list prerenders.
        await expect(
          page.getByRole("link", { name: /\d+ repos?\b/ }).first(),
        ).toBeVisible();
      },
      { baseURL },
    );
  });

  test("skill detail serves title and actions in the shell", async ({ page }) => {
    await instant(
      page,
      async () => {
        await page.goto(GITHUB_SKILL_PATH);
        // h1 and the Compare action sit above SkillDetailPage's Suspense
        // boundary, so they belong to the shell. Compare is a cubby-ui
        // Button rendering a Link — role=button, not link.
        await expect(page.locator("h1")).toContainText(GITHUB_SKILL.skillId);
        await expect(
          page.getByRole("button", { name: "Compare" }).first(),
        ).toBeVisible();
      },
      { baseURL },
    );
  });

  test("org listing serves its column headers in the shell", async ({ page }) => {
    await instant(
      page,
      async () => {
        await page.goto(GITHUB_ORG_PATH);
        // Deliberately NOT asserting the <h1>: it renders `{org}` from
        // `await params`, which is URL data and so cannot live in this
        // route's shared App Shell. The column headers appear in both
        // OrgListSkeleton and the real list, so they are genuine shell
        // content and survive a shared-shell prefetch.
        await expect(page.getByText("Source", { exact: true })).toBeVisible();
        await expect(page.getByText("Installs", { exact: true })).toBeVisible();
      },
      { baseURL },
    );
  });
});

test.describe("client navigation", () => {
  test("/official -> /[org] commits its shell instantly", async ({ page }) => {
    await page.goto("/official");

    // Discovered, not pinned: read a real publisher row so the test follows
    // the actual user path and can't rot when the curated list changes.
    const publisher = page.getByRole("link", { name: /\d+ repos?\b/ }).first();
    await expect(publisher).toBeVisible();
    const href = await publisher.getAttribute("href");
    expect(href).toBeTruthy();

    await instant(page, async () => {
      await publisher.click();
      await page.waitForURL((url) => url.pathname === href);
      await expect(page.getByText("Source", { exact: true })).toBeVisible();
      await expect(page.getByText("Installs", { exact: true })).toBeVisible();
    });
  });

  test("/[org] -> /[org]/[repo] commits its shell instantly", async ({ page }) => {
    await page.goto(GITHUB_ORG_PATH);

    const repo = page
      .locator(`main a[href^="${GITHUB_ORG_PATH}/"], a[href^="${GITHUB_ORG_PATH}/"]`)
      .first();
    await expect(repo).toBeVisible();
    const href = await repo.getAttribute("href");
    expect(href).toBeTruthy();

    await instant(page, async () => {
      await repo.click();
      await page.waitForURL((url) => url.pathname === href);
      // The repo listing's column header is "Skill" (the org listing's is
      // "Source") — asserting the wrong one passes against the stale page.
      //
      // `:visible` matters: Cache Components keeps the previous route mounted
      // but hidden via <Activity> rather than unmounting it, so an unscoped
      // locator happily matches the outgoing page's DOM and reports "hidden".
      await expect(
        page.locator("span:visible", { hasText: /^Skill$/ }).first(),
      ).toBeVisible();
    });
  });
});

test.describe("bundle route", () => {
  // Guards the share-link path: a signed-out stranger opening a public bundle
  // is the traffic this route exists for.
  test("public bundle commits a shell before its data", async ({ page }) => {
    test.skip(!BUNDLE_ID, "E2E_BUNDLE_ID not set");

    await instant(
      page,
      async () => {
        await page.goto(`/bundle/${BUNDLE_ID}`);
        // Header chrome is layout-level and must be present immediately.
        await expect(page.getByRole("link", { name: "skillbundle" })).toBeVisible();
        // The bundle's own name is Convex data behind the boundary, so it
        // must not be in the shell.
        await expect(page.locator("h1")).toHaveCount(0);
      },
      { baseURL },
    );

    // ...and it must arrive once the request-time render completes.
    await expect(page.locator("h1")).toBeVisible();
  });
});
