/**
 * Unit tests for lib/sitemap-entries.ts.
 *
 * Pure function — no Convex runtime needed. The route (app/sitemap.ts) is a
 * thin wrapper around it, so this covers the parts a broken sitemap fails
 * silently on: URL shape per source type, the `lastmod` rollup onto directory
 * pages, and agreement with app/robots.ts about what may be listed.
 */
import { test, expect, describe } from "vitest";
import {
  buildSitemapEntries,
  type SitemapSkillRow,
} from "../lib/sitemap-entries";

const BASE = "https://skillbundle.dev";

const urls = (rows: SitemapSkillRow[]) =>
  buildSitemapEntries(rows, BASE).map((e) => e.url);

const find = (rows: SitemapSkillRow[], url: string) =>
  buildSitemapEntries(rows, BASE).find((e) => e.url === url);

const JAN = Date.UTC(2026, 0, 1);
const FEB = Date.UTC(2026, 1, 1);

describe("URL shapes", () => {
  test("a GitHub skill contributes its page, its repo and its org", () => {
    const result = urls([{ source: "owner/repo", skillId: "my-skill" }]);
    expect(result).toContain(`${BASE}/owner/repo/my-skill`);
    expect(result).toContain(`${BASE}/owner/repo`);
    expect(result).toContain(`${BASE}/owner`);
  });

  test("a well-known source is /site/-prefixed and has no org page", () => {
    const result = urls([{ source: "open.feishu.cn", skillId: "lark" }]);
    expect(result).toContain(`${BASE}/site/open.feishu.cn/lark`);
    expect(result).toContain(`${BASE}/site/open.feishu.cn`);
    // The dotted domain is one segment; there is no `/open.feishu.cn` route,
    // and emitting one would advertise a 404 (or worse, an unrelated org).
    expect(result).not.toContain(`${BASE}/open.feishu.cn`);
  });

  test("repo and org pages appear once no matter how many skills they hold", () => {
    const result = urls([
      { source: "owner/repo", skillId: "a" },
      { source: "owner/repo", skillId: "b" },
      { source: "owner/other", skillId: "c" },
    ]);
    expect(result.filter((u) => u === `${BASE}/owner/repo`)).toHaveLength(1);
    expect(result.filter((u) => u === `${BASE}/owner`)).toHaveLength(1);
    expect(result.filter((u) => u === `${BASE}/owner/other`)).toHaveLength(1);
  });

  test("every URL is absolute and singly-slashed", () => {
    for (const url of urls([{ source: "owner/repo", skillId: "a" }])) {
      expect(url.startsWith(`${BASE}/`) || url === BASE).toBe(true);
      expect(url.slice(BASE.length)).not.toContain("//");
    }
  });

  test("path segments are encoded, so no slug can break the XML", () => {
    // Not a slug shape we have today — the point is that if one ever appears,
    // it lands as %-escapes rather than as raw markup inside <loc>.
    const result = urls([{ source: "owner/re&po", skillId: "a<b" }]);
    expect(result).toContain(`${BASE}/owner/re%26po/a%3Cb`);
    for (const url of result) {
      expect(url).not.toMatch(/[<>&"]/);
    }
  });
});

describe("lastModified", () => {
  test("a skill carries its own contentUpdatedAt", () => {
    const entry = find(
      [{ source: "owner/repo", skillId: "a", contentUpdatedAt: JAN }],
      `${BASE}/owner/repo/a`,
    );
    expect(entry?.lastModified).toEqual(new Date(JAN));
  });

  test("directory pages roll up to their newest child", () => {
    const rows: SitemapSkillRow[] = [
      { source: "owner/repo", skillId: "a", contentUpdatedAt: JAN },
      { source: "owner/repo", skillId: "b", contentUpdatedAt: FEB },
    ];
    expect(find(rows, `${BASE}/owner/repo`)?.lastModified).toEqual(
      new Date(FEB),
    );
    expect(find(rows, `${BASE}/owner`)?.lastModified).toEqual(new Date(FEB));
    // The home and curated pages are views over the whole catalog.
    expect(find(rows, BASE)?.lastModified).toEqual(new Date(FEB));
    expect(find(rows, `${BASE}/official`)?.lastModified).toEqual(new Date(FEB));
  });

  test("contentFetchedAt stands in when the file has never been seen to move", () => {
    // The common case: contentUpdatedAt is only written by a fetch that found
    // the hash changed, so most of the catalog has only contentFetchedAt.
    const entry = find(
      [{ source: "owner/repo", skillId: "a", contentFetchedAt: JAN }],
      `${BASE}/owner/repo/a`,
    );
    expect(entry?.lastModified).toEqual(new Date(JAN));
  });

  test("contentUpdatedAt wins over contentFetchedAt, even when older", () => {
    // Ordinary shape: fetched last week, last actually changed in January. The
    // page's content is January's.
    const entry = find(
      [
        {
          source: "owner/repo",
          skillId: "a",
          contentUpdatedAt: JAN,
          contentFetchedAt: FEB,
        },
      ],
      `${BASE}/owner/repo/a`,
    );
    expect(entry?.lastModified).toEqual(new Date(JAN));
  });

  test("a skill with neither timestamp is listed without a lastmod", () => {
    const entry = find(
      [{ source: "owner/repo", skillId: "a" }],
      `${BASE}/owner/repo/a`,
    );
    expect(entry).toBeDefined();
    expect(entry?.lastModified).toBeUndefined();
  });

  test("a missing timestamp doesn't drag its parents' rollup down", () => {
    const rows: SitemapSkillRow[] = [
      { source: "owner/repo", skillId: "a" },
      { source: "owner/repo", skillId: "b", contentUpdatedAt: JAN },
    ];
    expect(find(rows, `${BASE}/owner/repo`)?.lastModified).toEqual(
      new Date(JAN),
    );
  });

  test("the rollup compares the coalesced value, not the raw fields", () => {
    // Sibling b has no contentUpdatedAt at all, so the rollup has to fall back
    // to its fetch time — rolling up the raw field would report January and
    // tell a crawler the repo page is a month staler than it is.
    const rows: SitemapSkillRow[] = [
      { source: "owner/repo", skillId: "a", contentUpdatedAt: JAN },
      { source: "owner/repo", skillId: "b", contentFetchedAt: FEB },
    ];
    expect(find(rows, `${BASE}/owner/repo`)?.lastModified).toEqual(
      new Date(FEB),
    );
  });

  test("static pages carry no lastmod — their content is the deploy, not the catalog", () => {
    const rows: SitemapSkillRow[] = [
      { source: "owner/repo", skillId: "a", contentUpdatedAt: JAN },
    ];
    for (const path of ["/add", "/pricing", "/compare"]) {
      const entry = find(rows, `${BASE}${path}`);
      expect(entry).toBeDefined();
      expect(entry?.lastModified).toBeUndefined();
    }
  });
});

describe("agreement with robots.txt", () => {
  test("nothing disallowed by app/robots.ts is listed", () => {
    const result = urls([
      { source: "owner/repo", skillId: "a" },
      { source: "open.feishu.cn", skillId: "b" },
    ]);
    const disallowed = [
      "/api/",
      "/dashboard",
      "/settings",
      "/dev",
      "/sign-in",
      "/sign-up",
    ];
    for (const url of result) {
      const path = url.slice(BASE.length);
      for (const prefix of disallowed) {
        expect(path.startsWith(prefix)).toBe(false);
      }
      // `/compare?skills=...` is the disallowed form; the bare page is allowed.
      expect(path).not.toContain("?");
    }
  });
});

describe("empty catalog", () => {
  test("still lists the static pages, with no catalog lastmod", () => {
    const result = buildSitemapEntries([], BASE);
    expect(result.map((e) => e.url)).toEqual([
      BASE,
      `${BASE}/official`,
      `${BASE}/add`,
      `${BASE}/pricing`,
      `${BASE}/compare`,
    ]);
    expect(result.every((e) => e.lastModified === undefined)).toBe(true);
  });
});
