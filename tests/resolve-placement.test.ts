/**
 * Unit tests for convex/lib/resolvePlacement.ts — which SKILL.md a GitHub-only ADD
 * binds.
 *
 * This decision was previously inline in `resolveGitHubSkillMd`, interleaved with
 * tree fetches and raw downloads, so nothing could hold it still. Its ordering rules
 * were rewritten twice after review found the path hint could outvote the folder
 * rule, and neither version was reachable by a test. A wrong bind on this path writes
 * a PERMANENT slug, so the order is worth pinning.
 *
 * Several cases assert on the READS as well as the answer: `pickSkillMd` takes its
 * reader as a parameter, so a fake one records which paths were asked for and in
 * what batches. That is what makes "the hint skips the scan" and "the cap is
 * respected" observable rather than merely argued.
 */
import { test, expect, describe } from "vitest";
import {
  RESOLVE_PASS2_CAP,
  RESOLVE_WAVE_SIZE,
  pickSkillMd,
  type BodyReader,
} from "../convex/lib/resolvePlacement";

/**
 * A reader over a fixed path→frontmatter-name table, recording every batch.
 * `null` in the table means the fetch fails; a path present with `null` name is a
 * file that downloaded but carried no `name:`.
 */
function fakeReader(table: Record<string, string | null | undefined>) {
  const asked: string[] = [];
  const read: BodyReader = async (path) => {
    asked.push(path);
    if (!(path in table)) return null; // not fetchable
    const name = table[path];
    if (name === undefined) return null;
    return { contents: `body of ${path}`, name };
  };
  return { read, asked };
}

const dirIndex = (entries: Record<string, string>) =>
  new Map(Object.entries(entries));

describe("pickSkillMd — step 1, the folder rule", () => {
  test("a folder named like the slug wins outright", async () => {
    const { read } = fakeReader({ "skills/alpha/SKILL.md": "anything-at-all" });
    const pick = await pickSkillMd({
      skillId: "alpha",
      candidates: ["skills/alpha/SKILL.md"],
      byDir: dirIndex({ alpha: "skills/alpha/SKILL.md" }),
      readBody: read,
    });
    // Note the file's own name is unrelated — the folder rule does not consult it.
    expect(pick).toEqual({
      status: "found",
      path: "skills/alpha/SKILL.md",
      contents: "body of skills/alpha/SKILL.md",
      matchedBy: "dir",
    });
  });

  test("THE HINT CANNOT BEAT IT — the regression that shipped twice", async () => {
    // An earlier version ran the hint before the tree was fetched, so a pasted link
    // to the repo root could bind the root file even though a folder named like the
    // slug existed. The confirm card then vouched for a file the pipeline never
    // binds, because discovery's pass 1 is the same folder lookup.
    const { read, asked } = fakeReader({
      "SKILL.md": "alpha",
      "skills/alpha/SKILL.md": "something-else",
    });
    const pick = await pickSkillMd({
      skillId: "alpha",
      candidates: ["SKILL.md", "skills/alpha/SKILL.md"],
      byDir: dirIndex({ alpha: "skills/alpha/SKILL.md" }),
      pathHint: "SKILL.md",
      readBody: read,
    });
    expect(pick).toMatchObject({
      status: "found",
      path: "skills/alpha/SKILL.md",
      matchedBy: "dir",
    });
    // And the hinted file was never even downloaded.
    expect(asked).toEqual(["skills/alpha/SKILL.md"]);
  });

  test("a folder match that will not download is NOT reported as absent", async () => {
    // The tree says the file exists, so a failed read is transient CDN trouble.
    // Answering "none" here would tell the admin to check their slug, which is
    // exactly the wrong instruction.
    const { read } = fakeReader({});
    const pick = await pickSkillMd({
      skillId: "alpha",
      candidates: ["skills/alpha/SKILL.md"],
      byDir: dirIndex({ alpha: "skills/alpha/SKILL.md" }),
      readBody: read,
    });
    expect(pick).toEqual({
      status: "dir_unreadable",
      path: "skills/alpha/SKILL.md",
    });
  });

  test("the folder lookup is literal — no case or separator folding", async () => {
    // Must stay literal: `aliasBindsSameFile` predicts this result with a plain
    // `Map.get`, and discovery's pass 1 uses the same literal rule. Folding here
    // makes the confirm card vouch for a file the pipeline never binds.
    const byDir = dirIndex({ My_Skill: "skills/My_Skill/SKILL.md" });
    const { read } = fakeReader({ "skills/My_Skill/SKILL.md": "unrelated" });
    for (const slug of ["my-skill", "my_skill", "myskill"]) {
      const pick = await pickSkillMd({
        skillId: slug,
        candidates: ["skills/My_Skill/SKILL.md"],
        byDir,
        readBody: read,
      });
      expect(pick.status).toBe("none");
    }
  });
});

