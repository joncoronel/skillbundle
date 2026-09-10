import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  GITHUB_ORG_PATH,
  GITHUB_REPO_PATH,
  GITHUB_SKILL_PATH,
  WELL_KNOWN_SOURCE_PATH,
} from "./fixtures";

/**
 * Every shareable page's `og:image` must load, and its canonical and `og:url`
 * must name the page itself.
 *
 * Exists because the silent case shipped. Skill pages pointed at
 * `.../opengraph-image` for a week while the image was served at
 * `.../opengraph-image-1ak9wt`: Next hashes a metadata route's URL whenever its
 * folder path contains a route group. The page rendered normally, so nothing
 * noticed, and every shared skill link unfurled with no image. See
 * `skillTabMetadata` in lib/skill-tab-route.tsx.
 *
 * HTTP only, no browser: this is a contract on the document and one image
 * request, and a page load would add nothing but time. The whole document is
 * searched rather than `<head>`, because Next may stream metadata into the body.
 *
 * Tag URLs are absolute on `metadataBase`, which is the real site or
 * localhost:3000, never this test server. Only the path is requested.
 */

/**
 * `[name, page path, image folder]`. The folder is where the page's card must
 * come from: its own `opengraph-image`, a parent's, or `""` for the site-wide
 * card. A 200 PNG alone is not enough, because a page that lost its own image
 * would still inherit a parent's and load fine.
 */
const ROUTES = [
  ["home", "/", ""],
  ["org", GITHUB_ORG_PATH, GITHUB_ORG_PATH],
  ["repo", GITHUB_REPO_PATH, GITHUB_REPO_PATH],
  ["skill", GITHUB_SKILL_PATH, GITHUB_SKILL_PATH],
  // A tab is a deeper segment than the image file, which is the case that broke.
  ["skill tab", `${GITHUB_SKILL_PATH}/history`, GITHUB_SKILL_PATH],
  ["site", WELL_KNOWN_SOURCE_PATH, WELL_KNOWN_SOURCE_PATH],
  ["official", "/official", "/official"],
  ["compare", "/compare", "/compare"],
  ["pricing", "/pricing", "/pricing"],
  ["add", "/add", ""],
  ["privacy", "/privacy", ""],
  ["terms", "/terms", ""],
] as const;

function tag(html: string, pattern: RegExp): string | undefined {
  return html.match(pattern)?.[1];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function assertShareMetadata(
  request: APIRequestContext,
  path: string,
  imageFolder: string,
) {
  const response = await request.get(path);
  expect(response.status()).toBe(200);
  const html = await response.text();

  const canonical = tag(html, /<link rel="canonical" href="([^"]+)"/);
  const ogUrl = tag(html, /<meta property="og:url" content="([^"]+)"/);
  const ogImage = tag(html, /<meta property="og:image" content="([^"]+)"/);

  expect(canonical, "canonical").toBeDefined();
  expect(ogUrl, "og:url").toBe(canonical);
  // By pathname, because Next writes the home URL without its trailing slash.
  expect(new URL(canonical!).pathname).toBe(path);
  expect(ogImage, "og:image").toBeDefined();

  const { pathname, search } = new URL(ogImage!);
  // The hash suffix appears when the folder sits inside a route group.
  expect(pathname).toMatch(
    new RegExp(`^${escapeRegExp(imageFolder)}/opengraph-image(-[a-z0-9]+)?$`),
  );
  const image = await request.get(pathname + search);
  expect(image.status(), `og:image ${pathname}`).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");
}

test.describe("share metadata", () => {
  for (const [name, path, imageFolder] of ROUTES) {
    test(`${name}: og:image loads, canonical and og:url name the page`, async ({
      request,
    }) => {
      await assertShareMetadata(request, path, imageFolder);
    });
  }

  // Discovered rather than pinned, like the client-navigation specs: the
  // well-known namespace has its own image route with its own hash.
  test("site skill: og:image loads, canonical and og:url name the page", async ({
    request,
  }) => {
    const listing = await (await request.get(WELL_KNOWN_SOURCE_PATH)).text();
    const path = tag(
      listing,
      new RegExp(`href="(${escapeRegExp(WELL_KNOWN_SOURCE_PATH)}/[^"/?#]+)"`),
    );
    expect(path, "a skill link on the source page").toBeDefined();
    await assertShareMetadata(request, path!, path!);
  });
});
