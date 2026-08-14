"use client";

import { isValidElement, useMemo } from "react";
import { Streamdown, defaultRehypePlugins } from "streamdown";
import type { ComponentProps, ReactNode } from "react";
import { harden } from "rehype-harden";
import type { BundledLanguage } from "shiki/langs";
import {
  CodeBlock,
  CodeBlockCode,
  CodeBlockFloatingCopy,
  CodeBlockPre,
} from "@/components/ui/cubby-ui/code-block/code-block";
import {
  codeKey,
  type PreHighlightedCode,
} from "@/lib/highlight-markdown-code";
import { docHeadingId } from "@/lib/markdown-outline";
import { cn } from "@/lib/utils";

type StreamdownComponents = NonNullable<
  ComponentProps<typeof Streamdown>["components"]
>;

interface MarkdownContentProps {
  children: string;
  preHighlighted?: PreHighlightedCode;
  /**
   * Raw GitHub URL of the markdown source (e.g. the SKILL.md file). When set,
   * relative links in the content are resolved against this URL — file links
   * rewrite to github.com/…/blob/… and image links keep pointing at raw content.
   */
  baseUrl?: string | null;
  /**
   * Give headings stable `doc-*` ids so the skill page's section nav can link
   * into the document.
   *
   * Off by default, and it must stay off wherever more than one document can be
   * on screen at once: /compare renders two or three SKILL.mds side by side, and
   * two skills sharing a `## Usage` heading would then emit a duplicate id.
   */
  headingIds?: boolean;
  /**
   * Cap running text at a readable measure while code blocks and tables keep
   * the container's full width.
   *
   * Only useful in a wide container — the skill page's document column is
   * 808px, where uncapped prose measures 93ch against DESIGN.md §3's 65–75ch.
   * A no-op in a narrow column, but left opt-in so the intent is visible at
   * the call site.
   *
   * The cap is 74ch, the TOP of that range rather than the middle, and the
   * reason is the column it sits in. At 68ch the text ran 653px inside 808px,
   * so on a skill with no code blocks or tables — common — the entire document
   * was 155px narrower than the section rules above it and read as inset from
   * its own headers. 74ch is 710px and closes most of that while staying inside
   * the range. The skill page's description carries the same number for the
   * same reason: it is 16px prose in the same column, so a different value
   * would put two paragraphs on two right edges.
   */
  measured?: boolean;
  /**
   * The surface this content is painted on. `"field"` (default) is the page's
   * recessed background, where the code block's canonical two-layer frame (a
   * white card lifted off a gray tray) reads correctly. `"card"` is a raised
   * white container (the compare columns, the detail sheet) where that white
   * inner card would blend into the container — there the code block flattens
   * to a single muted block so it doesn't become a nested card.
   */
  surface?: "field" | "card";
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif)(?:\?|#|$)/i;

// Handles both raw URL shapes GitHub serves:
//   raw.githubusercontent.com/{owner}/{repo}/refs/heads/{ref}/{path}
//   raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}
const RAW_GITHUB_URL_RE =
  /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(?:refs\/(?:heads|tags)\/)?([^/]+)\//;

const DANGEROUS_PROTOCOL_RE = /^\s*(?:javascript|vbscript|file):/i;
const DATA_IMAGE_RE = /^\s*data:image\//i;

function rawToBlobUrl(raw: string): string {
  return raw.replace(RAW_GITHUB_URL_RE, "https://github.com/$1/$2/blob/$3/");
}

// Belt-and-suspenders: defaultRehypePlugins.sanitize is also load-bearing for
// HTML-level XSS, but linkSafety is disabled and harden's allowedProtocols is
// "*" — so we explicitly neutralize URL-based vectors here too rather than
// relying solely on plugin order.
function transformUrl(url: string, key: string): string {
  if (!url) return url;
  if (DANGEROUS_PROTOCOL_RE.test(url)) return "#";
  if (/^\s*data:/i.test(url)) {
    return key === "src" && DATA_IMAGE_RE.test(url) ? url : "#";
  }
  if (url.startsWith("#") || /^(?:mailto|tel):/i.test(url)) {
    return url;
  }
  if (!IMAGE_EXT_RE.test(url) && url.includes("raw.githubusercontent.com")) {
    return rawToBlobUrl(url);
  }
  return url;
}

// Render markdown tables as a self-contained data panel rather than a bare
// prose table: a hairline-framed, rounded container with a mono-label header
// strip, hairline row dividers, and a quiet row hover for scanning. `not-prose`
// hands full styling control to these overrides (prose's table rules use
// zero-specificity `:where()` and would otherwise leak in).
const TableOverride: StreamdownComponents["table"] = ({ children }) => (
  <div className="not-prose my-6 overflow-x-auto rounded-xl border border-border">
    <table
      className={cn(
        "w-full border-collapse text-left text-sm",
        // Hairline dividers between body rows; the header carries its own
        // bottom border, so rows divide from each other, not from the header.
        "[&_tbody]:divide-y [&_tbody]:divide-border",

        // Stop a greedy prose column (long descriptions) from starving the
        // last column below its longest token's width, which forces ugly
        // mid-word link breaks. A floor lets that column break at slashes
        // and hyphens instead.
        "[&_td:last-child]:min-w-40",
        // Keep code-identifier pills (skill names, tokens) on one line so they
        // read as whole identifiers rather than breaking across rows.
        "[&_td_code]:whitespace-nowrap",
        // Links and inline code keep the document's vocabulary inside the panel.
        "[&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:decoration-primary/40 [&_a]:underline-offset-2 [&_a:hover]:decoration-primary",
      )}
    >
      {children}
    </table>
  </div>
);

const TableHeadOverride: StreamdownComponents["thead"] = ({ children }) => (
  <thead className="border-b border-border bg-muted">{children}</thead>
);

const TableThOverride: StreamdownComponents["th"] = ({ children, style }) => (
  <th
    className="px-4 py-2.5 align-middle font-semibold text-foreground whitespace-nowrap"
    style={style}
  >
    {children}
  </th>
);

const TableTdOverride: StreamdownComponents["td"] = ({ children, style }) => (
  <td
    className="px-4 py-3 align-top text-foreground wrap-break-word"
    style={style}
  >
    {children}
  </td>
);

/**
 * Images, unwrapped.
 *
 * Streamdown's own renderer wraps every image in a `<div>` (its
 * `data-streamdown="image-wrapper"`) to host a hover overlay and a download
 * button. Markdown always puts an image inside a paragraph — `![a](b)` alone on
 * a line IS a paragraph containing an image, and `[![a](b)](url)` nests it under
 * a link as well — so that wrapper lands as a `<div>` inside a `<p>`, which is
 * invalid HTML. The browser recovers by closing the `<p>` early, the server
 * markup then disagrees with React's tree, and hydration fails: the whole
 * document is thrown away and re-rendered on the client.
 *
 * A bare `img` element is phrasing content, legal exactly where markdown puts
 * it. The cost is the download button, which on a read-only render of someone
 * else's README is worth less than a document that hydrates — the image's own
 * URL is a right-click away, and the section header links to the source file.
 *
 * Margins are explicit rather than inherited from prose, because prose's `img`
 * rule and the old wrapper's `my-4` disagreed about the value. They do apply
 * despite the element being inline: an image is a replaced element.
 *
 * A raw element and not `next/image`, which is what the lint disable below is
 * for: these are remote images of unknown dimensions, from whatever domain a
 * skill's author chose, and `next/image` needs configured hostnames. `loading`
 * and `decoding` recover most of what it would have given us here, on a
 * document that can carry dozens of screenshots.
 */
const ImageOverride: StreamdownComponents["img"] = ({
  src,
  // Defaulted to empty, which is the correct reading of `![](src)` — the author
  // supplied no description, so the image is decorative and a screen reader
  // should skip it. Omitting the attribute instead makes them fall back to
  // announcing the URL.
  alt = "",
  title,
  // Markdown cannot set these, but `rehype-raw` is on, so an author writing a
  // literal <img> tag reaches this component too.
  width,
  height,
  className,
}) => (
  // Named props rather than a spread, matching the overrides above: the props
  // react-markdown passes include its own `node` (the hast element), which has
  // no business on a DOM node.
  // eslint-disable-next-line @next/next/no-img-element
  <img
    src={src}
    alt={alt}
    title={title}
    width={width}
    height={height}
    loading="lazy"
    decoding="async"
    className={cn("my-4 max-w-full rounded-lg", className)}
  />
);

// Render blockquotes as a neutral callout panel instead of prose's left-stripe
// italic quote. In skill docs these are almost always notes/warnings (often
// led by an emoji + bold label), so a full hairline border + faint tint reads
// as an intentional callout, and dropping the forced italic + auto quote marks
// keeps long copy readable. A colored left-stripe accent is an anti-pattern.
const BlockquoteOverride: StreamdownComponents["blockquote"] = ({
  children,
}) => (
  <blockquote className="my-5 rounded-xl border border-border bg-[color-mix(in_oklch,var(--color-muted),transparent_51%)] px-4 py-3 text-foreground not-italic *:first:mt-0 *:last:mb-0 [&_p]:text-foreground [&_p]:before:content-none [&_p]:after:content-none">
    {children}
  </blockquote>
);

/**
 * Flatten a heading's rendered children to plain text, so its id can be derived
 * from the same string a reader sees. Headings routinely carry inline code,
 * emphasis, or a link, none of which reach us as a bare string.
 */
function childrenToText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(childrenToText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return childrenToText(node.props.children);
  }
  return "";
}

