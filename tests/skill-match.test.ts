/**
 * Unit tests for convex/lib/skillMatch.ts.
 *
 * Pure functions — no Convex runtime needed.
 *
 * `canonicalSlug` is the write-side guard: its output can become a row's
 * permanent `skillId` AND a single URL path segment, so the interesting cases
 * are the ones it must REFUSE rather than mangle. `kebabCase` only lowercases
 * and collapses whitespace, so every other punctuation character survives it
 * intact and would otherwise be persisted.
 */
import { test, expect, describe } from "vitest";
import {
  canonicalSlug,
  kebabCase,
  matchesSkillId,
} from "../convex/lib/skillMatch";

describe("canonicalSlug — accepts", () => {
  test("an already-kebab frontmatter name (the namespaced-repo case)", () => {
    expect(canonicalSlug("vercel-react-view-transitions")).toBe(
      "vercel-react-view-transitions",
    );
  });

  test("spaced title case", () => {
    expect(canonicalSlug("Next JS Development")).toBe("next-js-development");
  });

  test("surrounding and repeated whitespace", () => {
    expect(canonicalSlug("  Deploy   To Vercel  ")).toBe("deploy-to-vercel");
  });

  test("dots, underscores and digits, which the route and install command allow", () => {
    expect(canonicalSlug("next.js_16-beta2")).toBe("next.js_16-beta2");
  });
});

describe("canonicalSlug — refuses (would write an unroutable row)", () => {
  test("a slash, which would spill into extra URL path segments", () => {
    // The detail route is a single [skillId] segment.
    expect(canonicalSlug("A/B Test Analysis")).toBeNull();
  });

  test.each([
    ["React & Redux"],
    ["AI SDK (Vercel)"],
    ["Skill: The Sequel"],
    ["100% Coverage"],
    ["C#"],
    ["émoji ✨"],
  ])("punctuation outside [a-z0-9._-]: %s", (name) => {
    expect(canonicalSlug(name)).toBeNull();
  });

  test("an empty or whitespace-only name", () => {
    expect(canonicalSlug("")).toBeNull();
    expect(canonicalSlug("   ")).toBeNull();
  });

  test("everything it refuses, kebabCase would have happily returned", () => {
    // The point of the split: kebabCase is a comparator that never writes, so
    // it is deliberately permissive. Locking this in stops anyone "simplifying"
    // canonicalSlug back into a kebabCase call.
    expect(kebabCase("React & Redux")).toBe("react-&-redux");
    expect(canonicalSlug("React & Redux")).toBeNull();
  });
});

describe("matchesSkillId — unchanged by the canonicalSlug split", () => {
  test("exact name, exact kebab, and the documented loose prefix", () => {
    expect(matchesSkillId("vercel-react-view-transitions", "vercel-react-view-transitions")).toBe(true);
    expect(matchesSkillId("Next JS Development", "next-js-development")).toBe(true);
    // Known looseness, parked in TODO.md — asserted so a change to it is
    // deliberate rather than incidental.
    expect(matchesSkillId("Next JS Development", "next")).toBe(true);
  });

  test("an unrelated name still misses", () => {
    expect(matchesSkillId("Deploy To Vercel", "react-best-practices")).toBe(false);
  });
});
