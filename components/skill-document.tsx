import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { MarkdownContent } from "@/components/markdown-content";
import type { PreHighlightedCode } from "@/lib/highlight-markdown-code";
import { rawToBlobUrl } from "@/lib/github-urls";
import { cn } from "@/lib/utils";

/**
 * The SKILL.md itself.
 *
 * Two containers were built for this and both were wrong, so the third answer
 * is that it does not get one.
 *
 * A raised card failed on content length: a card announces its edges at the top
 * and the bottom, and a SKILL.md runs to 20,000px, so for almost the whole time
 * a reader is inside the file there is no edge on screen. A caption-rule /
 * left-spine / closing-rule bracket fixed the visibility and lost on looks — a
 * hairline running unbroken for thousands of pixels is a lot of drawn furniture
 * for a page whose whole system is restraint.
 *
 * What both attempts missed is that the identification problem had already been
 * solved elsewhere, by naming rather than by drawing. By the time a reader
 * reaches this content the page has told them three times whose words these
 * are: the section heading ("Documentation") over its own rule, the line under
 * it saying the author wrote it, and the nav in the sidebar showing the file's
 * headings nested one level under that section. A box around the result was
 * belt-and-braces, and it was the braces that kept looking wrong.
 *
 * So the file is named ON the section header — `SKILL.md` and a link to the
 * source sit on the heading's baseline, in the `meta` slot every section
 * already has — and then the content simply runs. Zero new rules, zero new
 * containers, one rule total for the whole section. What separates the file
 * from the page is now what should always have separated it: it is labelled,
 * it sets at a different size and measure from the UI around it, and it has
 * air on both sides.
 */
export function SkillDocument({
  content,
  preHighlighted,
  sourceUrl,
  className,
}: {
  content: string;
  preHighlighted?: PreHighlightedCode;
  /** Raw SKILL.md URL, used as the base for relative links in the content. */
  sourceUrl: string | null;
  className?: string;
}) {
  return (
    <div className={cn(className)}>
      <MarkdownContent
        preHighlighted={preHighlighted}
        baseUrl={sourceUrl}
        headingIds
        measured
      >
        {content}
      </MarkdownContent>
    </div>
  );
}

/**
 * The file's identity, for the Documentation section's `meta` slot.
 *
 * Lives on the section heading's baseline, which is why the document needs no
 * header of its own: the thing that says "this is a file, and here it is on
 * GitHub" is already on the line that names the section.
 */
export function SkillDocumentMeta({
  sourceUrl,
}: {
  /** Raw SKILL.md URL. Rewritten to the GitHub blob view for the link. */
  sourceUrl: string | null;
}) {
  const fileUrl = sourceUrl ? rawToBlobUrl(sourceUrl) : null;

  return (
    <span className="flex items-center gap-3">
      {/* Mono because it is a filename — the one thing mono is for here. */}
      <span className="font-mono text-foreground">SKILL.md</span>
      {fileUrl && (
        <a
          href={fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 font-medium transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50"
        >
          View source
          <HugeiconsIcon
            icon={ArrowUpRight01Icon}
            strokeWidth={2}
            className="size-3"
          />
        </a>
      )}
    </span>
  );
}
