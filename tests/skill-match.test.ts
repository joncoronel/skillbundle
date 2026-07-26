/**
 * Unit tests for convex/lib/skillMatch.ts.
 *
 * Pure functions — no Convex runtime needed.
 *
 * `canonicalSlug` is the write-side guard: its output can become a row's
 * permanent `skillId` AND a single URL path segment, so the interesting cases
 * are the ones it must REFUSE rather than mangle. `kebabCase` only lowercases
 * and collapses `[\s_]+` runs, so every other punctuation character survives it
 * intact and would otherwise be persisted.
 */
import { test, expect, describe } from "vitest";
import {
  canonicalSlug,
  kebabCase,
  matchesSkillId,
  matchesSkillIdExactly,
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

  test("underscores fold like the official CLI does", () => {
    // vercel-labs/skills, src/skills.ts: normalizeSkillName is
    // `name.toLowerCase().replace(/[\s_]+/g, "-")`. Ours omitted `_` until a
    // production bind audit flagged a real skill (github/gh-aw) whose file is
    // named `http_mcp_headers` against slug `http-mcp-headers`.
    expect(kebabCase("http_mcp_headers")).toBe("http-mcp-headers");
    expect(canonicalSlug("http_mcp_headers")).toBe("http-mcp-headers");
    // Mixed and repeated separators collapse to one dash, as the CLI does.
    expect(kebabCase("Deploy _ To__Vercel")).toBe("deploy-to-vercel");
  });

  test("dots and digits survive; underscores normalise to dashes", () => {
    // A canonical slug never contains `_`: `kebabCase` folds it into `-` to match
    // the CLI's `normalizeSkillName`, and the charset was narrowed to
    // `[a-z0-9.-]` to stop encoding an invariant nothing could reach.
    // (`SAFE_SEGMENT` in lib/install-commands.ts still permits `_`, because slugs
    // also arrive from the sync without passing through here.) This assertion
    // changed deliberately when that alignment landed — it is the one place the
    // change alters slug GENERATION rather than just matching, so it is worth
    // failing loudly if reverted.
    expect(canonicalSlug("next.js_16-beta2")).toBe("next.js-16-beta2");
    expect(canonicalSlug("v2.1.0")).toBe("v2.1.0");
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
  ])("punctuation outside [a-z0-9.-]: %s", (name) => {
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
    // padded name matching here weakens the property the resolver relies on (a
    // frontmatter match implies canonicalSlug(fmName) === the separator-folded
    // slug). It is not airtight — fmName " panel-review " still matches slug
    // "-panel-review-" — which is why `aliasCandidate`'s `matchedBy === "dir"`
    // gate stays; see convex/lib/slugDecision.ts.
    expect(matchesSkillIdExactly(" panel-review ", "panel-review")).toBe(false);
    expect(canonicalSlug(" panel-review ")).toBe("panel-review");
  });

  test("an unrelated name still misses", () => {
    expect(matchesSkillIdExactly("Deploy To Vercel", "react-best-practices")).toBe(false);
  });

  test("folds BOTH sides — the regression that shipped when only one was folded", () => {
    // A repo `owner/agent_skills` with a root SKILL.md named `agent_skills`.
    // Folding only the name compared "agent-skills" against the raw typed
    // "agent_skills" and refused a file whose name is exactly what was typed.
    expect(matchesSkillIdExactly("agent_skills", "agent_skills")).toBe(true);
    // The case the fold exists for still works.
    expect(matchesSkillIdExactly("http_mcp_headers", "http-mcp-headers")).toBe(true);
    // And mixed case, which previously failed all three arms of both matchers.
    expect(matchesSkillIdExactly("Foo_Bar", "foo_bar")).toBe(true);
    // Still strict where it matters: a partial name is not a match.
    expect(matchesSkillIdExactly("panel-review", "panel")).toBe(false);
  });

  test("folds separators but NOT case — the hole that reopened twice", () => {
    // A repo `MySkill` with a root SKILL.md named `MySkill`. `canonicalSlug`
    // says the slug should be `myskill`; storing `MySkill` gives a row skills.sh
    // can never adopt, and there is no repair tool by design.
    //
    // This has now been closed twice. First by removing the raw-identity arm.
    // Then reopened by folding BOTH sides with `kebabCase`, which lowercases —
    // shipped green because nothing pinned it. Case is the signal the mis-slug
    // guard reads; separators are noise. Do not "simplify" the slug side back to
    // `kebabCase`.
    expect(matchesSkillIdExactly("MySkill", "MySkill")).toBe(false);
    expect(matchesSkillIdExactly("My_Skill", "My_Skill")).toBe(false);
    // …while the separator fold this pair of commits exists for still works.
    expect(matchesSkillIdExactly("my_skill", "my-skill")).toBe(true);
  });

  test("stays a subset of the loose matcher", () => {
    // The module header frames these as loose vs strict, which only holds if
    // every exact match is also a loose one. Folding the slug side in one and
    // not the other broke that, and `bindAudit` judges binds with the loose rule
    // — so it flagged rows the binder had just bound.
    for (const [name, slug] of [
      ["agent_skills", "agent_skills"],
      ["http_mcp_headers", "http-mcp-headers"],
      ["Foo_Bar", "foo_bar"],
      ["my_skill", "my-skill"],
    ] as const) {
      if (matchesSkillIdExactly(name, slug)) {
        expect(matchesSkillId(name, slug)).toBe(true);
      }
    }
  });
});

