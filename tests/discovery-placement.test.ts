/**
 * Unit tests for convex/lib/discoveryPlacement.ts — which SKILL.md each row gets.
 *
 * These exist because the logic they cover was, until this refactor, reachable
 * only by making GitHub's Tree API answer in a particular shape in the middle of
 * a Convex action. Nothing could hold it still, and three panel rounds found bugs
 * living in it: a pass-1 guard that was a no-op in its own motivating case, a
 * slice-window bug in the exact phase, and a `rejected` set whose complete
 * removal left the suite green.
 *
 * So each case below names the consequence it protects, not just the input shape.
 */
import { test, expect, describe } from "vitest";
import {
  planDirPlacements,
  planNamePlacements,
  probePathsFor,
  type NamedCandidate,
  type SkillRef,
} from "../convex/lib/discoveryPlacement";

const ref = (skillId: string): SkillRef => ({
  docId: `doc_${skillId}`,
  skillId,
});

/** Just the readable part of a plan, for asserting order as well as content. */
const pairs = (binds: { skill: SkillRef; path: string }[]) =>
  binds.map((b) => `${b.skill.skillId} -> ${b.path}`);

describe("probePathsFor — the tree-unavailable fallback", () => {
  test("guesses the two conventional locations, then the repo root", () => {
    // Order is priority: a repo-root SKILL.md is the last resort, because in a
    // repo that also has skills/ it is usually the plugin's own readme-ish file
    // rather than the skill being looked for.
    expect(probePathsFor("my-skill")).toEqual([
      "skills/my-skill/SKILL.md",
      ".claude/skills/my-skill/SKILL.md",
      "SKILL.md",
    ]);
  });
});

describe("planDirPlacements — pass 1, folder name equals slug", () => {
  test("binds each row whose slug names a folder, and leaves the rest alone", () => {
    const byDir = new Map([
      ["alpha", "skills/alpha/SKILL.md"],
      ["beta", ".claude/skills/beta/SKILL.md"],
    ]);
    expect(
      pairs(planDirPlacements([ref("alpha"), ref("gamma"), ref("beta")], byDir)),
    ).toEqual([
      "alpha -> skills/alpha/SKILL.md",
      "beta -> .claude/skills/beta/SKILL.md",
    ]);
  });

  test("no folder means no decision — not a guess", () => {
    // The caller marks these unfound only after pass 2 has also had its turn.
    // Returning nothing here is what leaves that door open.
    expect(planDirPlacements([ref("nope")], new Map())).toEqual([]);
  });

  test("an exact string match, not a normalised one", () => {
    // Pass 1 is a tree lookup, deliberately: `byDir` is keyed on the literal
    // directory name. Folding here would make pass 1 disagree with the
    // `skillMdByDir.get(skillId)` that `aliasBindsSameFile` (convex/githubOnly.ts)
    // predicts, and the add card would vouch for a file the pipeline never binds.
    const byDir = new Map([["My_Skill", "skills/My_Skill/SKILL.md"]]);
    expect(planDirPlacements([ref("my-skill")], byDir)).toEqual([]);
    expect(pairs(planDirPlacements([ref("My_Skill")], byDir))).toEqual([
      "My_Skill -> skills/My_Skill/SKILL.md",
    ]);
  });
});

