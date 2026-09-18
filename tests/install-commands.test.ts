/**
 * Unit tests for lib/install-commands.ts.
 *
 * Pure functions — no Convex runtime needed. Covers command grouping,
 * the identifier allowlist that guards copyable shell commands, and the
 * single-skill builder used by the detail pages / OG images.
 */
import { test, expect, describe } from "vitest";
import {
  generateInstallCommands,
  generateAllCommandsText,
  buildSkillInstallCommand,
  buildSourceInstallCommand,
  isSafeSkillRef,
  uncoveredSkills,
  isSafeCommandSource,
  isSafeCommandSkillId,
} from "../lib/install-commands";

describe("generateInstallCommands — happy path", () => {
  test("two skills from the same source group into one --skill-flagged command", () => {
    const result = generateInstallCommands([
      { source: "owner/repo", skillId: "a" },
      { source: "owner/repo", skillId: "b" },
    ]);
    expect(result).toEqual([
      {
        source: "owner/repo",
        skills: ["a", "b"],
        command: "npx skills add owner/repo --skill a --skill b",
        hasWarning: false,
        excludedSkills: [],
      },
    ]);
  });

  test("generateAllCommandsText joins multiple sources with ' && '", () => {
    const text = generateAllCommandsText(
      [
        { source: "owner/repo", skillId: "a" },
        { source: "example.com", skillId: "b" },
      ],
      { "example.com": ["b"] },
    );
    expect(text).toBe(
      "npx skills add owner/repo --skill a && npx skills add https://example.com --skill b",
    );
  });

  test("well-known skills group under the absolute-URL base", () => {
    const result = generateInstallCommands(
      [
        { source: "example.com", skillId: "a" },
        { source: "example.com", skillId: "b" },
      ],
      { "example.com": ["a", "b"] },
    );
    expect(result).toEqual([
      {
        source: "example.com",
        skills: ["a", "b"],
        command: "npx skills add https://example.com --skill a --skill b",
        hasWarning: false,
        excludedSkills: [],
      },
    ]);
  });
});

describe("well-known skills with no usable index", () => {
  test("are excluded from the command and reported as uncovered", () => {
    const skills = [
      { source: "owner/repo", skillId: "a" },
      { source: "bun.sh", skillId: "bun" },
    ];
    // No map entry for bun.sh: its domain serves no root index, so there is no
    // command shape that would work.
    expect(generateInstallCommands(skills)).toEqual([
      {
        source: "owner/repo",
        skills: ["a"],
        command: "npx skills add owner/repo --skill a",
        hasWarning: false,
        excludedSkills: [],
      },
    ]);
    expect(uncoveredSkills(skills)).toEqual([
      { source: "bun.sh", skillIds: ["bun"] },
    ]);
    expect(uncoveredSkills(skills, { "bun.sh": ["bun"] })).toEqual([]);
  });

  test("a source whose skills are all uncovered emits no command group", () => {
    const skills = [{ source: "bun.sh", skillId: "bun" }];
    expect(generateInstallCommands(skills)).toEqual([]);
    expect(uncoveredSkills(skills)).toHaveLength(1);
  });

  test("an index miss raises no content-fetch warning on its source's command", () => {
    // hasWarning drives "their source files could not be found", which is not
    // why this skill has no command. The uncovered list states the real reason.
    const skills = [
      { source: "example.com", skillId: "listed" },
      { source: "example.com", skillId: "unlisted" },
    ];
    const result = generateInstallCommands(skills, {
      "example.com": ["listed"],
    });
    expect(result).toEqual([
      {
        source: "example.com",
        skills: ["listed"],
        command: "npx skills add https://example.com --skill listed",
        hasWarning: false,
        excludedSkills: [],
      },
    ]);
    expect(uncoveredSkills(skills, { "example.com": ["listed"] })).toEqual([
      { source: "example.com", skillIds: ["unlisted"] },
    ]);
  });

  test("unsafe identifiers stay a warning, and stay out of the uncovered list", () => {
    const skills = [
      { source: "example.com", skillId: "listed" },
      { source: "example.com", skillId: "not safe" },
    ];
    const wellKnown = { "example.com": ["listed"] };
    const result = generateInstallCommands(skills, wellKnown);
    expect(result[0].hasWarning).toBe(true);
    expect(result[0].excludedSkills).toEqual(["not safe"]);
    expect(uncoveredSkills(skills, wellKnown)).toEqual([]);
  });

  test("uncovered groups by source", () => {
    expect(
      uncoveredSkills([
        { source: "bun.sh", skillId: "bun" },
        { source: "mintlify.com", skillId: "a" },
        { source: "mintlify.com", skillId: "b" },
        { source: "owner/repo", skillId: "fine" },
      ]),
    ).toEqual([
      { source: "bun.sh", skillIds: ["bun"] },
      { source: "mintlify.com", skillIds: ["a", "b"] },
    ]);
  });
});

