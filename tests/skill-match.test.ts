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
  matchesSkillIdExactly,
  claimedByOtherSkill,
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

  test.each([["."], [".."], ["..."], ["-"], ["---"], ["_"], ["._-"]])(
    "separators only, with no name in them: %s",
    (name) => {
      // These pass the charset test, so they need their own rule. ".." is the
      // one that bites: encodeURIComponent leaves "." alone, so it would
      // normalise a segment away in the skills.sh request path.
      expect(canonicalSlug(name)).toBeNull();
    },
  );

  test("a single alphanumeric is enough to make it a name", () => {
    expect(canonicalSlug("v2")).toBe("v2");
    expect(canonicalSlug("-x-")).toBe("-x-");
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

/**
 * The GitHub-only resolver's matcher. Each case names the consequence it
 * protects, because the whole point of this function is that a match here can
 * become a row's permanent, unrepairable slug.
 */
describe("matchesSkillIdExactly — the GitHub-only add's rule", () => {
  test("accepts an exact frontmatter name", () => {
    expect(matchesSkillIdExactly("panel-review", "panel-review")).toBe(true);
  });

  test("accepts a spaced name whose kebab form is the slug", () => {
    expect(matchesSkillIdExactly("Next JS Development", "next-js-development")).toBe(true);
  });

  test("REFUSES a shortened name — the mis-slug this exists to prevent", () => {
    // The failure it replaces: this bound the file, the row was then stored as
    // "panel", skills.sh could never adopt it, and the sync inserted a second
    // row under "panel-review". `matchesSkillId` still accepts it, which is
    // what makes the two callers genuinely different rather than duplicated.
    expect(matchesSkillIdExactly("panel-review", "panel")).toBe(false);
    expect(matchesSkillId("panel-review", "panel")).toBe(true);
  });

  test("REFUSES a prefix with no word boundary", () => {
    // The case the whole-word-prefix TODO is about. It never reaches a write on
    // this path now, whichever way that entry is eventually resolved.
    expect(matchesSkillIdExactly("Testing Library Helper", "test")).toBe(false);
  });

  test("REFUSES a name the slug merely extends", () => {
    // The reverse direction: nothing here is a prefix rule in either direction.
    expect(matchesSkillIdExactly("panel", "panel-review")).toBe(false);
  });

  test("REFUSES surrounding whitespace, keeping the canonicalSlug invariant", () => {
    // Load-bearing: `kebabCase` does not trim but `canonicalSlug` does, so a
    // padded name matching here would break the property the resolver now
    // relies on (a frontmatter match implies canonicalSlug(fmName) === slug).
    expect(matchesSkillIdExactly(" panel-review ", "panel-review")).toBe(false);
    expect(canonicalSlug(" panel-review ")).toBe("panel-review");
  });

  test("an unrelated name still misses", () => {
    expect(matchesSkillIdExactly("Deploy To Vercel", "react-best-practices")).toBe(false);
  });
});

/**
 * Discovery's pass-1 guard. Every case names the consequence, because the
 * asymmetry here is the whole design: a false positive strips content from a
 * healthy skill across the catalog, a false negative just leaves us where we
 * already were.
 */
describe("claimedByOtherSkill — discovery pass 1's folder-match guard", () => {
  const slugs = new Set(["panel-review", "recap", "nextjs"]);

  test("blocks the bind when the file says it is ANOTHER known skill", () => {
    // The collision: a folder named `recap` holding panel-review's file, which
    // happens when a repo renames a folder and leaves the old one behind.
    // Binding it would serve panel-review's content under recap's name.
    expect(claimedByOtherSkill("panel-review", "recap", slugs)).toBe(true);
  });

  test("allows the bind when the file agrees with the folder", () => {
    expect(claimedByOtherSkill("panel-review", "panel-review", slugs)).toBe(false);
  });

  test("allows a name whose kebab form agrees", () => {
    expect(claimedByOtherSkill("Panel Review", "panel-review", slugs)).toBe(false);
  });

  test("allows an unreproducible slug derivation — the false positive that must not happen", () => {
    // "Next.js" kebabs to `next.js`, which is neither `nextjs` nor a prefix of
    // it. A self-check would unbind this healthy file. Because the guard only
    // reacts to a positive claim on ANOTHER slug, and `next.js` is nobody's
    // slug, the bind stands.
    expect(claimedByOtherSkill("Next.js", "nextjs", slugs)).toBe(false);
  });

  test("allows a name claiming a slug nobody in the batch owns", () => {
    // Not our business: no known skill loses out, so there is nothing to protect.
    expect(claimedByOtherSkill("Some Other Thing", "recap", slugs)).toBe(false);
  });

  test("allows a file with no frontmatter name", () => {
    // Can't disprove the folder, so don't. Same for a failed fetch, which the
    // caller passes through as null.
    expect(claimedByOtherSkill(null, "recap", slugs)).toBe(false);
  });

  test("allows everything when the batch has one skill", () => {
    // Nobody else to be confused with, so the guard is inert.
    expect(claimedByOtherSkill("panel-review", "recap", new Set(["recap"]))).toBe(false);
  });
});
