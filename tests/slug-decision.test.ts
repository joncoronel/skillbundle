/**
 * Unit tests for convex/lib/slugDecision.ts — the write policy for a
 * GitHub-only add's slug.
 *
 * These exist because the interesting branch (refuse rather than store a
 * knowingly-wrong slug) is otherwise only reachable by making GitHub's tree API
 * fail in the middle of an add, which no test can arrange. Extracting the
 * policy is what makes it testable at all.
 *
 * Each case names the consequence it protects, not just the input shape.
 */
import { test, expect, describe } from "vitest";
import { aliasCandidate, decideSlug } from "../convex/lib/slugDecision";

describe("aliasCandidate — separator folding is not a rename", () => {
  // Both sides go through `kebabCase` before being compared. Without that, a
  // typed `foo_bar` whose file is also named `foo_bar` derived the alias
  // `foo-bar` and adopted it — silently rewriting a PERMANENT identity — and on
  // the tree-unavailable path refused the add outright, because no folder could
  // be shown to claim a slug that only differs by punctuation.
  test("no alias when the two differ only by separator", () => {
    expect(
      aliasCandidate({
        typedSkillId: "foo_bar",
        canonicalFmName: "foo-bar",
        matchedBy: "dir",
      }),
    ).toBeNull();
  });

  test("a genuine rename still produces an alias", () => {
    expect(
      aliasCandidate({
        typedSkillId: "react-view-transitions",
        canonicalFmName: "vercel-react-view-transitions",
        matchedBy: "dir",
      }),
    ).toBe("vercel-react-view-transitions");
  });
});

describe("aliasCandidate — when is a second slug worth considering", () => {
  test("frontmatter name differs from the folder the link pointed at", () => {
    // The whole reason the alias logic exists: vercel-labs/agent-skills ships
    // skills/react-view-transitions/SKILL.md named vercel-react-view-transitions.
    expect(
      aliasCandidate({
        typedSkillId: "react-view-transitions",
        canonicalFmName: "vercel-react-view-transitions",
        matchedBy: "dir",
      }),
    ).toBe("vercel-react-view-transitions");
  });

  test("no alias when the name already agrees with the typed slug", () => {
    expect(
      aliasCandidate({
        typedSkillId: "web-design-guidelines",
        canonicalFmName: "web-design-guidelines",
        matchedBy: "dir",
      }),
    ).toBeNull();
  });

  test("no alias when the name wasn't usable as a slug", () => {
    // canonicalSlug already refused it; nothing to compare against.
    expect(
      aliasCandidate({
        typedSkillId: "some-skill",
        canonicalFmName: null,
        matchedBy: "dir",
      }),
    ).toBeNull();
  });

  test("no alias from a frontmatter match — a prefix guess must never name a row", () => {
    // matchesSkillId's loose `startsWith` arm can bind slug "next" to a file
    // named "Next JS Development". That guess must not reach a write.
    expect(
      aliasCandidate({
        typedSkillId: "next",
        canonicalFmName: "next-js-development",
        matchedBy: "frontmatter",
      }),
    ).toBeNull();
  });
});

