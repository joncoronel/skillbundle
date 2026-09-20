import { describe, it, expect } from "vitest";
import {
  CATEGORY_KEYS,
  categoryKeyFromSlug,
  isCategoryKey,
} from "@/convex/lib/categories";
import { categoryHref, categorySlug } from "@/lib/skill-urls";

/**
 * The slug rule is written twice on purpose — `categorySlug` in `lib/`, and
 * the `SLUG_TO_KEY` map in `convex/lib/categories.ts`, which the Convex
 * backend can reach and `lib/` imports would break. This file is what keeps
 * the copies honest.
 *
 * The failure it guards is nasty and silent: the sitemap builds its category
 * URLs from `categoryHref`, and the route resolves them with
 * `categoryKeyFromSlug`. If those two ever disagree about one key, that
 * category's page 404s while the sitemap keeps advertising it, and everything
 * else on the site still works.
 */

describe("category slugs", () => {
  it("round-trips every key", () => {
    for (const key of CATEGORY_KEYS) {
      expect(categoryKeyFromSlug(categorySlug(key))).toBe(key);
    }
  });

  it("produces a distinct slug per key", () => {
    const slugs = CATEGORY_KEYS.map(categorySlug);
    expect(new Set(slugs).size).toBe(CATEGORY_KEYS.length);
  });

  it("is lowercase and URL-safe, so a hand-typed link resolves", () => {
    // The whole reason slugs exist rather than using the camelCase keys
    // directly: a path segment is case-sensitive, so `/skills/gameDev` and
    // `/skills/gamedev` are different URLs.
    for (const slug of CATEGORY_KEYS.map(categorySlug)) {
      expect(slug).toBe(slug.toLowerCase());
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(encodeURIComponent(slug)).toBe(slug);
    }
  });

  it("kebab-cases the camelCase keys", () => {
    expect(categorySlug("gameDev")).toBe("game-dev");
    expect(categorySlug("codeReview")).toBe("code-review");
    expect(categorySlug("dataEngineering")).toBe("data-engineering");
    // Single-word keys pass through untouched.
    expect(categorySlug("frontend")).toBe("frontend");
  });

  it("rejects a slug that is not a category", () => {
    expect(categoryKeyFromSlug("not-a-category")).toBeUndefined();
    // The raw camelCase key is NOT a valid slug. Worth asserting: it is the
    // most likely thing for a stale link or an old `?cat=` copy-paste to
    // contain, and silently accepting it would create two URLs for one page.
    expect(categoryKeyFromSlug("gameDev")).toBeUndefined();
  });

  it("builds hrefs under the category namespace", () => {
    expect(categoryHref("gameDev")).toBe("/skills/game-dev");
  });

  it("keeps every key a key", () => {
    // Guards the assumption `categoryKeyFromSlug`'s return type encodes.
    for (const key of CATEGORY_KEYS) expect(isCategoryKey(key)).toBe(true);
  });
});
