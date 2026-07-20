/**
 * Unit tests for parseSkillInput (lib/parse-skill-input.ts).
 *
 * Pure function — no Convex runtime needed. Covers the matrix of accepted
 * input forms (URL, id, raw source/slug) plus the rejection paths.
 */
import { test, expect, describe } from "vitest";
import { parseSkillInput } from "../lib/parse-skill-input";

describe("parseSkillInput — accepts", () => {
  test("plain GitHub-style source/slug (3 segments)", () => {
    expect(parseSkillInput("vercel-labs/agent-skills/next-js-development")).toEqual({
      source: "vercel-labs/agent-skills",
      skillId: "next-js-development",
    });
  });

  test("plain well-known source/slug (2 segments, dot in source)", () => {
    expect(parseSkillInput("mintlify.com/mintlify")).toEqual({
      source: "mintlify.com",
      skillId: "mintlify",
    });
  });

  test("skills.sh URL", () => {
    expect(
      parseSkillInput(
        "https://skills.sh/vercel-labs/agent-skills/next-js-development",
      ),
    ).toEqual({
      source: "vercel-labs/agent-skills",
      skillId: "next-js-development",
    });
  });

  test("www.skills.sh URL", () => {
    expect(
      parseSkillInput("https://www.skills.sh/mintlify.com/mintlify"),
    ).toEqual({ source: "mintlify.com", skillId: "mintlify" });
  });

  test("URL with query string", () => {
    expect(
      parseSkillInput(
        "https://skills.sh/vercel-labs/agent-skills/next-js-development?utm_source=foo",
      ),
    ).toEqual({
      source: "vercel-labs/agent-skills",
      skillId: "next-js-development",
    });
  });

  test("URL with fragment", () => {
    expect(
      parseSkillInput(
        "https://skills.sh/vercel-labs/agent-skills/next-js-development#install",
      ),
    ).toEqual({
      source: "vercel-labs/agent-skills",
      skillId: "next-js-development",
    });
  });

  test("URL with trailing slash", () => {
    expect(
      parseSkillInput(
        "https://skills.sh/vercel-labs/agent-skills/next-js-development/",
      ),
    ).toEqual({
      source: "vercel-labs/agent-skills",
      skillId: "next-js-development",
    });
  });

  test("multi-segment slug (slash within skill name)", () => {
    // GitHub source = 2 segments, everything after is the slug, joined with
    // slashes. Mirrors the way the v1 API allows slugs with slashes for skills
    // named like "A/B Test Analysis".
    expect(
      parseSkillInput("vercel-labs/agent-skills/a/b-test-analysis"),
    ).toEqual({ source: "vercel-labs/agent-skills", skillId: "a/b-test-analysis" });
  });

  test("input with surrounding whitespace", () => {
    expect(parseSkillInput("  vercel-labs/agent-skills/next-js  ")).toEqual({
      source: "vercel-labs/agent-skills",
      skillId: "next-js",
    });
  });

  test("GitHub tree URL to the skill folder", () => {
    expect(
      parseSkillInput(
        "https://github.com/ibelick/ui-skills/tree/main/skills/improve-ui",
      ),
    ).toEqual({ source: "ibelick/ui-skills", skillId: "improve-ui" });
  });

  test("GitHub blob URL to the SKILL.md file (slug = parent folder)", () => {
    expect(
      parseSkillInput(
        "https://github.com/ibelick/ui-skills/blob/main/skills/improve-ui/SKILL.md",
      ),
    ).toEqual({ source: "ibelick/ui-skills", skillId: "improve-ui" });
  });

  test("GitHub tree URL with a slashed branch name (tail-derived slug survives)", () => {
    expect(
      parseSkillInput(
        "https://github.com/ibelick/ui-skills/tree/feat/new-stuff/skills/improve-ui",
      ),
    ).toEqual({ source: "ibelick/ui-skills", skillId: "improve-ui" });
  });

  test("raw.githubusercontent.com URL to the SKILL.md", () => {
    expect(
      parseSkillInput(
        "https://raw.githubusercontent.com/ibelick/ui-skills/main/skills/improve-ui/SKILL.md",
      ),
    ).toEqual({ source: "ibelick/ui-skills", skillId: "improve-ui" });
  });

  test("raw.githubusercontent.com refs/heads form", () => {
    expect(
      parseSkillInput(
        "https://raw.githubusercontent.com/ibelick/ui-skills/refs/heads/main/skills/improve-ui/SKILL.md",
      ),
    ).toEqual({ source: "ibelick/ui-skills", skillId: "improve-ui" });
  });

  test("www.github.com URL", () => {
    expect(
      parseSkillInput(
        "https://www.github.com/ibelick/ui-skills/tree/main/skills/improve-ui",
      ),
    ).toEqual({ source: "ibelick/ui-skills", skillId: "improve-ui" });
  });
});

describe("parseSkillInput — rejects", () => {
  test("empty string", () => {
    expect(() => parseSkillInput("")).toThrow(/empty/i);
  });

  test("whitespace-only string", () => {
    expect(() => parseSkillInput("   ")).toThrow(/empty/i);
  });

  test("GitHub repo-root URL (no skill path to derive a slug from)", () => {
    // Repo URLs are recognized now, but there's no slug to derive — the error
    // guides the admin to link the skill's folder instead.
    expect(() =>
      parseSkillInput("https://github.com/vercel-labs/agent-skills"),
    ).toThrow(/link the skill's folder/i);
  });

  test("GitHub tree URL to the branch root (still no slug)", () => {
    expect(() =>
      parseSkillInput("https://github.com/vercel-labs/agent-skills/tree/main"),
    ).toThrow(/link the skill's folder/i);
  });

  test("GitHub blob URL to a root-level SKILL.md (no parent folder = no slug)", () => {
    expect(() =>
      parseSkillInput(
        "https://github.com/vercel-labs/agent-skills/blob/main/SKILL.md",
      ),
    ).toThrow(/link the skill's folder/i);
  });

  test("non-content GitHub URLs (issues, pulls, releases) get guidance, not a garbage slug", () => {
    // Without the tree/blob-or-nothing guard these would derive skillId "123",
    // "pulls", "v1.2" and surface as a misleading "no matching SKILL.md".
    for (const url of [
      "https://github.com/owner/repo/issues/123",
      "https://github.com/owner/repo/pulls",
      "https://github.com/owner/repo/releases/tag/v1.2",
    ]) {
      expect(() => parseSkillInput(url)).toThrow(/link the skill's folder/i);
    }
  });

  test("unrecognized-host URL (random host)", () => {
    expect(() => parseSkillInput("https://example.com/foo/bar")).toThrow(
      /skills\.sh or github\.com/i,
    );
  });

  test("bare domain (looks like a typo of a URL)", () => {
    // Single-segment input containing a dot — common admin typo of pasting
    // a domain without the protocol. We surface a hint rather than the
    // generic "Invalid skill input" message.
    expect(() => parseSkillInput("mintlify.com")).toThrow(/looks like a domain/i);
    expect(() => parseSkillInput("google.com")).toThrow(/looks like a domain/i);
  });

  test("source with no slug (GitHub, only owner/repo)", () => {
    expect(() => parseSkillInput("vercel-labs/agent-skills")).toThrow(
      /Slug is missing/i,
    );
  });

  test("single segment with no dot", () => {
    expect(() => parseSkillInput("just-a-word")).toThrow(/source\/slug|Invalid/i);
  });

  test("skills.sh URL with no path", () => {
    expect(() => parseSkillInput("https://skills.sh/")).toThrow(/empty|Invalid/i);
  });
});
