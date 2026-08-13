import { describe, expect, it } from "vitest";
import {
  docHeadingId,
  extractOutline,
  normalizeOutline,
  slugifyHeading,
} from "@/lib/markdown-outline";

/**
 * The skill page's section nav is built on the server from the raw markdown,
 * while the anchors it links to are emitted later by the renderer walking the
 * parsed tree. Nothing connects the two except `docHeadingId` being pure — so
 * the failure mode is a nav full of links that scroll nowhere, with no error
 * anywhere and no visual difference until someone clicks. That is what this
 * file is for.
 */
describe("extractOutline", () => {
  it("reads ATX headings in document order, deepest level capped at h3", () => {
    const outline = extractOutline(
      ["# Title", "## One", "### Two", "#### Too deep", "## Three"].join("\n"),
    );

    expect(outline.map((item) => [item.depth, item.title])).toEqual([
      [1, "Title"],
      [2, "One"],
      [3, "Two"],
      [2, "Three"],
    ]);
  });

  it("ignores headings inside fenced code", () => {
    // The single most common shape in a SKILL.md: a shell block whose comments
    // start with `#`. Without the fence guard the nav fills with them.
    const outline = extractOutline(
      [
        "## Install",
        "```bash",
        "# Install the CLI",
        "npm i -g thing",
        "## not a heading either",
        "```",
        "## Usage",
        "~~~",
        "# tilde fence",
        "~~~",
        "## Done",
      ].join("\n"),
    );

    expect(outline.map((item) => item.title)).toEqual([
      "Install",
      "Usage",
      "Done",
    ]);
  });

  it("keeps a fence open across a shorter run of the same character", () => {
    const outline = extractOutline(
      ["````md", "```", "# still fenced", "````", "## Real"].join("\n"),
    );

    expect(outline.map((item) => item.title)).toEqual(["Real"]);
  });

  it("skips YAML frontmatter", () => {
    const outline = extractOutline(
      ["---", "name: thing", "# not a heading", "---", "## Real"].join("\n"),
    );

    expect(outline.map((item) => item.title)).toEqual(["Real"]);
  });

  it("drops a repeated heading rather than inventing a second id", () => {
    const outline = extractOutline(["## Usage", "## Other", "## Usage"].join("\n"));

    expect(outline.map((item) => item.id)).toEqual(["doc-usage", "doc-other"]);
  });

  it("strips inline markdown so the title matches what renders", () => {
    const outline = extractOutline(
      [
        "## Use `npx skills` here",
        "## **Bold** heading",
        "## A [link](https://example.com) inside",
      ].join("\n"),
    );

    expect(outline.map((item) => item.title)).toEqual([
      "Use npx skills here",
      "Bold heading",
      "A link inside",
    ]);
  });
});

describe("docHeadingId", () => {
  it("agrees with the id derived from the same heading's rendered text", () => {
    // Both sides of the anchor in one assertion: the extractor sees raw
    // markdown, the renderer sees the flattened text node, and the ids must
    // land on the same string.
    const [item] = extractOutline("## Working with `SKILL.md` files");
    const renderedText = "Working with SKILL.md files";

    expect(item.id).toBe(docHeadingId(renderedText));
    expect(item.id).toBe("doc-working-with-skillmd-files");
  });

  it("leaves intraword underscores for the separator rule to fold", () => {
    // CommonMark renders `snake_case` literally, so stripping the underscore on
    // the extractor side would slug to `snakecase` while the renderer produced
    // `snake-case`. Both must reach the same place.
    const [item] = extractOutline("## The snake_case rule");

    expect(item.id).toBe(docHeadingId("The snake_case rule"));
    expect(item.id).toBe("doc-the-snake-case-rule");
  });

  it("returns undefined for a heading with nothing sluggable in it", () => {
    expect(docHeadingId("!!!")).toBeUndefined();
    expect(slugifyHeading("  ")).toBe("");
  });
});

describe("normalizeOutline", () => {
  it("rebases so the shallowest heading is level 1", () => {
    // A doc that leads with `#` and one that starts at `##` should nest
    // identically; only the relative depth is meaningful.
    const withTitle = normalizeOutline(
      extractOutline(["# Title", "## Section", "### Detail"].join("\n")),
      3,
    );
    const withoutTitle = normalizeOutline(
      extractOutline(["## Title", "### Section", "#### Detail"].join("\n")),
      3,
    );

    expect(withTitle.map((item) => item.level)).toEqual([1, 2, 3]);
    // The `####` is dropped by extractOutline's own depth cap, so this document
    // contributes two levels, both rebased to the same start.
    expect(withoutTitle.map((item) => item.level)).toEqual([1, 2]);
  });

  it("drops anything past the requested level count", () => {
    const outline = normalizeOutline(
      extractOutline(["# Title", "## Section", "### Detail"].join("\n")),
    );

    expect(outline.map((item) => item.title)).toEqual(["Title", "Section"]);
  });

  it("returns nothing for an empty outline", () => {
    expect(normalizeOutline([])).toEqual([]);
  });
});
