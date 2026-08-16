import { expect, test } from "@playwright/test";
import { instant } from "@next/playwright";
import {
  BUNDLE_ID,
  GITHUB_ORG_PATH,
  GITHUB_REPO_PATH,
  GITHUB_SKILL_PATH,
  WELL_KNOWN_SOURCE_PATH,
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

/**
 * Generous timeout for assertions made *inside* an `instant()` scope.
 *
 * This does not weaken the guarantee. The navigation is paused for the whole
 * scope, so no amount of waiting lets server data through — if the content
 * weren't in the shell, the assertion would still fail at any timeout. All this
 * absorbs is local render/CPU scheduling, which is what made the client-nav
 * assertions flaky once the suite grew to three parallel projects.
 */
const SHELL_TIMEOUT = 15_000;

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

  // /add and /pricing are fully static (`○`) today, so these pass trivially.
  // That's the point: they're cheap tripwires. If someone adds an uncached
  // Convex read or a cookie check to either page, it silently stops being
  // static and these start failing.
  test("/add serves its header in the shell", async ({ page }) => {
    await instant(
      page,
      async () => {
        await page.goto("/add");
        await expect(page.locator("h1")).toContainText("Add a skill.");
        await expect(
          page.getByText("Paste its skills.sh link or its GitHub repo"),
        ).toBeVisible();
      },
      { baseURL },
    );
  });

  test("/pricing serves its header and plans in the shell", async ({
    page,
  }) => {
    await instant(
      page,
      async () => {
        await page.goto("/pricing");
        await expect(page.locator("h1")).toContainText(
          "Two plans. One product.",
        );
        await expect(
          page.getByText("Both watch the skills you depend on"),
        ).toBeVisible();
      },
      { baseURL },
    );
  });

  test("skill detail serves title and actions in the shell", async ({
    page,
  }) => {
    await instant(
      page,
      async () => {
        await page.goto(GITHUB_SKILL_PATH);
        // Assert the shell this route actually has, which is `loading.tsx` —
        // `SkillPage` awaits `params` at the top (deliberate: everything on the
        // page is URL data, see docs/architecture.md §1), so nothing below it
        // is in the shared App Shell and `SkillDetailPageLoading` renders a
        // Skeleton where the h1 goes.
        //
        // An earlier version asserted the h1 and the Compare button here,
        // reasoning that they sit above the Suspense boundary. They do, but
        // that only puts them in *this URL's own prerender*, not in the shell —
        // so the assertion silently depended on GITHUB_SKILL_PATH happening to
        // be the param `generateStaticParams` picked, which is the live
        // top-popular GitHub skill and only falls back to this pinned one. It
        // would have gone red on a healthy route the day the catalog shifted.
        //
        // These are the page's own section headings, which `SkillDetailPage`
        // renders as real text in the skeleton rather than as placeholder bars:
        // neither depends on the skill's data, so both are known before the
        // body resolves. They replaced "Install" and "Overview", which were
        // section labels the redesign removed — the install command now sits in
        // the action bar with no label of its own, and the description is the
        // masthead's lead rather than a section.
        await expect(
          page.locator("*:visible", { hasText: /^History$/ }).first(),
        ).toBeVisible();
        await expect(
          page.locator("*:visible", { hasText: /^Documentation$/ }).first(),
        ).toBeVisible();
      },
      { baseURL },
    );

    // History is server-rendered with the rest of the body rather than fetched
    // by the section itself. It used to defer behind an IntersectionObserver
    // and then open its own Convex subscription, which meant a second spinner
    // after the page had already loaded, plus layout shift as the section grew
    // from empty, to spinner, to list.
    //
    // The assertion that actually distinguishes the two: the section has real
    // content *without scrolling to it*. Under the old approach the body was an
    // empty placeholder until the observer fired. Matching either the populated
    // or the empty state keeps this independent of whether this particular
    // skill has recorded versions.
    await expect(page.locator("#history")).toContainText(
      /No changes recorded yet|View changes|Earliest recorded version/,
    );
    await expect(page.getByText("Loading history")).toHaveCount(0);
  });

  test("org listing serves its column headers in the shell", async ({
    page,
  }) => {
    await instant(
      page,
      async () => {
        await page.goto(GITHUB_ORG_PATH);
        // Deliberately NOT asserting the <h1>: it renders `{org}` from
        // `await params`, which is URL data and so cannot live in this
        // route's shared App Shell. The column headers appear in both
        // OrgListSkeleton and the real list, so they are genuine shell
        // content and survive a shared-shell prefetch.
        // NOT asserting an absent <h1> here, even though this route's header
        // skeleton has none. GITHUB_ORG_PATH is the pinned representative, so
        // Next prerendered this exact URL and a direct load serves that
        // prerender — params resolved and all. The shared App Shell is only
        // what a *client* navigation commits, which is where the shell tripwire
        // lives (see the client-navigation block below).
        await expect(page.getByText("Source", { exact: true })).toBeVisible();
        await expect(page.getByText("Installs", { exact: true })).toBeVisible();
      },
      { baseURL },
    );
  });

  test("source listing serves its column headers in the shell", async ({
    page,
  }) => {
    await instant(
      page,
      async () => {
        await page.goto(WELL_KNOWN_SOURCE_PATH);
        // "Skill", not "Source" — this route's header differs from `/[org]`'s,
        // which is exactly why the org guards do not cover it.
        await expect(page.getByText("Skill", { exact: true })).toBeVisible();
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
    //
    // Filtered to a non-`/site/` href on purpose. `ownerHref` sends any owner
    // containing a dot to `/site/[source]` (lib/skill-urls.ts), and `/official`
    // mixes both kinds of publisher in one list — so an unfiltered `.first()`
    // can land on a different route whose shell says "Skill", not "Source",
    // and fail while claiming to test `/[org]`. That route has its own test
    // below.
    const publisher = page
      .getByRole("link", { name: /\d+ repos?\b/ })
      .and(page.locator(':not([href^="/site/"])'))
      .first();
    await expect(publisher).toBeVisible();
    const href = await publisher.getAttribute("href");
    expect(href).toBeTruthy();

    await instant(page, async () => {
      await publisher.click();
      await page.waitForURL((url) => url.pathname === href);
      // `:visible` for the same reason as the sibling tests: Cache Components
      // keeps the outgoing route mounted under <Activity>, so an unscoped
      // locator can match the page being navigated away from.
      await expect(
        page.locator("span:visible", { hasText: /^Source$/ }).first(),
      ).toBeVisible({ timeout: SHELL_TIMEOUT });
      await expect(
        page.locator("span:visible", { hasText: /^Installs$/ }).first(),
      ).toBeVisible({ timeout: SHELL_TIMEOUT });

      // The suite's tripwire, and it has to be a *client* navigation.
      //
      // `instant()` sets a cookie the testing API reads, and that API is only
      // compiled in when the build ran with E2E=1. Point the suite at a
      // deployment via E2E_BASE_URL, or let `reuseExistingServer` adopt a
      // `pnpm start` built without it, and the cookie is inert. Every positive
      // assertion in this file is equally true of a fully loaded page, so they
      // would all still pass and report green.
      //
      // An absent <h1> can: it is `{org}` from `await params`, so it lives in
      // no shared App Shell and only arrives when the server resumes.
      //
      // The wait is load-bearing, and this was wrong once without it. A bare
      // `toHaveCount(0)` is satisfied by "has not rendered yet", which is true
      // in BOTH modes for the first instant after `waitForURL` — verified by
      // running this suite against a build without E2E=1, where it passed
      // happily. Holding for a beat first is what separates them: with the lock
      // engaged the resume never happens, so the h1 is still absent; without
      // it, the navigation has long since completed and the h1 is on screen.
      await page.waitForTimeout(1500);
      await expect(page.locator("h1:visible")).toHaveCount(0);
    });

    // ...and the URL data still arrives once the resume completes.
    await expect(page.locator("h1:visible")).toBeVisible();
  });

  // `/site/[source]` is the third route the params-into-Suspense split was
  // applied to, and it had no guard of either kind. Its shell is NOT
  // interchangeable with `/[org]`'s: the column header is "Skill", the loader
  // and `generateStaticParams` source differ, and the route is reached by a
  // different link shape on `/official`.
  test("/official -> /site/[source] commits its shell instantly", async ({
    page,
  }) => {
    await page.goto("/official");

    const wellKnown = page.locator('a[href^="/site/"]').first();
    test.skip(
      (await wellKnown.count()) === 0,
      "no well-known publisher in the curated list",
    );
    const href = await wellKnown.getAttribute("href");
    expect(href).toBeTruthy();

    await instant(page, async () => {
      await wellKnown.click();
      await page.waitForURL((url) => url.pathname === href);
      await expect(
        page.locator("span:visible", { hasText: /^Skill$/ }).first(),
      ).toBeVisible({ timeout: SHELL_TIMEOUT });
      await expect(
        page.locator("span:visible", { hasText: /^Installs$/ }).first(),
      ).toBeVisible({ timeout: SHELL_TIMEOUT });
    });
  });

  // The deepest hop of the primary traversal. A skill page's breadcrumb and
  // title are both URL data, so there is nothing params-independent worth
  // rendering in a shared shell — which is why this route keeps its
  // `loading.tsx` and does NOT use the params-into-Suspense split the listing
  // routes do. `loading.tsx` is its shell, and this asserts that shell commits
  // with real structure (the "History" / "Documentation" section headings,
  // which the skeleton renders as text because neither depends on the skill’s
  // data) rather than the navigation blocking.
  test("/[org]/[repo] -> skill detail commits its shell instantly", async ({
    page,
  }) => {
    await page.goto(GITHUB_REPO_PATH);

    const skill = page.locator(`a[href^="${GITHUB_REPO_PATH}/"]`).first();
    await expect(skill).toBeVisible();
    const href = await skill.getAttribute("href");
    expect(href).toBeTruthy();

    await instant(page, async () => {
      await skill.click();
      await page.waitForURL((url) => url.pathname === href);
      await expect(
        page.locator("*:visible", { hasText: /^History$/ }).first(),
      ).toBeVisible({ timeout: SHELL_TIMEOUT });
      await expect(
        page.locator("*:visible", { hasText: /^Documentation$/ }).first(),
      ).toBeVisible({ timeout: SHELL_TIMEOUT });
    });
  });

  test("/[org] -> /[org]/[repo] commits its shell instantly", async ({
    page,
  }) => {
    await page.goto(GITHUB_ORG_PATH);

    const repo = page
      .locator(
        `main a[href^="${GITHUB_ORG_PATH}/"], a[href^="${GITHUB_ORG_PATH}/"]`,
      )
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
      ).toBeVisible({ timeout: SHELL_TIMEOUT });
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
        // Something `loading.tsx` itself draws. The brand link used to stand
        // here, but `AppHeader` renders it on every route from the layout, so
        // it was visible whether or not this route committed a shell of its
        // own — it proved nothing.
        await expect(
          page.locator('[data-slot="skeleton"]').first(),
        ).toBeVisible();
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

/**
 * One `<main>` per route, from the layout.
 *
 * `(main)/layout.tsx` owns the landmark for its whole group and pages render a
 * plain wrapper inside it. This guards both directions: a page that adds its own
 * `<main>` back would nest two, and a route that somehow escapes the layout
 * would have none.
 *
 * It exists because the silent case already shipped — `/[org]`, `/[org]/[repo]`
 * and `/site/[source]` ran for months with no landmark at all, which nothing
 * caught. Visible-only, because React parks streamed content in a `hidden`
 * container mid-swap and that copy is legitimately not a second landmark.
 */
test.describe("landmarks", () => {
  const routes = [
    ["home", "/"],
    ["org", GITHUB_ORG_PATH],
    ["repo", GITHUB_REPO_PATH],
    ["skill", GITHUB_SKILL_PATH],
    ["site", WELL_KNOWN_SOURCE_PATH],
    ["official", "/official"],
    ["compare", "/compare"],
    ["pricing", "/pricing"],
  ] as const;

  for (const [name, path] of routes) {
    test(`${name} renders exactly one visible <main>`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main:visible")).toHaveCount(1);
      // ...and it is the layout's, so the skip link has something to land on.
      await expect(page.locator("main:visible")).toHaveAttribute(
        "id",
        "main-content",
      );
    });
  }
});