/**
 * Demote SKILL.md headings by one level so the source's leading H1 doesn't
 * compete with the page's title H1. h6 stays at h6, the deepest HTML level.
 *
 * When `withIds` is set the heading also gets the `doc-*` id the section nav
 * links to, computed by the same pure slug rule that built the nav (see
 * lib/markdown-outline.ts), plus `tabIndex={-1}` so a jump moves focus and the
 * screen-reader cursor with it rather than leaving both at the link.
 */
function demotedHeadings(
  withIds: boolean,
): Pick<StreamdownComponents, "h1" | "h2" | "h3" | "h4" | "h5"> {
  function make(
    Tag: "h2" | "h3" | "h4" | "h5" | "h6",
  ): StreamdownComponents["h1"] {
    function DemotedHeading({
      children,
      className,
      id,
    }: {
      children?: ReactNode;
      className?: string;
      id?: string;
    }) {
      const anchorId = withIds
        ? (id ?? docHeadingId(childrenToText(children)))
        : id;
      return (
        <Tag
          className={className}
          id={anchorId}
          {...(withIds && anchorId ? { tabIndex: -1 } : {})}
        >
          {children}
        </Tag>
      );
    }
    DemotedHeading.displayName = `Demoted(${Tag})`;
    return DemotedHeading;
  }

  return {
    h1: make("h2"),
    h2: make("h3"),
    h3: make("h4"),
    h4: make("h5"),
    h5: make("h6"),
  };
}