describe("pickSkillMd — step 2, the pasted URL's hint", () => {
  test("fires for a root-level link, and skips the scan it exists to skip", async () => {
    // The one shape that reaches here: a root SKILL.md in a repo with no folder
    // named like the slug. Everything else would have matched step 1.
    const others = Array.from({ length: 30 }, (_, i) => `p${i}/SKILL.md`);
    const table: Record<string, string> = { "SKILL.md": "the-slug" };
    for (const p of others) table[p] = "unrelated";
    const { read, asked } = fakeReader(table);
    const pick = await pickSkillMd({
      skillId: "the-slug",
      candidates: [...others, "SKILL.md"],
      byDir: dirIndex({}),
      pathHint: "SKILL.md",
      readBody: read,
    });
    expect(pick).toMatchObject({ path: "SKILL.md", matchedBy: "frontmatter" });
    // One read, not 30. This is the entire reason the hint exists.
    expect(asked).toEqual(["SKILL.md"]);
  });

  test("a hint the tree does not confirm is ignored", async () => {
    // The tree is the authority on what exists. A hint for a path that is not a
    // candidate must not be fetched — that was the pre-tree version's bug.
    const { read, asked } = fakeReader({ "real/SKILL.md": "the-slug" });
    const pick = await pickSkillMd({
      skillId: "the-slug",
      candidates: ["real/SKILL.md"],
      byDir: dirIndex({}),
      pathHint: "invented/SKILL.md",
      readBody: read,
    });
    expect(pick).toMatchObject({ path: "real/SKILL.md" });
    expect(asked).not.toContain("invented/SKILL.md");
  });

  test("a hinted file that does not name itself the slug falls through", async () => {
    // The hint reorders; it does not excuse the file from earning the match.
    const { read, asked } = fakeReader({
      "SKILL.md": "some-other-skill",
      "real/SKILL.md": "the-slug",
    });
    const pick = await pickSkillMd({
      skillId: "the-slug",
      candidates: ["SKILL.md", "real/SKILL.md"],
      byDir: dirIndex({}),
      pathHint: "SKILL.md",
      readBody: read,
    });
    expect(pick).toMatchObject({ path: "real/SKILL.md" });
    // Read twice: once as the hint, once in the scan. Acceptable, and the
    // alternative (trusting the hint) is the bug this ordering exists to prevent.
    expect(asked.filter((p) => p === "SKILL.md")).toHaveLength(2);
  });

  test("an unreadable hint is not fatal — unlike an unreadable folder match", async () => {
    // Asymmetric on purpose: the folder rule is a positive identification, so a
    // failed read there is suspicious. A hint is just a guess.
    const { read } = fakeReader({ "real/SKILL.md": "the-slug" });
    const pick = await pickSkillMd({
      skillId: "the-slug",
      candidates: ["SKILL.md", "real/SKILL.md"],
      byDir: dirIndex({}),
      pathHint: "SKILL.md",
      readBody: read,
    });
    expect(pick).toMatchObject({ path: "real/SKILL.md" });
  });

  test("no hint at all is the ordinary case", async () => {
    const { read } = fakeReader({ "real/SKILL.md": "the-slug" });
    const pick = await pickSkillMd({
      skillId: "the-slug",
      candidates: ["real/SKILL.md"],
      byDir: dirIndex({}),
      readBody: read,
    });
    expect(pick).toMatchObject({ path: "real/SKILL.md" });
  });
});

