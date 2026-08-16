import { expect, test } from "@playwright/test";
import {
  GITHUB_ORG_PATH,
  GITHUB_REPO_PATH,
  GITHUB_SKILL_PATH,
  WELL_KNOWN_SOURCE_PATH,
} from "./fixtures";

/**
 * Exactly one visible `<main>` per route.
 *
 * `app/(main)/layout.tsx` owns the landmark for its whole group and pages render
 * a plain width wrapper inside it. This guards both directions: a page that adds
 * its own `<main>` back nests two, and a route that escapes the layout has none.
 *
 * It exists because the silent case already shipped — `/[org]`, `/[org]/[repo]`
 * and `/site/[source]` ran for months with no landmark at all and nothing caught
 * it. A separate file from instant-navigation.spec.ts on purpose: that one is
 * the §1 shell-timing guard and is documented as such, this is a document-
 * structure contract that happens to need the same routes.
 *
 * Two rules the assertions follow:
 *
 * - `:visible` only. React parks streamed content in a `hidden` container during
 *   the swap, and that copy is legitimately not a second landmark — the HTML
 *   spec's rule is about `<main>` elements that are not hidden.
 * - Assert TWICE, before and after the network settles. `toHaveCount` resolves
 *   on its first passing poll, and every one of these routes already has its
 *   `<main>` in the static shell, so a single early assertion would pass even if
 *   a client-only subtree mounted a second one during hydration. Note that
 *   waiting for `h1` would not have caught this: on `/compare` the heading is in
 *   the shell too.
 */

/** Routes under `(main)`, where the layout supplies the landmark. */
const MAIN_ROUTES = [
  ["home", "/"],
  ["org", GITHUB_ORG_PATH],
  ["repo", GITHUB_REPO_PATH],
  ["skill", GITHUB_SKILL_PATH],
  ["site", WELL_KNOWN_SOURCE_PATH],
  ["official", "/official"],
  ["compare", "/compare"],
  ["pricing", "/pricing"],
  ["add", "/add"],
  // notFound() from the org route, so this exercises `(main)/not-found.tsx`
  // rendering inside the layout rather than replacing it.
  ["not-found", "/this-org-does-not-exist-e2e"],
] as const;

test.describe("landmarks", () => {
  for (const [name, path] of MAIN_ROUTES) {
    test(`${name} renders exactly one visible <main>, from the layout`, async ({
      page,
    }) => {
      const main = page.locator("main:visible");

      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(main).toHaveCount(1);

      await page.waitForLoadState("networkidle");
      await expect(main).toHaveCount(1);
      // It is the layout's, so the skip link has something to land on.
      await expect(main).toHaveAttribute("id", "main-content");
    });
  }

  /**
   * `(auth)` deliberately does NOT use the layout landmark — it comes from
   * `AuthFrame` per page, and from `(auth)/error.tsx` when the boundary replaces
   * it. Asserted without the id, because that asymmetry is the thing most likely
   * to be "tidied up" into a nested or missing landmark.
   */
  test("sign-in renders exactly one visible <main>, from AuthFrame", async ({
    page,
  }) => {
    const main = page.locator("main:visible");

    await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
    await expect(main).toHaveCount(1);

    await page.waitForLoadState("networkidle");
    await expect(main).toHaveCount(1);
    await expect(main).not.toHaveAttribute("id", "main-content");
  });
});