describe("generateInstallCommands — content-fetch warnings", () => {
  test("hasContentFetchError still sets hasWarning", () => {
    const result = generateInstallCommands([
      { source: "owner/repo", skillId: "a", hasContentFetchError: true },
    ]);
    expect(result[0].hasWarning).toBe(true);
    expect(result[0].excludedSkills).toEqual([]);
  });
});

describe("generateInstallCommands — unsafe identifier exclusion", () => {
  test("skillId with a space is excluded; safe sibling still emits", () => {
    const result = generateInstallCommands([
      { source: "owner/repo", skillId: "safe" },
      { source: "owner/repo", skillId: "not safe" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].command).toBe("npx skills add owner/repo --skill safe");
    expect(result[0].excludedSkills).toEqual(["not safe"]);
    expect(result[0].hasWarning).toBe(true);
  });

  test("skillIds with ;, $, backtick, or empty string are all excluded", () => {
    const result = generateInstallCommands([
      { source: "owner/repo", skillId: "safe" },
      { source: "owner/repo", skillId: "a;b" },
      { source: "owner/repo", skillId: "a$b" },
      { source: "owner/repo", skillId: "a`b" },
      { source: "owner/repo", skillId: "" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].skills).toEqual(["safe"]);
    expect(result[0].excludedSkills).toEqual(["a;b", "a$b", "a`b", ""]);
  });

  test("source with three slash segments emits no command for that group", () => {
    const result = generateInstallCommands([
      { source: "owner/repo/extra", skillId: "a" },
    ]);
    expect(result).toEqual([]);
  });

  test("source with a charset-failing segment emits no command for that group", () => {
    const result = generateInstallCommands([
      { source: "owner/re;po", skillId: "a" },
    ]);
    expect(result).toEqual([]);
  });

  test("safe punctuation (dots, underscores, hyphens) survives", () => {
    const result = generateInstallCommands([
      { source: "owner/repo.name-x", skillId: "my_skill.v2" },
    ]);
    expect(result).toEqual([
      {
        source: "owner/repo.name-x",
        skills: ["my_skill.v2"],
        command: "npx skills add owner/repo.name-x --skill my_skill.v2",
        hasWarning: false,
        excludedSkills: [],
      },
    ]);
  });
});

describe("isSafeCommandSource / isSafeCommandSkillId", () => {
  test("accepts owner/repo and bare domain shapes", () => {
    expect(isSafeCommandSource("owner/repo")).toBe(true);
    expect(isSafeCommandSource("example.com")).toBe(true);
  });

  test("rejects three-segment and charset-failing sources", () => {
    expect(isSafeCommandSource("owner/repo/extra")).toBe(false);
    expect(isSafeCommandSource("owner/re po")).toBe(false);
  });

  // Dot segments are the one case the charset admits but URL path resolution
  // treats specially: these values are interpolated into API paths, and
  // `/repos/../x` collapses onto `/x`. encodeURIComponent does not help — `.`
  // is unreserved, so ".." survives it untouched.
  test("rejects exact dot segments in either position", () => {
    expect(isSafeCommandSource("..")).toBe(false);
    expect(isSafeCommandSource(".")).toBe(false);
    expect(isSafeCommandSource("../x")).toBe(false);
    expect(isSafeCommandSource("owner/..")).toBe(false);
    expect(isSafeCommandSkillId("..")).toBe(false);
  });

  test("still accepts names that merely contain dots", () => {
    expect(isSafeCommandSource("...")).toBe(true);
    expect(isSafeCommandSource("a.b/c.d")).toBe(true);
    expect(isSafeCommandSkillId("safe.id")).toBe(true);
  });

  test("rejects empty and unsafe skill ids", () => {
    expect(isSafeCommandSkillId("")).toBe(false);
    expect(isSafeCommandSkillId("has space")).toBe(false);
    expect(isSafeCommandSkillId("safe-id_v2.1")).toBe(true);
  });
});

describe("isSafeSkillRef", () => {
  // The skill routes' 404 guard. It has to stay independent of whether a
  // command exists: a well-known skill with no installable index still has a
  // page, and this used to be spelled "buildSkillInstallCommand returned null".
  test("accepts a well-known ref that has no install command", () => {
    expect(isSafeSkillRef("bun.sh", "bun")).toBe(true);
    expect(buildSkillInstallCommand("bun.sh", "bun")).toBeNull();
  });

  test("rejects malformed refs", () => {
    expect(isSafeSkillRef("owner/repo/extra", "a")).toBe(false);
    expect(isSafeSkillRef("owner/repo", "has space")).toBe(false);
    expect(isSafeSkillRef("owner/..", "a")).toBe(false);
  });
});

describe("buildSkillInstallCommand", () => {
  test("GitHub source uses the --skill flag form", () => {
    expect(buildSkillInstallCommand("owner/repo", "my-skill")).toBe(
      "npx skills add owner/repo --skill my-skill",
    );
  });

  // `npx skills add example.com/my-skill` is what this used to emit, and the
  // CLI reads it as the GitHub repo `github.com/example.com/my-skill`. The
  // well-known form needs an absolute URL, and only works when the domain's
  // index sits at its root — which is what the map argument answers.
  test("well-known source needs its index, and uses the absolute-URL form", () => {
    expect(buildSkillInstallCommand("example.com", "my-skill")).toBeNull();
    expect(
      buildSkillInstallCommand("example.com", "my-skill", {
        "example.com": ["other-skill"],
      }),
    ).toBeNull();
    expect(
      buildSkillInstallCommand("example.com", "my-skill", {
        "example.com": ["my-skill"],
      }),
    ).toBe("npx skills add https://example.com --skill my-skill");
  });

  test("skillId with a space returns null", () => {
    expect(buildSkillInstallCommand("owner/repo", "my skill")).toBeNull();
  });

  test("source containing a percent-sign returns null", () => {
    expect(buildSkillInstallCommand("owner/re%20po", "my-skill")).toBeNull();
  });
});

describe("buildSourceInstallCommand", () => {
  test("a GitHub source becomes the flagless whole-repo command", () => {
    expect(buildSourceInstallCommand("vercel-labs/skills")).toBe(
      "npx skills add vercel-labs/skills",
    );
  });

  test("a well-known source needs a root index to get one", () => {
    // `npx skills add bun.sh` parses as a git remote, not a well-known source,
    // so the command has to be the absolute URL — and that only reaches
    // anything when the domain serves its index at the root. bun.sh does not.
    expect(buildSourceInstallCommand("bun.sh")).toBeNull();
    expect(buildSourceInstallCommand("bun.sh", { "bun.sh": [] })).toBeNull();
    expect(
      buildSourceInstallCommand("open.feishu.cn", {
        "open.feishu.cn": ["lark-approval"],
      }),
    ).toBe("npx skills add https://open.feishu.cn");
  });

  test("unsafe or malformed sources get no command", () => {
    expect(buildSourceInstallCommand("owner/repo; rm -rf /")).toBeNull();
    expect(buildSourceInstallCommand("owner/repo/extra")).toBeNull();
    expect(buildSourceInstallCommand("owner/..")).toBeNull();
    expect(buildSourceInstallCommand("")).toBeNull();
  });
});
