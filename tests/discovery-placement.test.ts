/**
 * Unit tests for convex/lib/discoveryPlacement.ts — which SKILL.md each row gets.
 *
 * These exist because the logic they cover was, until recently, reachable only by
 * making GitHub's Tree API answer in a particular shape mid-action. Nothing could
 * hold it still, and three panel rounds found bugs living in it — including a
 * `rejected` set that could be deleted outright with the suite still green.
 *
 * So each case names the consequence it protects, and several assert on the READS
 * as well as the placements: `planNamePlacements` takes its `NameReader` as a
 * parameter, so a fake one records how many batches were requested. That is what
 * makes "the loose rule waits for every candidate" and "an exact match cuts the
 * walk short" observable rather than merely argued.
 */
import { test, expect, describe } from "vitest";
import {
  DISCOVERY_WAVE_SIZE,
  planDirPlacements,
  planNamePlacements,
  planProbePlacements,
  probePathsFor,
  type NameReader,
  type NamedCandidate,
  type Placement,
  type SkillRef,
} from "../convex/lib/discoveryPlacement";

const ref = (skillId: string): SkillRef => ({
  docId: `doc_${skillId}`,
  skillId,
});

/** Just the readable part of a plan, so order is asserted alongside content. */
const pairs = (binds: readonly Placement[]) =>
  binds.map((b) => `${b.skill.skillId} -> ${b.path}`);

/**
 * A `NameReader` over a fixed path→name table, recording the batches it served.
 * A path absent from the table reads as `null`, which is how both an unreachable
 * file and one with no frontmatter `name:` arrive.
 */
function fakeReader(table: Record<string, string | null>) {
  const batches: string[][] = [];
  const read: NameReader = async (paths) => {
    batches.push([...paths]);
    return paths.map((path) => {
      const name = table[path];
      return name ? { path, name } : null;
    });
  };
  return { read, batches };
}

describe("probePathsFor — the tree-unavailable fallback", () => {
  test("guesses the two conventional locations, then the repo root", () => {
    // Order is priority: a repo-root SKILL.md is the last resort, because in a
    // repo that also has skills/ it is usually the plugin's own front matter
    // rather than the skill being looked for. Shared with the GitHub-only
    // resolver (convex/githubOnly.ts), which is why the order is pinned and not
    // just the membership.
    expect(probePathsFor("my-skill")).toEqual([
      "skills/my-skill/SKILL.md",
      ".claude/skills/my-skill/SKILL.md",
      "SKILL.md",
    ]);
  });

  test("refuses a slug that would escape the repo, rather than probing it", () => {
    // These become a raw.githubusercontent path by bare template concatenation,
    // and URL parsing resolves `..` — so this slug would probe (and then persist
    // as the row's content URL) a file in someone else's repo entirely.
    expect(probePathsFor("../../../../evil-owner/evil-repo/main/x")).toEqual([]);
    expect(probePathsFor("..")).toEqual([]);
    expect(probePathsFor(".")).toEqual([]);
    expect(probePathsFor("a/b")).toEqual([]);
    expect(probePathsFor("")).toEqual([]);
    // Everything a real skills.sh slug looks like still passes.
    expect(probePathsFor("next.js_16-beta2")).toHaveLength(3);
  });
});

