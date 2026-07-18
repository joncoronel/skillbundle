/**
 * Unit tests for lib/repo-match.ts — the shared repo-match predicate and its
 * canonical GitHub URL/slug parser.
 *
 * Pure functions — no Convex runtime needed. `extractRepoSlug` is THE parser
 * used by both the client and convex/recommendations.ts, so its edge cases
 * (query/fragment stripping order, look-alike hosts, path-unsafe segments)
 * are covered directly here rather than only indirectly through the gate.
 */
import { test, expect, describe } from "vitest";
import {
  extractRepoSlug,
  matchesDemoRepo,
  isRepoMatchAllowed,
} from "../lib/repo-match";

describe("extractRepoSlug — accepts", () => {
  test("https URL", () => {
    expect(extractRepoSlug("https://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  test("http + www + extra path segments", () => {
    expect(
      extractRepoSlug("http://www.github.com/owner/repo/tree/main"),
    ).toEqual({ owner: "owner", repo: "repo" });
  });

  test("no protocol", () => {
    expect(extractRepoSlug("github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  test("bare owner/repo slug", () => {
    expect(extractRepoSlug("owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  test("trailing slash stripped", () => {
    expect(extractRepoSlug("https://github.com/owner/repo/")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  test(".git suffix stripped", () => {
    expect(extractRepoSlug("https://github.com/o/r.git")).toEqual({
      owner: "o",
      repo: "r",
    });
  });

  test("documented ordering bug-guard: query/fragment stripped before .git", () => {
    // Fragment stripped BEFORE .git suffix removal — otherwise repo would
    // parse as "ui.git" and miss the demo allowlist.
    expect(
      extractRepoSlug("https://github.com/shadcn-ui/ui.git#readme"),
    ).toEqual({ owner: "shadcn-ui", repo: "ui" });
  });

  test("query param stripped", () => {
    expect(
      extractRepoSlug("https://github.com/owner/repo?tab=readme"),
    ).toEqual({ owner: "owner", repo: "repo" });
  });
});

describe("extractRepoSlug — rejects", () => {
  test("missing repo segment", () => {
    expect(extractRepoSlug("https://github.com/owner")).toBeNull();
  });

  test("github.com-looking non-match not salvaged as a bare slug", () => {
    expect(extractRepoSlug("github.com/broken")).toBeNull();
  });

  test("look-alike host", () => {
    expect(extractRepoSlug("mygithub.com/a/b")).toBeNull();
  });

  test("path-unsafe owner segment (..)", () => {
    expect(extractRepoSlug("owner/..")).toBeNull();
  });

  test("path-unsafe repo segment (.)", () => {
    expect(extractRepoSlug("./repo")).toBeNull();
  });

  test("URL embedded in prose is not anchored/matched", () => {
    expect(extractRepoSlug("check out https://github.com/a/b")).toBeNull();
  });
});

describe("matchesDemoRepo", () => {
  test("exact-case match", () => {
    expect(matchesDemoRepo("shadcn-ui", "ui")).toBe(true);
  });

  test("case-insensitive match", () => {
    expect(matchesDemoRepo("ShAdCn-Ui", "Ui")).toBe(true);
  });

  test("non-demo repo", () => {
    expect(matchesDemoRepo("shadcn-ui", "uix")).toBe(false);
  });
});

describe("isRepoMatchAllowed", () => {
  test("demo repo + canAutoDetect false → allowed", () => {
    expect(
      isRepoMatchAllowed({ canAutoDetect: false }, "shadcn-ui", "ui"),
    ).toBe(true);
  });

  test("non-demo repo + canAutoDetect false → denied", () => {
    expect(
      isRepoMatchAllowed({ canAutoDetect: false }, "vercel", "next.js"),
    ).toBe(false);
  });

  test("non-demo repo + canAutoDetect true → allowed", () => {
    expect(
      isRepoMatchAllowed({ canAutoDetect: true }, "vercel", "next.js"),
    ).toBe(true);
  });
});
