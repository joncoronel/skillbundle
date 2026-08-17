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
    expect(
      parseSkillInput("vercel-labs/agent-skills/next-js-development"),
    ).toEqual({
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
    ).toEqual({
      source: "vercel-labs/agent-skills",
      skillId: "a/b-test-analysis",
    });
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
    ).toEqual({
      source: "ibelick/ui-skills",
      skillId: "improve-ui",
      // A tree URL names the FOLDER, so the file path is conventional rather
      // than certain. The resolver fetches it and falls back if it 404s.
      path: "skills/improve-ui/SKILL.md",
    });
  });

  test("GitHub blob URL to the SKILL.md file (slug = parent folder)", () => {
    expect(
      parseSkillInput(
        "https://github.com/ibelick/ui-skills/blob/main/skills/improve-ui/SKILL.md",
      ),
    ).toEqual({
      source: "ibelick/ui-skills",
      skillId: "improve-ui",
      // Exactly the file the link named — the case the hint exists for.
      path: "skills/improve-ui/SKILL.md",
    });
  });

  test("GitHub blob URL to a ROOT-level SKILL.md (slug falls back to repo name)", () => {
    // Single-skill repos keep their SKILL.md at the root — no parent folder to
    // name the slug, so we use the repo name (what skills.sh uses for it). The
    // resolver re-verifies against the file's frontmatter, so a wrong guess on
    // a monorepo fails cleanly rather than adding a mis-slugged row.
    expect(
      parseSkillInput(
        "https://github.com/petergyang/no-ai-slop/blob/main/SKILL.md",
      ),
    ).toEqual({
      source: "petergyang/no-ai-slop",
      skillId: "no-ai-slop",
      path: "SKILL.md",
    });
  });

  test("raw.githubusercontent.com URL to a ROOT-level SKILL.md (repo-name slug)", () => {
    expect(
      parseSkillInput(
        "https://raw.githubusercontent.com/petergyang/no-ai-slop/main/SKILL.md",
      ),
    ).toEqual({
      source: "petergyang/no-ai-slop",
      skillId: "no-ai-slop",
      path: "SKILL.md",
    });
  });

  test("GitHub tree URL with a slashed branch name (tail-derived slug survives)", () => {
    expect(
      parseSkillInput(
        "https://github.com/ibelick/ui-skills/tree/feat/new-stuff/skills/improve-ui",
      ),
    ).toEqual({
      source: "ibelick/ui-skills",
      skillId: "improve-ui",
      // The slug survives because it is the TAIL. The path does NOT: only
      // "tree" and one branch segment are dropped, so the rest of a slashed
      // branch name ("new-stuff") stays glued to the front. GitHub's URL shape
      // makes this genuinely ambiguous — you cannot tell a branch segment from
      // a directory without asking the API.
      //
      // Asserted as-is because the wrongness is contained by design: the hint
      // is fetched on the default branch, a miss 404s, and the resolver falls
      // through to the full tree walk. Costs one cheap request on an unusual
      // URL rather than a wrong answer.
      path: "new-stuff/skills/improve-ui/SKILL.md",
    });
  });

  test("raw.githubusercontent.com URL to the SKILL.md", () => {
    expect(
      parseSkillInput(
        "https://raw.githubusercontent.com/ibelick/ui-skills/main/skills/improve-ui/SKILL.md",
      ),
    ).toEqual({
      source: "ibelick/ui-skills",
      skillId: "improve-ui",
      path: "skills/improve-ui/SKILL.md",
    });
  });

  test("raw.githubusercontent.com refs/heads form", () => {
    expect(
      parseSkillInput(
        "https://raw.githubusercontent.com/ibelick/ui-skills/refs/heads/main/skills/improve-ui/SKILL.md",
      ),
    ).toEqual({
      source: "ibelick/ui-skills",
      skillId: "improve-ui",
      path: "skills/improve-ui/SKILL.md",
    });
  });

  test("www.github.com URL", () => {
    expect(
      parseSkillInput(
        "https://www.github.com/ibelick/ui-skills/tree/main/skills/improve-ui",
      ),
    ).toEqual({
      source: "ibelick/ui-skills",
      skillId: "improve-ui",
      path: "skills/improve-ui/SKILL.md",
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
    expect(() => parseSkillInput("mintlify.com")).toThrow(
      /looks like a domain/i,
    );
    expect(() => parseSkillInput("google.com")).toThrow(/looks like a domain/i);
  });

  test("source with no slug (GitHub, only owner/repo)", () => {
    expect(() => parseSkillInput("vercel-labs/agent-skills")).toThrow(
      /Slug is missing/i,
    );
  });

  test("single segment with no dot", () => {
    expect(() => parseSkillInput("just-a-word")).toThrow(
      /source\/slug|Invalid/i,
    );
  });

  test("skills.sh URL with no path", () => {
    expect(() => parseSkillInput("https://skills.sh/")).toThrow(
      /empty|Invalid/i,
    );
  });

  test("scheme-less URL, the shape that used to parse to the HOST as source", () => {
    // Without a scheme `new URL` fails and the raw path is used, where the
    // dot in "github.com" marks it a well-known source and the entire rest
    // becomes the slug. It parsed cleanly and was always wrong: downstream it
    // surfaced as "Only GitHub repos can be added" about a github.com link.
    for (const input of [
      "github.com/anthropics/skills/tree/main/skills/frontend-design",
      "skills.sh/anthropics/skills/frontend-design",
      "raw.githubusercontent.com/anthropics/skills/main/skills/x/SKILL.md",
    ]) {
      expect(() => parseSkillInput(input)).toThrow(/Add "https:\/\/"/i);
    }
  });

  test("scheme-less URL keeps failing when it carries a www. prefix", () => {
    // The `^www\.` strip only runs for inputs that parse as a real URL, so a
    // scheme-less one reaches the source check with the prefix intact.
    expect(() =>
      parseSkillInput(
        "www.github.com/ibelick/ui-skills/tree/main/skills/improve-ui",
      ),
    ).toThrow(/Add "https:\/\/"/i);
  });

  test("a well-known source that is NOT a site host still parses", () => {
    // The scheme check must reject the three site hosts only. A genuine
    // well-known source is the reason the 1-segment form exists.
    expect(parseSkillInput("mintlify.com/mintlify")).toEqual({
      source: "mintlify.com",
      skillId: "mintlify",
    });
  });

  test("the echoed input is length-capped in the message", () => {
    // Messages quote what was pasted, and what gets pasted here is long
    // unbreakable machine strings. Uncapped, one paste becomes a paragraph
    // that the live readout renders per keystroke.
    const long = `${"a".repeat(200)}/`;
    let message = "";
    try {
      parseSkillInput(long);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/…/);
    expect(message.length).toBeLessThan(200);
  });
});
