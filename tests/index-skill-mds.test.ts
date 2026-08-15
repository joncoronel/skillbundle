/**
 * Guards indexSkillMds (convex/lib/github.ts), specifically the `shaByPath`
 * return that carries git blob SHAs out of a tree walk.
 *
 * Why this matters: `syncHash` can only be computed after DOWNLOADING a file, so
 * every freshness check today costs a full fetch of every skill. GitHub returns
 * a blob sha for each entry in the recursive tree response we already request,
 * which means one conditional tree call per repo can reveal which SKILL.md files
 * moved without downloading any of them. The catalog is ~98% GitHub sources at
 * ~6.8 skills per repo, so that is the difference between a per-skill sweep and
 * a per-repo one, and it is what makes a daily content cadence cheaper than
 * today's weekly fetch-everything cycle.
 *
 * The two existing returns (`candidates`, `byDir`) are relied on by both the
 * discovery pipeline and the GitHub-only resolver, which is why they live in one
 * shared function. These tests pin their shapes as well, so adding the third
 * return cannot quietly perturb them.
 */
import { test, expect } from "vitest";
import { indexSkillMds } from "../convex/lib/github";

const tree = [
  { type: "tree", path: "skills", sha: "treesha" },
  { type: "blob", path: "skills/alpha/SKILL.md", sha: "aaa111" },
  { type: "blob", path: "skills/beta/SKILL.md", sha: "bbb222" },
  { type: "blob", path: "README.md", sha: "ccc333" },
  { type: "blob", path: "skills/alpha/reference/guide.md", sha: "ddd444" },
];

test("collects a sha for every SKILL.md candidate", () => {
  const { candidates, shaByPath } = indexSkillMds(tree);

  expect(candidates).toEqual(["skills/alpha/SKILL.md", "skills/beta/SKILL.md"]);
  expect(shaByPath.get("skills/alpha/SKILL.md")).toBe("aaa111");
  expect(shaByPath.get("skills/beta/SKILL.md")).toBe("bbb222");
});

test("indexes nothing that is not a SKILL.md", () => {
  const { shaByPath } = indexSkillMds(tree);

  // A stray sha here would eventually be compared against a skill's stored
  // value and report a phantom change on every sweep.
  expect(shaByPath.has("README.md")).toBe(false);
  expect(shaByPath.has("skills/alpha/reference/guide.md")).toBe(false);
  expect(shaByPath.size).toBe(2);
});

test("skips tree entries, whose sha identifies a subtree not a file", () => {
  const { candidates, shaByPath } = indexSkillMds([
    { type: "tree", path: "SKILL.md", sha: "notafile" },
  ]);

  expect(candidates).toEqual([]);
  expect(shaByPath.size).toBe(0);
});

test("entries without a sha still index as candidates", () => {
  // Hand-built entry lists (tests, probe fallbacks) carry no sha. Those skills
  // must still be discoverable — they just fall back to the download-and-hash
  // freshness check instead of the cheap per-repo one.
  const { candidates, byDir, shaByPath } = indexSkillMds([
    { type: "blob", path: "skills/gamma/SKILL.md" },
  ]);

  expect(candidates).toEqual(["skills/gamma/SKILL.md"]);
  expect(byDir.get("gamma")).toBe("skills/gamma/SKILL.md");
  expect(shaByPath.size).toBe(0);
});

test("matches SKILL.md case-insensitively but keeps the real path as the key", () => {
  const { candidates, shaByPath } = indexSkillMds([
    { type: "blob", path: "skills/delta/skill.md", sha: "eee555" },
  ]);

  // The raw-content URL is built from the path as GitHub reported it, so the
  // key has to preserve the original casing rather than the lowered form used
  // for matching.
  expect(candidates).toEqual(["skills/delta/skill.md"]);
  expect(shaByPath.get("skills/delta/skill.md")).toBe("eee555");
});

test("byDir keeps last-entry-wins on a duplicate leaf name", () => {
  const { byDir, shaByPath } = indexSkillMds([
    { type: "blob", path: "a/dup/SKILL.md", sha: "first" },
    { type: "blob", path: "b/dup/SKILL.md", sha: "second" },
  ]);

  // Pinning the pre-existing contract: both callers depend on this exact
  // keying, which is why the function is shared rather than duplicated.
  expect(byDir.get("dup")).toBe("b/dup/SKILL.md");
  // shaByPath is keyed on the full path, so it keeps BOTH — no collision.
  expect(shaByPath.get("a/dup/SKILL.md")).toBe("first");
  expect(shaByPath.get("b/dup/SKILL.md")).toBe("second");
});
