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
});

describe("parseSkillInput — rejects", () => {
  test("empty string", () => {
    expect(() => parseSkillInput("")).toThrow(/empty/i);
  });

  test("whitespace-only string", () => {
    expect(() => parseSkillInput("   ")).toThrow(/empty/i);
  });

  test("non-skills.sh URL (github.com)", () => {
    // Regression for the silent-misroute bug: a github URL would otherwise
    // get split into ["https:", "github.com", "owner", "repo", ...] and
    // shipped to skills.sh as a confusing 404.
    expect(() =>
      parseSkillInput("https://github.com/vercel-labs/agent-skills"),
    ).toThrow(/skills\.sh/i);
  });

  test("non-skills.sh URL (random host)", () => {
    expect(() => parseSkillInput("https://example.com/foo/bar")).toThrow(
      /skills\.sh/i,
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
