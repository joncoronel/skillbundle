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
  RESERVED_ROOT_SEGMENTS,
  type SitemapSkillRow,
} from "../lib/sitemap-entries";
import robots from "../app/robots";

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
    // Defence in depth beneath the routability filter: Next interpolates `url`
    // into <loc> unescaped, so raw markup would invalidate the whole file.
    for (const url of urls([{ source: "owner/repo", skillId: "a.b_c-d" }])) {
      expect(url).not.toMatch(/[<>&"]/);
    }
  });
});

describe("unroutable rows are dropped, not escaped", () => {
  // The skill routes call buildSkillInstallCommand and notFound() on null, so
  // these slugs 404 whether they arrive raw or percent-encoded. Real catalog
  // shapes: 126 rows as of Aug 2026.
  test.each([
    ["a colon in the skill id", "google-labs-code/stitch-skills", "react:components"],
    ["an ampersand in the skill id", "claude-office-skills/skills", "pdf-merge-&-split"],
    ["a slash in the skill id (4-segment path)", "claude-office-skills/skills", "facebook/meta-ads"],
    ["a colon in the source", "owner/re:po", "fine-slug"],
  ])("drops %s", (_label, source, skillId) => {
    const result = urls([{ source, skillId }]);
    for (const url of result) {
      expect(url).not.toContain("%");
    }
    expect(result.some((u) => u.includes(skillId.split("/")[0]))).toBe(false);
  });

  test("an unroutable skill contributes nothing to its parents", () => {
    const rows: SitemapSkillRow[] = [
      { source: "owner/repo", skillId: "bad:id", contentUpdatedAt: FEB },
      { source: "owner/repo", skillId: "good-id", contentUpdatedAt: JAN },
    ];
    // Only the good skill exists, and FEB never reaches the rollup.
    expect(urls(rows)).toContain(`${BASE}/owner/repo/good-id`);
    expect(find(rows, `${BASE}/owner/repo`)?.lastModified).toEqual(
      new Date(JAN),
    );
  });

  test("a source whose every skill is unroutable disappears entirely", () => {
    const result = urls([{ source: "owner/repo", skillId: "bad:id" }]);
    expect(result).not.toContain(`${BASE}/owner/repo`);
    expect(result).not.toContain(`${BASE}/owner`);
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

  test("the fallback is refused where contentFetchedAt proves nothing", () => {
    // Each of these stamps contentFetchedAt without having read an unchanged
    // file, so honouring it would advertise a change that never happened.
    const cases: Array<[string, SitemapSkillRow, string]> = [
      [
        "well-known sources are re-fetched daily",
        { source: "open.feishu.cn", skillId: "a", contentFetchedAt: JAN },
        `${BASE}/site/open.feishu.cn/a`,
      ],
      [
        "the fetch is currently failing",
        {
          source: "owner/repo",
          skillId: "b",
          contentFetchedAt: JAN,
          hasContentFetchError: true,
        },
        `${BASE}/owner/repo/b`,
      ],
      [
        "there was never a SKILL.md URL to read",
        {
          source: "owner/repo",
          skillId: "c",
          contentFetchedAt: JAN,
          hasSkillMdUrl: false,
        },
        `${BASE}/owner/repo/c`,
      ],
    ];
    for (const [label, row, url] of cases) {
      const entry = find([row], url);
      expect(entry, label).toBeDefined();
      expect(entry?.lastModified, label).toBeUndefined();
    }
  });

  test("a real contentUpdatedAt still wins in all of those cases", () => {
    const entry = find(
      [
        {
          source: "open.feishu.cn",
          skillId: "a",
          contentUpdatedAt: JAN,
          contentFetchedAt: FEB,
          hasContentFetchError: true,
        },
      ],
      `${BASE}/site/open.feishu.cn/a`,
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
  // Derived from app/robots.ts rather than hand-copied, so adding a disallow
  // rule there without teaching the sitemap about it fails here. The previous
  // version of this test duplicated the list and fed it only synthetic rows,
  // which is why it passed while the real build shipped 10 `/api/git*` URLs
  // that robots.txt forbids.
  const wildcardDisallows = (() => {
    const { rules } = robots();
    const list = Array.isArray(rules) ? rules : [rules];
    const wildcard = list.find((r) => r.userAgent === "*");
    const disallow = wildcard?.disallow ?? [];
    return (Array.isArray(disallow) ? disallow : [disallow])
      // `/compare?` bans the query form, not the page; the sitemap never emits
      // a query string, asserted separately below.
      .filter((p) => !p.includes("?"))
      .map((p) => p.replace(/\$$/, ""));
  })();

  test("every disallowed root segment is one the sitemap refuses to emit", () => {
    expect(wildcardDisallows.length).toBeGreaterThan(0);
    for (const prefix of wildcardDisallows) {
      const segment = prefix.replace(/^\//, "").replace(/\/$/, "");
      expect(RESERVED_ROOT_SEGMENTS.has(segment)).toBe(true);
    }
  });

  test("a real colliding org (there is one named `api`) is dropped", () => {
    const result = urls([
      { source: "api/git", skillId: "agent-memory" },
      { source: "owner/repo", skillId: "fine" },
    ]);
    expect(result.some((u) => u.includes("/api"))).toBe(false);
    expect(result).toContain(`${BASE}/owner/repo/fine`);
  });

  test("nothing disallowed is listed, and no entry carries a query string", () => {
    const result = urls([
      { source: "owner/repo", skillId: "a" },
      { source: "open.feishu.cn", skillId: "b" },
      { source: "dev/tools", skillId: "c" },
      { source: "settings/x", skillId: "d" },
    ]);
    for (const url of result) {
      const path = url.slice(BASE.length);
      for (const prefix of wildcardDisallows) {
        expect(path.startsWith(prefix)).toBe(false);
      }
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