export function MarkdownContent({
  children,
  preHighlighted,
  baseUrl,
  surface = "field",
  headingIds = false,
  measured = false,
}: MarkdownContentProps) {
  const rehypePlugins = useMemo<
    ComponentProps<typeof Streamdown>["rehypePlugins"]
  >(() => {
    const { raw, sanitize } = defaultRehypePlugins;
    if (!baseUrl) {
      return [raw, sanitize, defaultRehypePlugins.harden];
    }
    return [
      raw,
      sanitize,
      [
        harden,
        {
          allowedImagePrefixes: ["*"],
          allowedLinkPrefixes: ["*"],
          allowedProtocols: ["*"],
          allowDataImages: true,
          defaultOrigin: baseUrl,
        },
      ],
    ];
  }, [baseUrl]);

  const components = useMemo<StreamdownComponents>(() => {
    // Inline code only. Every fenced block (anything react-markdown wraps in a
    // <pre>) is handled by PreOverride below — that's the one place a
    // single-line, no-language fence can be told apart from inline code, since
    // react-markdown v9 dropped the inline/block flag the `code` override used
    // to receive.
    const CodeOverride: StreamdownComponents["code"] = ({
      children,
      className,
    }) => (
      <code
        className={cn(
          className,
          // bg-foreground/N is a theme-adaptive ink tint: it darkens light
          // surfaces and lightens dark ones, so the pill separates from the
          // field, white cards, and the sheet in both modes (a flat bg-muted
          // sat within ~0.02 L of those backgrounds). The hairline border adds
          // a crisp edge regardless of fill contrast.
          // wrap-break-word: long unbreakable tokens (file paths, URLs) have no
          // break opportunities at `/` or `.`, so in narrow containers they'd
          // overflow — and any overflow-y-auto ancestor (compare columns, the
          // detail sheet) computes overflow-x:auto per spec, turning that
          // overflow into a horizontal scrollbar.
          "rounded-sm border border-border/50 bg-foreground/10 px-1.5 py-0.5 font-medium wrap-break-word dark:bg-foreground/10",
        )}
      >
        {children}
      </code>
    );

    const PreOverride: StreamdownComponents["pre"] = ({ node, children }) => {
      // react-markdown hands us the raw <pre> hast node; its <code> child
      // carries the language (className) and the source text. Reading them here
      // means EVERY fenced block routes through CodeBlock — including a
      // single-line block with no language, which is indistinguishable from
      // inline code at the `code` override. The `text` fallback is a no-op
      // grammar for unlabeled blocks (file trees, plain output).
      const codeNode = node?.children?.find(
        (child) => child.type === "element" && child.tagName === "code",
      );
      if (!codeNode || codeNode.type !== "element") {
        return <pre>{children}</pre>;
      }
      const classList = codeNode.properties?.className;
      const languageClass = Array.isArray(classList)
        ? classList.find(
            (c) => typeof c === "string" && c.startsWith("language-"),
          )
        : undefined;
      const fenceLanguage =
        typeof languageClass === "string"
          ? languageClass.replace("language-", "")
          : null;
      const code = codeNode.children
        .map((child) => (child.type === "text" ? child.value : ""))
        .join("")
        .replace(/\n$/, "");
      const language = (fenceLanguage ?? "text") as BundledLanguage;
      const initial = preHighlighted?.[codeKey(language, code)];
      const isCard = surface === "card";
      return (
        <div className="not-prose my-4">
          {/* The outer CodeBlock is always a structureless wrapper (no padding,
              fill, or ring), so the code is a single container, never a
              box-in-a-box. The inner Pre carries the surface: on the field it
              keeps the elevated white (surface-3) card with its rim + shadow;
              on a raised card container that white card would blend into the
              container, so it flattens to a single muted fill. */}
          <CodeBlock
            code={code}
            language={language}
            initial={initial}
            className="rounded-none bg-transparent p-0! shadow-none"
          >
            <CodeBlockPre
              className={
                isCard ? "rounded-xl border-0 bg-muted shadow-none" : undefined
              }
            >
              <CodeBlockCode />
            </CodeBlockPre>
            <CodeBlockFloatingCopy className="opacity-0 transition-opacity group-hover:opacity-100" />
          </CodeBlock>
        </div>
      );
    };
    return {
      code: CodeOverride,
      pre: PreOverride,
      blockquote: BlockquoteOverride,
      img: ImageOverride,
      table: TableOverride,
      thead: TableHeadOverride,
      th: TableThOverride,
      td: TableTdOverride,
      ...demotedHeadings(headingIds),
    };
  }, [preHighlighted, surface, headingIds]);

  return (
    <div
      className={cn(
        // Base (16px / 1.75) rather than prose-sm: this is a long-form reading
        // surface, so it earns a larger measure than the app's dense 14px UI.
        // Section headings land at 24/20px for a clear, scannable hierarchy.
        "prose dark:prose-invert max-w-none",
        // Headings: 600 weight + tight tracking (per the display/headline
        // spec), and drop the first block's top margin so it sits flush under
        // the "Documentation" label.
        "prose-headings:font-semibold prose-headings:tracking-tight",
        "*:first:mt-0",
        // Headings are anchor targets when `headingIds` is on: clear the sticky
        // header on a jump, and stay silent about the programmatic focus (a
        // heading is a landing point, not a control, so it takes no ring).
        headingIds && "prose-headings:scroll-mt-24 prose-headings:outline-none",
        // Two widths, and the split is by KIND: what you READ line by line takes
        // the measure, what you SCAN as a block keeps the container's full
        // width. Prose, lists and headings are the first; code blocks, tables,
        // callouts and images are the second.
        //
        // The blockquote is the one worth stating, because its CONTENT is prose
        // and the temptation is to measure it. It renders as a bordered, tinted
        // callout — a framed object — and a framed object narrower than the code
        // block above it reads as a mistake rather than as a measure. Its own
        // frame is what tells the reader it is a different sort of thing, and
        // that only works if the frame lands where the other frames do.
        //
        // Images are exempted through their PARAGRAPH, not through the image:
        // markdown wraps every image in one (`![a](b)` alone on a line is a
        // paragraph containing an image), so an image inherits the paragraph
        // cap unless the paragraph opts out. `:has()` asks the real question —
        // is this paragraph running text, or is it just an image? — and the
        // second selector covers `[![a](b)](url)`, the linked form. Both
        // out-specify the plain `p` rule, so order here does not matter.
        //
        // `hr` IS measured, against the rule above, and it is the one exception:
        // an author's `---` running the column's full width drew a rule
        // indistinguishable from the page's own section rules (SkillSection's
        // `border-t`), so a break inside the document read as a break BETWEEN
        // documents.
        //
        // Every cap is the same custom property rather than a repeated `74ch`,
        // because `ch` resolves per element — see the @property block in
        // globals.css for why that produced four different right edges.
        //
        // `>*>` and not `>`: Streamdown renders its own wrapper div inside this
        // one, so a direct-child selector here matches that wrapper and nothing
        // else. The top-level blocks are its grandchildren.
        measured &&
          "[--doc-measure:74ch] [&>*>h2]:max-w-[var(--doc-measure)] [&>*>h3]:max-w-[var(--doc-measure)] [&>*>h4]:max-w-[var(--doc-measure)] [&>*>h5]:max-w-[var(--doc-measure)] [&>*>h6]:max-w-[var(--doc-measure)] [&>*>hr]:max-w-[var(--doc-measure)] [&>*>ol]:max-w-[var(--doc-measure)] [&>*>p]:max-w-[var(--doc-measure)] [&>*>ul]:max-w-[var(--doc-measure)] [&>*>p:has(>a>img)]:max-w-none [&>*>p:has(>img)]:max-w-none",
        // Links use the single signal accent, underlined for affordance.
        "prose-a:font-medium prose-a:text-primary prose-a:underline prose-a:decoration-primary/40 prose-a:underline-offset-2 hover:prose-a:decoration-primary",
        // Align prose colors with the app's semantic tokens instead of
        // Tailwind Typography's default gray palette (which has a different
        // hue than our OKLCH neutrals and reads slightly blue).
        "[--tw-prose-body:var(--color-foreground)]",
        "[--tw-prose-invert-body:var(--color-foreground)]",
        "[--tw-prose-headings:var(--color-foreground)]",
        "[--tw-prose-invert-headings:var(--color-foreground)]",
        "[--tw-prose-bold:var(--color-foreground)]",
        "[--tw-prose-invert-bold:var(--color-foreground)]",
        "[--tw-prose-counters:var(--color-muted-foreground)]",
        "[--tw-prose-invert-counters:var(--color-muted-foreground)]",
        "[--tw-prose-bullets:var(--color-muted-foreground)]",
        "[--tw-prose-invert-bullets:var(--color-muted-foreground)]",
        "[--tw-prose-quotes:var(--color-foreground)]",
        "[--tw-prose-invert-quotes:var(--color-foreground)]",
        "[--tw-prose-quote-borders:var(--color-border)]",
        "[--tw-prose-invert-quote-borders:var(--color-border)]",
      )}
    >
      <Streamdown
        rehypePlugins={rehypePlugins}
        controls={false}
        linkSafety={{ enabled: false }}
        urlTransform={transformUrl}
        className="prose-code:before:content-none prose-code:after:content-none"
        components={components}
      >
        {children}
      </Streamdown>
    </div>
  );
}
