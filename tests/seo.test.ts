import { describe, it, expect } from "vitest";
import {
  skillPageTitle,
  skillTabTitle,
  skillPageDescription,
  truncateWords,
  sourceOwner,
} from "@/lib/seo";

/**
 * Pure text rules, so they test like `tests/sitemap-entries.test.ts` does — no
 * Convex deployment, no render.
 *
 * The point of testing them at all is that every failure mode here is SILENT.
 * A title that quietly drops its publisher, or a description that reads "1
 * installs", is a correct-looking page; the only place it shows up is a search
 * result three weeks later, and nothing in `pnpm check` or the e2e suite looks
 * at `<head>`.
 */

describe("sourceOwner", () => {
  it("takes the org from a GitHub source", () => {
    expect(sourceOwner("anthropics/skills")).toBe("anthropics");
  });

  it("returns a well-known source's bare domain unchanged", () => {
    expect(sourceOwner("smithery.ai")).toBe("smithery.ai");
  });
});

describe("truncateWords", () => {
  it("leaves a short string alone, with no ellipsis", () => {
    expect(truncateWords("short enough", 40)).toBe("short enough");
  });

  it("collapses the whitespace a SKILL.md frontmatter block carries", () => {
    expect(truncateWords("a\n  b\tc", 40)).toBe("a b c");
  });

  it("breaks on a word boundary rather than mid-word", () => {
    const out = truncateWords("alpha bravo charlie delta", 18);
    expect(out).toBe("alpha bravo…");
    expect(out.length).toBeLessThanOrEqual(18);
  });

  it("still cuts a single token longer than the budget", () => {
    // No space to break on. Returning the whole token would blow the budget
    // silently, which is the one thing this helper exists to prevent.
    const out = truncateWords("a".repeat(50), 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("skillPageTitle", () => {
  it("names the publisher, so same-named skills get distinct titles", () => {
    const a = skillPageTitle("skill-creator", "anthropics/skills");
    const b = skillPageTitle("skill-creator", "openai/skills");
    expect(a).not.toBe(b);
    expect(a).toContain("anthropics");
    expect(b).toContain("openai");
  });

  it("keeps the brand suffix when there is room", () => {
    expect(skillPageTitle("pdf", "anthropics/skills")).toBe(
      "pdf skill by anthropics | SkillBundle",
    );
  });

  it("drops the brand rather than truncating the publisher", () => {
    const title = skillPageTitle(
      "next-cache-components-optimizer",
      "vercel-labs-experimental",
    );
    expect(title).not.toContain("SkillBundle");
    expect(title).toContain("vercel-labs-experimental");
  });
});

describe("skillTabTitle", () => {
  it("disambiguates by publisher the same way the Overview does", () => {
    expect(
      skillTabTitle("skill-creator", "openai/skills", "history"),
    ).toContain("openai");
  });
});

describe("skillPageDescription", () => {
  it("stays inside the ~160 character budget", () => {
    const long = "Use this skill whenever the user ".repeat(20);
    const out = skillPageDescription("pdf", "anthropics/skills", 1200, long);
    expect(out.length).toBeLessThanOrEqual(160);
  });

  it("differs between two skills that share a SKILL.md", () => {
    const shared = "Create new skills, modify and improve existing skills.";
    const a = skillPageDescription(
      "skill-creator",
      "anthropics/skills",
      900,
      shared,
    );
    const b = skillPageDescription(
      "skill-creator",
      "openai/skills",
      400,
      shared,
    );
    expect(a).not.toBe(b);
  });

  it("says 'install' for one and 'installs' for many", () => {
    expect(skillPageDescription("pdf", "a/b", 1, "x")).toContain("1 install.");
    expect(skillPageDescription("pdf", "a/b", 2, "x")).toContain("2 installs.");
  });

  it("omits the count entirely rather than claiming zero installs", () => {
    // A GitHub-only skill has no upstream count. "0 installs" would read as a
    // dead skill rather than an unmeasured one.
    const out = skillPageDescription("pdf", "a/b", 0, "Does a thing.");
    expect(out).not.toContain("0 install");
    expect(out).toContain("pdf is an agent skill from a.");
  });

  it("falls back to its own copy when the skill has no description", () => {
    const out = skillPageDescription("pdf", "a/b", 5, undefined);
    expect(out).toContain("npx skills add");
  });
});
