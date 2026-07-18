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
    const text = generateAllCommandsText([
      { source: "owner/repo", skillId: "a" },
      { source: "example.com", skillId: "b" },
    ]);
    expect(text).toBe(
      "npx skills add owner/repo --skill a && npx skills add example.com --skill b",
    );
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

  test("rejects empty and unsafe skill ids", () => {
    expect(isSafeCommandSkillId("")).toBe(false);
    expect(isSafeCommandSkillId("has space")).toBe(false);
    expect(isSafeCommandSkillId("safe-id_v2.1")).toBe(true);
  });
});

describe("buildSkillInstallCommand", () => {
  test("GitHub source uses the --skill flag form", () => {
    expect(buildSkillInstallCommand("owner/repo", "my-skill")).toBe(
      "npx skills add owner/repo --skill my-skill",
    );
  });

  test("domain source uses the source/skillId form", () => {
    expect(buildSkillInstallCommand("example.com", "my-skill")).toBe(
      "npx skills add example.com/my-skill",
    );
  });

  test("skillId with a space returns null", () => {
    expect(buildSkillInstallCommand("owner/repo", "my skill")).toBeNull();
  });

  test("source containing a percent-sign returns null", () => {
    expect(buildSkillInstallCommand("owner/re%20po", "my-skill")).toBeNull();
  });
});