describe("planProbePlacements — the tree-unavailable fallback", () => {
  /** Probes that exist, recording the order they were asked about. */
  function fakeProbe(existing: string[]) {
    const asked: string[] = [];
    const probe = async (path: string) => {
      asked.push(path);
      return existing.includes(path);
    };
    return { probe, asked };
  }

  test("stops at a row's first hit, and asks in priority order", async () => {
    const { probe, asked } = fakeProbe([
      ".claude/skills/alpha/SKILL.md",
      "SKILL.md",
    ]);
    expect(
      pairs(await planProbePlacements({ skills: [ref("alpha")], probe })),
    ).toEqual(["alpha -> .claude/skills/alpha/SKILL.md"]);
    // `skills/` asked first and missed; the `.claude` hit ended it, so the root
    // file was never even considered.
    expect(asked).toEqual([
      "skills/alpha/SKILL.md",
      ".claude/skills/alpha/SKILL.md",
    ]);
  });

  test("a repo-root SKILL.md never beats a matching folder", async () => {
    // Both exist. If the order or the `break` went, every row in a repo with a
    // root SKILL.md would bind that one file.
    const { probe } = fakeProbe(["skills/alpha/SKILL.md", "SKILL.md"]);
    expect(
      pairs(await planProbePlacements({ skills: [ref("alpha")], probe })),
    ).toEqual(["alpha -> skills/alpha/SKILL.md"]);
  });

  test("a row that hits nothing gets no placement rather than a guess", async () => {
    const { probe, asked } = fakeProbe([]);
    expect(await planProbePlacements({ skills: [ref("ghost")], probe })).toEqual(
      [],
    );
    expect(asked).toHaveLength(3);
  });

  test("an unsafe slug is not probed at all", async () => {
    const { probe, asked } = fakeProbe(["SKILL.md"]);
    expect(
      await planProbePlacements({ skills: [ref("../../evil/repo/main/x")], probe }),
    ).toEqual([]);
    expect(asked).toEqual([]);
  });

  test("each row is decided independently", async () => {
    const { probe } = fakeProbe([
      "skills/one/SKILL.md",
      ".claude/skills/three/SKILL.md",
    ]);
    expect(
      pairs(
        await planProbePlacements({
          skills: [ref("one"), ref("two"), ref("three")],
          probe,
        }),
      ),
    ).toEqual([
      "one -> skills/one/SKILL.md",
      "three -> .claude/skills/three/SKILL.md",
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

  test("a literal lookup: case is not folded", () => {
    const byDir = new Map([["My-Skill", "skills/My-Skill/SKILL.md"]]);
    expect(planDirPlacements([ref("my-skill")], byDir)).toEqual([]);
  });

  test("a literal lookup: SEPARATORS are not folded either", () => {
    // Separate from the case above on purpose. A case-preserving separator fold
    // — `foldSeparators`, which is exactly what `matchesSkillIdExactly` applies
    // to the slug side — would pass a combined case+separator test while still
    // breaking pass 1. Both directions, same case, separator-only difference.
    const underscored = new Map([["my_skill", "skills/my_skill/SKILL.md"]]);
    expect(planDirPlacements([ref("my-skill")], underscored)).toEqual([]);
    const dashed = new Map([["my-skill", "skills/my-skill/SKILL.md"]]);
    expect(planDirPlacements([ref("my_skill")], dashed)).toEqual([]);
    // Pass 1 must stay literal because `aliasBindsSameFile`
    // (convex/githubOnly.ts) predicts its result with a plain `Map.get`; folding
    // here makes the add card vouch for a file the pipeline never binds.
  });

  test("an empty path is not a bind", () => {
    // Would otherwise store a bare directory URL with a truthy `hasSkillMdUrl`,
    // which the content pipeline retries forever instead of the row being marked
    // unfound. `indexSkillMds` cannot produce one today; this keeps that from
    // being the only thing standing in the way.
    expect(planDirPlacements([ref("alpha")], new Map([["alpha", ""]]))).toEqual(
      [],
    );
  });
});

describe("planNamePlacements — pass 2, frontmatter name against slug", () => {
  test("EXACT beats LOOSE across files — the divergence that shipped", async () => {
    // The case that made discovery disagree with the GitHub-only preview once the
    // preview went exact-only. `a-sdk` is read FIRST and matches slug `vercel-ai`
    // on the prefix rule; `z-ai` is read second and matches it exactly. A
    // per-file loop with both rules inside took a-sdk, so the confirm card showed
    // z-ai and the row then served a-sdk's body.
    //
    // waveSize 1 puts them in separate batches, which is the hard version: the
    // loose candidate is fully read and refused before the exact one is even
    // fetched. If this ever yields "a-sdk", the preview and the pipeline are
    // binding different files again.
    const { read, batches } = fakeReader({
      "a-sdk/SKILL.md": "vercel-ai-sdk",
      "z-ai/SKILL.md": "vercel-ai",
    });
    const binds = await planNamePlacements({
      remaining: [ref("vercel-ai")],
      candidates: ["a-sdk/SKILL.md", "z-ai/SKILL.md"],
      usedPaths: new Set(),
      readNames: read,
      waveSize: 1,
    });
    expect(pairs(binds)).toEqual(["vercel-ai -> z-ai/SKILL.md"]);
    // …and it genuinely had to read both before deciding.
    expect(batches).toEqual([["a-sdk/SKILL.md"], ["z-ai/SKILL.md"]]);
  });

  test("binds several rows in one plan, exact ones first", async () => {
    // Multi-bind is the NORMAL production shape — up to 500 rows of one source
    // against a repo-bounded candidate list — and every other case here yields
    // 0 or 1 placements, which leaves two mutants alive:
    // `if (allDone && binds.length === 0) offer(loose)` silently strands every
    // loose row in a repo that also has one exact match, and `binds.reverse()`
    // scrambles the order. Both are caught here.
    const { read } = fakeReader({
      "x/SKILL.md": "alpha",
      "y/SKILL.md": "beta-tools",
      "z/SKILL.md": "gamma-extra-words",
    });
    const binds = await planNamePlacements({
      remaining: [ref("alpha"), ref("beta-tools"), ref("gamma")],
      candidates: ["x/SKILL.md", "y/SKILL.md", "z/SKILL.md"],
      usedPaths: new Set(),
      readNames: read,
      waveSize: 10,
    });
    expect(pairs(binds)).toEqual([
      "alpha -> x/SKILL.md",
      "beta-tools -> y/SKILL.md",
      "gamma -> z/SKILL.md",
    ]);
  });

  test("an exact match cuts the walk short instead of reading the rest", async () => {
    // The cost guarantee, and the reason the `open.size === 0` checks exist.
    // Nothing but the batch log can observe it.
    const { read, batches } = fakeReader({
      "a/SKILL.md": "solo",
      "b/SKILL.md": "unrelated",
      "c/SKILL.md": "also-unrelated",
    });
    const binds = await planNamePlacements({
      remaining: [ref("solo")],
      candidates: ["a/SKILL.md", "b/SKILL.md", "c/SKILL.md"],
      usedPaths: new Set(),
      readNames: read,
      waveSize: 1,
    });
    expect(pairs(binds)).toEqual(["solo -> a/SKILL.md"]);
    expect(batches).toEqual([["a/SKILL.md"]]);
  });

  test("batches at the requested size, including an exact multiple", async () => {
    // The predecessor of this loop computed "is this the last batch?" in the
    // caller, untested, and got it wrong once. `len === waveSize` and
    // `len === waveSize + 1` are the boundaries that arithmetic fell over on.
    const paths = Array.from({ length: 4 }, (_, i) => `p${i}/SKILL.md`);
    for (const [len, waveSize, want] of [
      [4, 2, [["p0", "p1"], ["p2", "p3"]]],
      [3, 2, [["p0", "p1"], ["p2"]]],
      [2, 2, [["p0", "p1"]]],
    ] as const) {
      const { read, batches } = fakeReader({});
      await planNamePlacements({
        remaining: [ref("never-matches")],
        candidates: paths.slice(0, len),
        usedPaths: new Set(),
        readNames: read,
        waveSize,
      });
      expect(batches.map((b) => b.map((p) => p.split("/")[0]))).toEqual(want);
    }
    expect(DISCOVERY_WAVE_SIZE).toBe(10);
  });

  test("unreadable and name-less candidates drop out without shifting the rest", async () => {
    // The reader returns one slot per path, so a null in the middle must not
    // misalign the names that follow it. Misalignment here binds a row to a
    // neighbouring file's path, which is the worst outcome this module has.
    const { read } = fakeReader({
      "gone/SKILL.md": null,
      "nameless/SKILL.md": null,
      "real/SKILL.md": "target",
    });
    const binds = await planNamePlacements({
      remaining: [ref("target")],
      candidates: ["gone/SKILL.md", "nameless/SKILL.md", "real/SKILL.md"],
      usedPaths: new Set(),
      readNames: read,
      waveSize: 10,
    });
    expect(pairs(binds)).toEqual(["target -> real/SKILL.md"]);
  });

  test("a path pass 1 already took is never re-offered", async () => {
    // Pass 1 bound this file by folder name. Pass 2 seeing it again and handing
    // it to a SECOND row is how one file ends up serving two skills.
    const { read } = fakeReader({ "skills/alpha/SKILL.md": "other-skill" });
    expect(
      await planNamePlacements({
        remaining: [ref("other-skill")],
        candidates: ["skills/alpha/SKILL.md"],
        usedPaths: new Set(["skills/alpha/SKILL.md"]),
        readNames: read,
        waveSize: 10,
      }),
    ).toEqual([]);
  });

  test("a path the exact phase took is not re-offered to the loose phase", async () => {
    // Both rows could claim this one file — `agent` matches `agent-skills`
    // loosely. Only the exact claimant gets it; the other stays unbound rather
    // than sharing.
    const { read } = fakeReader({
      "skills/agent-skills/SKILL.md": "agent-skills",
    });
    expect(
      pairs(
        await planNamePlacements({
          remaining: [ref("agent"), ref("agent-skills")],
          candidates: ["skills/agent-skills/SKILL.md"],
          usedPaths: new Set(),
          readNames: read,
          waveSize: 10,
        }),
      ),
    ).toEqual(["agent-skills -> skills/agent-skills/SKILL.md"]);
  });

  test("first claim wins among rows, in the order given", async () => {
    // Two rows both match loosely; `remaining` order decides. The caller feeds
    // that order from the paginated query, so this pins "deterministic", not a
    // particular winner on merit.
    const table = { "skills/deploy/SKILL.md": "deploy-to-vercel" };
    const call = (remaining: SkillRef[]) =>
      planNamePlacements({
        remaining,
        candidates: ["skills/deploy/SKILL.md"],
        usedPaths: new Set(),
        readNames: fakeReader(table).read,
        waveSize: 10,
      });
    expect(pairs(await call([ref("deploy"), ref("deploy-to")]))).toEqual([
      "deploy -> skills/deploy/SKILL.md",
    ]);
    expect(pairs(await call([ref("deploy-to"), ref("deploy")]))).toEqual([
      "deploy-to -> skills/deploy/SKILL.md",
    ]);
  });

  test("one row binds once even when several files could claim it", async () => {
    const { read } = fakeReader({
      "one/SKILL.md": "solo",
      "two/SKILL.md": "solo",
    });
    expect(
      pairs(
        await planNamePlacements({
          remaining: [ref("solo")],
          candidates: ["one/SKILL.md", "two/SKILL.md"],
          usedPaths: new Set(),
          readNames: read,
          waveSize: 10,
        }),
      ),
    ).toEqual(["solo -> one/SKILL.md"]);
  });

  test("no rows left means nothing is read at all", async () => {
    // Load-bearing version of "empty input is not an error": the interesting
    // claim is that it costs no requests, which only the batch log shows.
    const { read, batches } = fakeReader({ "a/SKILL.md": "a" });
    expect(
      await planNamePlacements({
        remaining: [],
        candidates: ["a/SKILL.md"],
        usedPaths: new Set(),
        readNames: read,
        waveSize: 10,
      }),
    ).toEqual([]);
    expect(batches).toEqual([]);
  });

  test("the underscore alignment reaches this pass too", async () => {
    // `matchesSkillIdExactly` folds separators but not case (see skillMatch.ts).
    // Pass 2 inherits that, so a file named `http_mcp_headers` binds to slug
    // `http-mcp-headers` here — the row the production bind audit flagged.
    const { read } = fakeReader({ "skills/http/SKILL.md": "http_mcp_headers" });
    expect(
      pairs(
        await planNamePlacements({
          remaining: [ref("http-mcp-headers")],
          candidates: ["skills/http/SKILL.md"],
          usedPaths: new Set(),
          readNames: read,
          waveSize: 10,
        }),
      ),
    ).toEqual(["http-mcp-headers -> skills/http/SKILL.md"]);
  });
});

describe("planNamePlacements — no candidate is offered twice", () => {
  test("a name refused in an early batch is not reconsidered later", async () => {
    // The exact phase sees each batch once, which is a cost decision resting on
    // a correctness claim: `open` only shrinks, so a name that failed cannot
    // start matching. If that claim were wrong, `late` below would end up bound
    // to the file read in batch 1.
    const { read, batches } = fakeReader({
      "first/SKILL.md": "unrelated-name",
      "second/SKILL.md": "late",
    });
    const binds = await planNamePlacements({
      remaining: [ref("late")],
      candidates: ["first/SKILL.md", "second/SKILL.md"],
      usedPaths: new Set(),
      readNames: read,
      waveSize: 1,
    });
    expect(pairs(binds)).toEqual(["late -> second/SKILL.md"]);
    expect(batches).toHaveLength(2);
    // Every path appears in exactly one bind, and every bound path was read.
    const bound = binds.map((b) => b.path);
    expect(new Set(bound).size).toBe(bound.length);
  });

  test("a full multi-batch walk spends each row and each path once", async () => {
    const table: Record<string, string> = {};
    const candidates: string[] = [];
    const remaining: SkillRef[] = [];
    for (let i = 0; i < 7; i++) {
      const path = `w${i}/SKILL.md`;
      table[path] = `s${i}`;
      candidates.push(path);
      remaining.push(ref(`s${i}`));
    }
    const { read, batches } = fakeReader(table);
    const binds = await planNamePlacements({
      remaining,
      candidates,
      usedPaths: new Set(),
      readNames: read,
      waveSize: 3,
    });
    expect(pairs(binds)).toEqual([
      "s0 -> w0/SKILL.md",
      "s1 -> w1/SKILL.md",
      "s2 -> w2/SKILL.md",
      "s3 -> w3/SKILL.md",
      "s4 -> w4/SKILL.md",
      "s5 -> w5/SKILL.md",
      "s6 -> w6/SKILL.md",
    ]);
    expect(batches.map((b) => b.length)).toEqual([3, 3, 1]);
    expect(new Set(binds.map((b) => b.path)).size).toBe(7);
    expect(new Set(binds.map((b) => b.skill.skillId)).size).toBe(7);
  });
});

describe("shared types stay assignable", () => {
  test("a NamedCandidate is what the reader returns", () => {
    // Cheap guard that `NameReader`'s element type and `NamedCandidate` have not
    // drifted apart, since the caller in convex/skills.ts builds these by hand.
    const c: NamedCandidate = { path: "a/SKILL.md", name: "a" };
    const r: Awaited<ReturnType<NameReader>> = [c, null];
    expect(r).toHaveLength(2);
  });
});