describe("pickSkillMd — step 3, the capped scan", () => {
  test("first match in candidate order wins, not first in the wave to resolve", async () => {
    // Waves are for latency only. Results are checked in candidate order, so the
    // answer is identical to a serial scan — which is what keeps this in step with
    // discovery, whose exact phase is also candidate-ordered.
    const { read } = fakeReader({
      "a/SKILL.md": "wanted",
      "b/SKILL.md": "wanted",
    });
    const pick = await pickSkillMd({
      skillId: "wanted",
      candidates: ["a/SKILL.md", "b/SKILL.md"],
      byDir: dirIndex({}),
      readBody: read,
      waveSize: 10,
    });
    expect(pick).toMatchObject({ path: "a/SKILL.md" });
  });

  test("stops reading once it has a match", async () => {
    const { read, asked } = fakeReader({
      "a/SKILL.md": "wanted",
      "b/SKILL.md": "wanted",
      "c/SKILL.md": "wanted",
    });
    await pickSkillMd({
      skillId: "wanted",
      candidates: ["a/SKILL.md", "b/SKILL.md", "c/SKILL.md"],
      byDir: dirIndex({}),
      readBody: read,
      waveSize: 1,
    });
    expect(asked).toEqual(["a/SKILL.md"]);
  });

  test("never downloads past the cap", async () => {
    // The admin is watching a spinner. A monorepo with hundreds of SKILL.md files
    // must not turn preview into a multi-minute stall, so anything past the cap is
    // treated as not-found rather than eventually found.
    const many = Array.from({ length: 60 }, (_, i) => `p${i}/SKILL.md`);
    const table: Record<string, string> = {};
    for (const p of many) table[p] = "unrelated";
    table["p55/SKILL.md"] = "wanted"; // beyond a cap of 5
    const { read, asked } = fakeReader(table);
    const pick = await pickSkillMd({
      skillId: "wanted",
      candidates: many,
      byDir: dirIndex({}),
      readBody: read,
      cap: 5,
      waveSize: 2,
    });
    expect(pick.status).toBe("none");
    expect(asked).toHaveLength(5);
    expect(asked).not.toContain("p55/SKILL.md");
  });

  test("unreadable and name-less candidates are skipped, not misaligned", async () => {
    // The reader answers per path, so a gap in the middle must not shift the names
    // that follow it onto the wrong paths — the worst outcome available here.
    const { read } = fakeReader({
      "gone/SKILL.md": undefined,
      "nameless/SKILL.md": null,
      "real/SKILL.md": "wanted",
    });
    const pick = await pickSkillMd({
      skillId: "wanted",
      candidates: ["gone/SKILL.md", "nameless/SKILL.md", "real/SKILL.md"],
      byDir: dirIndex({}),
      readBody: read,
      waveSize: 3,
    });
    expect(pick).toMatchObject({ path: "real/SKILL.md" });
  });

  test("nothing claims the slug", async () => {
    const { read } = fakeReader({ "a/SKILL.md": "something-else" });
    expect(
      await pickSkillMd({
        skillId: "wanted",
        candidates: ["a/SKILL.md"],
        byDir: dirIndex({}),
        readBody: read,
      }),
    ).toEqual({ status: "none" });
  });

  test("the exact matcher's separator fold reaches this path too", async () => {
    // `matchesSkillIdExactly` folds separators but not case. Same rule as
    // discovery, deliberately — the two must bind the same file for the same slug.
    const { read } = fakeReader({ "a/SKILL.md": "http_mcp_headers" });
    expect(
      await pickSkillMd({
        skillId: "http-mcp-headers",
        candidates: ["a/SKILL.md"],
        byDir: dirIndex({}),
        readBody: read,
      }),
    ).toMatchObject({ path: "a/SKILL.md", matchedBy: "frontmatter" });
    // …but a case difference is still a different skill.
    const upper = fakeReader({ "a/SKILL.md": "MySkill" });
    expect(
      await pickSkillMd({
        skillId: "MySkill",
        candidates: ["a/SKILL.md"],
        byDir: dirIndex({}),
        readBody: upper.read,
      }),
    ).toEqual({ status: "none" });
  });

  test("a degenerate waveSize or cap cannot hang the scan", async () => {
    // `slice(i, i + 0)` is always empty, so `i` never advances, and because the
    // loop awaits only settled promises it never yields — a hang rather than an
    // error. Same guard and same reason as `planNamePlacements`. This case would
    // not terminate without the floor.
    const { read } = fakeReader({ "a/SKILL.md": "wanted" });
    for (const waveSize of [0, -3, 0.4]) {
      expect(
        await pickSkillMd({
          skillId: "wanted",
          candidates: ["a/SKILL.md"],
          byDir: dirIndex({}),
          readBody: read,
          waveSize,
        }),
      ).toMatchObject({ path: "a/SKILL.md" });
    }
    // A negative cap reads nothing rather than slicing from the end.
    const neg = fakeReader({ "a/SKILL.md": "wanted" });
    expect(
      await pickSkillMd({
        skillId: "wanted",
        candidates: ["a/SKILL.md"],
        byDir: dirIndex({}),
        readBody: neg.read,
        cap: -1,
      }),
    ).toEqual({ status: "none" });
    expect(neg.asked).toEqual([]);
  });

  test("the shipped defaults are the ones the comments describe", () => {
    expect(RESOLVE_PASS2_CAP).toBe(50);
    expect(RESOLVE_WAVE_SIZE).toBe(10);
  });
});
