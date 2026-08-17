/**
 * The /add field's live readout logic.
 *
 * Two things worth pinning: the frame chosen for a given input (the panel is a
 * fixed-floor window and the wrong frame is visible), and that every example
 * row still resolves to the source and slug it advertises. The examples are the
 * page's reference for the accepted forms, so a value that stops parsing turns
 * the reference into misinformation, and nothing else would notice.
 */

import { test, expect, describe } from "vitest";

import { readSkillInput, SKILL_INPUT_EXAMPLES } from "@/lib/add-skill-reading";
import { parseSkillInput } from "@/lib/parse-skill-input";

describe("SKILL_INPUT_EXAMPLES", () => {
  for (const example of SKILL_INPUT_EXAMPLES) {
    test(`${example.label} parses to what it claims`, () => {
      const { source, skillId } = parseSkillInput(example.value);
      expect({ source, skillId }).toEqual(example.expect);
    });
  }

  test("every example reaches the parsed frame", () => {
    for (const example of SKILL_INPUT_EXAMPLES) {
      expect(readSkillInput(example.value).frame).toBe("parsed");
    }
  });
});

describe("readSkillInput — reference frame", () => {
  test("empty input shows the reference with no message", () => {
    expect(readSkillInput("")).toEqual({ frame: "reference" });
    expect(readSkillInput("   ")).toEqual({ frame: "reference" });
  });

  test("input still being typed is not reported as a mistake", () => {
    // Each of these throws from the parser, and none of them is a mistake yet:
    // "https://" alone is a valid URL, so hand-typing one would otherwise walk
    // the panel through Got "g", Got "gi", Got "git".
    for (const partial of [
      "a",
      "anthropics",
      "https:/",
      "https://",
      "https://git",
      "https://github.com",
      "anthropics/",
      "https://skills.sh/anthropics/skills/",
    ]) {
      expect(readSkillInput(partial)).toEqual({ frame: "reference" });
    }
  });

  test("a complete-looking input that cannot parse gets a message", () => {
    const reading = readSkillInput("https://gitlab.com/foo/bar");
    expect(reading.frame).toBe("reference");
    expect(reading).toHaveProperty("message");
  });

  test("the message is the shared copy layer's, not the parser's raw text", () => {
    // addSkillErrorText rewrites this one; the readout must not print the
    // parser's internal wording beside the notice's rewritten wording.
    const reading = readSkillInput("https://gitlab.com/foo/bar");
    expect(reading).toMatchObject({
      message: expect.stringContaining("isn't from skills.sh or GitHub"),
    });
    expect(reading).not.toMatchObject({
      message: expect.stringContaining("URL must be from"),
    });
  });

  test("a scheme-less URL is named as such rather than shown resolved", () => {
    const reading = readSkillInput(
      "github.com/anthropics/skills/tree/main/skills/frontend-design",
    );
    expect(reading).toMatchObject({
      frame: "reference",
      message: expect.stringContaining('Add "https://"'),
    });
  });
});

describe("readSkillInput — parsed frame", () => {
  test("a GitHub deep link resolves source, slug and file", () => {
    expect(
      readSkillInput(
        "https://github.com/anthropics/skills/tree/main/skills/frontend-design",
      ),
    ).toEqual({
      frame: "parsed",
      source: "anthropics/skills",
      skillId: "frontend-design",
      path: "skills/frontend-design/SKILL.md",
      viaGitHub: true,
    });
  });

  test("a skills.sh link names no file", () => {
    expect(
      readSkillInput("https://skills.sh/anthropics/skills/frontend-design"),
    ).toMatchObject({ frame: "parsed", path: undefined, viaGitHub: true });
  });

  test("a well-known source has no repo to fall back to", () => {
    // The route sentence in the panel turns on this, and it is the canonical
    // isGitHubSource that decides it, not a local copy of the dot rule.
    expect(readSkillInput("mintlify.com/mintlify")).toMatchObject({
      frame: "parsed",
      source: "mintlify.com",
      viaGitHub: false,
    });
  });
});