describe("planNamePlacements — pass 2, frontmatter name against slug", () => {
  test("EXACT beats LOOSE across files — the divergence that shipped", () => {
    // The case that made discovery disagree with the GitHub-only preview once the
    // preview went exact-only. `a-sdk` is listed FIRST and matches slug
    // `vercel-ai` on the prefix rule; `z-ai` is listed second and matches it
    // exactly. A per-file loop with both rules inside took a-sdk, so the confirm
    // card showed z-ai and the row then served a-sdk's body.
    //
    // If this ever flips back to "a-sdk", the preview and the pipeline are
    // binding different files again.
    const named: NamedCandidate[] = [
      { path: "a-sdk/SKILL.md", name: "vercel-ai-sdk" },
      { path: "z-ai/SKILL.md", name: "vercel-ai" },
    ];
    expect(
      pairs(
        planNamePlacements({
          remaining: [ref("vercel-ai")],
          named,
          usedPaths: [],
          allNamedRead: true,
        }),
      ),
    ).toEqual(["vercel-ai -> z-ai/SKILL.md"]);
  });

  test("the loose rule stays holstered until every candidate has been read", () => {
    // Same corpus as above, but the caller has only downloaded the first wave.
    // Binding a-sdk here would be the bug above with extra steps: z-ai has not
    // been read yet and would never get its exact chance.
    const firstWaveOnly: NamedCandidate[] = [
      { path: "a-sdk/SKILL.md", name: "vercel-ai-sdk" },
    ];
    expect(
      planNamePlacements({
        remaining: [ref("vercel-ai")],
        named: firstWaveOnly,
        usedPaths: [],
        allNamedRead: false,
      }),
    ).toEqual([]);
    // …and once the caller says that was everything, the loose rule may fire.
    expect(
      pairs(
        planNamePlacements({
          remaining: [ref("vercel-ai")],
          named: firstWaveOnly,
          usedPaths: [],
          allNamedRead: true,
        }),
      ),
    ).toEqual(["vercel-ai -> a-sdk/SKILL.md"]);
  });

  test("a path pass 1 already took is never re-offered", () => {
    // Pass 1 bound this file by folder name. Pass 2 seeing it again and handing
    // it to a SECOND row is how one file ends up serving two skills.
    expect(
      planNamePlacements({
        remaining: [ref("other-skill")],
        named: [{ path: "skills/alpha/SKILL.md", name: "other-skill" }],
        usedPaths: ["skills/alpha/SKILL.md"],
        allNamedRead: true,
      }),
    ).toEqual([]);
  });

  test("a path the exact phase took is not re-offered to the loose phase", () => {
    // Both rows could claim this one file — `agent` matches `agent-skills`
    // loosely. Only the exact claimant gets it, and the other stays unbound
    // rather than sharing.
    const binds = planNamePlacements({
      remaining: [ref("agent"), ref("agent-skills")],
      named: [{ path: "skills/agent-skills/SKILL.md", name: "agent-skills" }],
      usedPaths: [],
      allNamedRead: true,
    });
    expect(pairs(binds)).toEqual([
      "agent-skills -> skills/agent-skills/SKILL.md",
    ]);
  });

  test("first claim wins among rows, in the order given", () => {
    // Two rows both match loosely; `remaining` order decides. The caller feeds
    // that order from the paginated query, so this pins "deterministic", not a
    // particular winner on merit.
    const named: NamedCandidate[] = [
      { path: "skills/deploy/SKILL.md", name: "deploy-to-vercel" },
    ];
    expect(
      pairs(
        planNamePlacements({
          remaining: [ref("deploy"), ref("deploy-to")],
          named,
          usedPaths: [],
          allNamedRead: true,
        }),
      ),
    ).toEqual(["deploy -> skills/deploy/SKILL.md"]);
    expect(
      pairs(
        planNamePlacements({
          remaining: [ref("deploy-to"), ref("deploy")],
          named,
          usedPaths: [],
          allNamedRead: true,
        }),
      ),
    ).toEqual(["deploy-to -> skills/deploy/SKILL.md"]);
  });

  test("one row binds once even when several files could claim it", () => {
    const named: NamedCandidate[] = [
      { path: "one/SKILL.md", name: "solo" },
      { path: "two/SKILL.md", name: "solo" },
    ];
    expect(
      pairs(
        planNamePlacements({
          remaining: [ref("solo")],
          named,
          usedPaths: [],
          allNamedRead: true,
        }),
      ),
    ).toEqual(["solo -> one/SKILL.md"]);
  });

  test("nothing to do is not an error", () => {
    const named: NamedCandidate[] = [{ path: "a/SKILL.md", name: "a" }];
    expect(
      planNamePlacements({
        remaining: [],
        named,
        usedPaths: [],
        allNamedRead: true,
      }),
    ).toEqual([]);
    expect(
      planNamePlacements({
        remaining: [ref("a")],
        named: [],
        usedPaths: [],
        allNamedRead: true,
      }),
    ).toEqual([]);
  });

  test("re-offering earlier waves across calls cannot double-bind", () => {
    // The caller passes every name read SO FAR on each wave, so earlier entries
    // are re-scanned. This replaced a length-tracked window into that array,
    // which is where the slice-window bug lived. Drive it exactly as the action
    // does — accumulate `named`, grow `usedPaths`, shrink `remaining` — and
    // assert each row and each path is spent once.
    const waves = [
      [{ path: "w1/SKILL.md", name: "one" }],
      [{ path: "w2/SKILL.md", name: "two" }],
      [{ path: "w3/SKILL.md", name: "three" }],
    ];
    const remaining = new Map(
      [ref("one"), ref("two"), ref("three")].map((s) => [s.skillId, s]),
    );
    const named: NamedCandidate[] = [];
    const usedPaths: string[] = [];
    const applied: string[] = [];

    waves.forEach((wave, i) => {
      named.push(...wave);
      for (const p of planNamePlacements({
        remaining: Array.from(remaining.values()),
        named,
        usedPaths,
        allNamedRead: i === waves.length - 1,
      })) {
        applied.push(`${p.skill.skillId} -> ${p.path}`);
        usedPaths.push(p.path);
        remaining.delete(p.skill.skillId);
      }
    });

    expect(applied).toEqual([
      "one -> w1/SKILL.md",
      "two -> w2/SKILL.md",
      "three -> w3/SKILL.md",
    ]);
    expect(new Set(applied).size).toBe(3);
    expect(remaining.size).toBe(0);
  });

  test("the underscore alignment reaches this pass too", () => {
    // `matchesSkillIdExactly` folds separators but not case (see skillMatch.ts).
    // Pass 2 inherits that, so a file named `http_mcp_headers` binds to slug
    // `http-mcp-headers` here — the row the production bind audit flagged.
    expect(
      pairs(
        planNamePlacements({
          remaining: [ref("http-mcp-headers")],
          named: [{ path: "skills/http/SKILL.md", name: "http_mcp_headers" }],
          usedPaths: [],
          allNamedRead: false,
        }),
      ),
    ).toEqual(["http-mcp-headers -> skills/http/SKILL.md"]);
  });
});