describe("decideSlug — refuse rather than store a knowingly-wrong slug", () => {
  // A sentinel payload: the caller's alias lookup travels with the slug and is
  // handed back on adopt_alias. Asserting it round-trips is what replaced the
  // runtime throw that used to defend the same invariant.
  const PASS = { precheck: null } as const;
  const base = {
    alias: { slug: "vendor-foo", payload: PASS },
    typedRowExists: false,
    aliasBindsSameFile: true,
    treeListed: true,
  };

  test("adopts the alias once it is verified safe", () => {
    // The slug skills.sh would assign, so a future listing adopts this row
    // instead of inserting a second one beside it.
    expect(decideSlug(base)).toEqual({
      kind: "adopt_alias",
      alias: "vendor-foo",
      payload: PASS,
    });
  });

  test("keeps the typed slug when there is no alias", () => {
    expect(decideSlug({ ...base, alias: null })).toEqual({ kind: "keep_typed" });
  });

  test("refuses when we never got the folder list, cause 'unlisted'", () => {
    // Either a rate limit or a tree too large to list — indistinguishable from
    // here, which is why the cause names the obstruction and not the remedy.
    // Writing the typed slug would leave a row skills.sh can never adopt.
    expect(
      decideSlug({ ...base, aliasBindsSameFile: false, treeListed: false }),
    ).toEqual({
      kind: "refuse",
      expectedSkillId: "vendor-foo",
      cause: "unlisted",
    });
  });

  test("refuses a real folder conflict, cause 'conflict'", () => {
    // We saw the listing and another folder owns that name. This is the only
    // definite refusal, and the only one whose copy must not suggest waiting.
    expect(
      decideSlug({ ...base, aliasBindsSameFile: false, treeListed: true }),
    ).toEqual({
      kind: "refuse",
      expectedSkillId: "vendor-foo",
      cause: "conflict",
    });
  });

  test("an existing row on the typed slug outranks the refusal", () => {
    // Only a DELISTED row can reach here (a live one is terminal earlier), and
    // relisting it beats both writing a second row and erroring out. Regression
    // guard: ordering these the other way turns a free relist into a dead end.
    expect(
      decideSlug({
        ...base,
        typedRowExists: true,
        aliasBindsSameFile: false,
        treeListed: false,
      }),
    ).toEqual({ kind: "keep_typed" });
  });

  test("an existing row also outranks adopting a verified alias", () => {
    // Same reason, and this is the case that used to strand the delisted row
    // beside a fresh alias row while charging the user a quota slot.
    expect(decideSlug({ ...base, typedRowExists: true })).toEqual({
      kind: "keep_typed",
    });
  });
});

describe("decideSlug — the full matrix has no surprises", () => {
  // Belt and braces: every combination, asserted as a table, so a future edit
  // that reorders the branches fails loudly rather than subtly.
  const cases: Array<{
    alias: { slug: string; payload: null } | null;
    typedRowExists: boolean;
    aliasBindsSameFile: boolean;
    treeListed: boolean;
    expected: string;
  }> = [
    { alias: null, typedRowExists: false, aliasBindsSameFile: true, treeListed: true, expected: "keep_typed" },
    { alias: null, typedRowExists: true, aliasBindsSameFile: false, treeListed: false, expected: "keep_typed" },
    { alias: { slug: "a", payload: null }, typedRowExists: true, aliasBindsSameFile: true, treeListed: true, expected: "keep_typed" },
    { alias: { slug: "a", payload: null }, typedRowExists: true, aliasBindsSameFile: false, treeListed: true, expected: "keep_typed" },
    { alias: { slug: "a", payload: null }, typedRowExists: false, aliasBindsSameFile: true, treeListed: true, expected: "adopt_alias" },
    { alias: { slug: "a", payload: null }, typedRowExists: false, aliasBindsSameFile: true, treeListed: false, expected: "adopt_alias" },
    { alias: { slug: "a", payload: null }, typedRowExists: false, aliasBindsSameFile: false, treeListed: true, expected: "refuse" },
    { alias: { slug: "a", payload: null }, typedRowExists: false, aliasBindsSameFile: false, treeListed: false, expected: "refuse" },
  ];

  test.each(cases)(
    "alias=$alias.slug existing=$typedRowExists binds=$aliasBindsSameFile tree=$treeListed -> $expected",
    ({ expected, ...input }) => {
      expect(decideSlug(input).kind).toBe(expected);
    },
  );

  test("a verified alias is adopted even when the tree was never listed", () => {
    // treeListed only shapes the refusal's `cause`. It must not become a gate
    // of its own: aliasBindsSameFile is already false whenever the tree was
    // missing, so an extra check here would be dead code hiding a real branch.
    expect(
      decideSlug({
        alias: { slug: "a", payload: null },
        typedRowExists: false,
        aliasBindsSameFile: true,
        treeListed: false,
      }),
    ).toEqual({ kind: "adopt_alias", alias: "a", payload: null });
  });
});
