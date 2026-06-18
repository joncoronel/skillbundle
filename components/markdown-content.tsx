"use client";

import { useMemo } from "react";
import { Streamdown, defaultRehypePlugins } from "streamdown";
import type { ComponentProps } from "react";
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
    className="px-4 py-2.5 align-middle font-mono text-eyebrow font-medium tracking-eyebrow text-muted-foreground uppercase whitespace-nowrap"
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

// Render blockquotes as a neutral callout panel instead of prose's left-stripe
// italic quote. In skill docs these are almost always notes/warnings (often
// led by an emoji + bold label), so a full hairline border + faint tint reads
// as an intentional callout, and dropping the forced italic + auto quote marks
// keeps long copy readable. A colored left-stripe accent is an anti-pattern.
const BlockquoteOverride: StreamdownComponents["blockquote"] = ({
  children,
}) => (
  <blockquote className="my-5 rounded-xl border border-border  bg-[color-mix(in_oklch,var(--color-muted),transparent_51%)] px-4 py-3 text-foreground not-italic *:first:mt-0 *:last:mb-0 [&_p]:text-foreground [&_p]:before:content-none [&_p]:after:content-none">
    {children}
  </blockquote>
);

// Demote SKILL.md headings by one level so the source's leading H1 doesn't
// compete with the page's title H1. h6 stays at h6 since that's the deepest
// HTML heading level.
const H1Demoted: StreamdownComponents["h1"] = ({ children, className, id }) => (
  <h2 className={className} id={id}>
    {children}
  </h2>
);
const H2Demoted: StreamdownComponents["h2"] = ({ children, className, id }) => (
  <h3 className={className} id={id}>
    {children}
  </h3>
);
const H3Demoted: StreamdownComponents["h3"] = ({ children, className, id }) => (
  <h4 className={className} id={id}>
    {children}
  </h4>
);
const H4Demoted: StreamdownComponents["h4"] = ({ children, className, id }) => (
  <h5 className={className} id={id}>
    {children}
  </h5>
);
const H5Demoted: StreamdownComponents["h5"] = ({ children, className, id }) => (
  <h6 className={className} id={id}>
    {children}
  </h6>
);

export function MarkdownContent({
  children,
  preHighlighted,
  baseUrl,
  surface = "field",
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
    const CodeOverride: StreamdownComponents["code"] = ({
      children,
      className,
    }) => {
      const code = String(children ?? "").replace(/\n$/, "");
      const fenceLanguage = className?.startsWith("language-")
        ? className.replace("language-", "")
        : null;

      // A code block is either a fenced block with a language or a multiline
      // block fenced without one (file trees, shell sessions). Markdown inline
      // code can't span lines, so a newline reliably marks a block. Plain
      // blocks route through the same CodeBlock as language blocks — with a
      // no-op "text" grammar — so every block shares one frame, scroll, and
      // copy affordance instead of collapsing into wrapped inline-code pills.
      const isBlock = fenceLanguage !== null || code.includes("\n");
      if (!isBlock) {
        return (
          <code
            className={cn(
              className,
              // bg-foreground/N is a theme-adaptive ink tint: it darkens light
              // surfaces and lightens dark ones, so the pill separates from the
              // field, white cards, and the sheet in both modes (a flat
              // bg-muted sat within ~0.02 L of those backgrounds). The hairline
              // border adds a crisp edge regardless of fill contrast.
              // break-words: long unbreakable tokens (file paths, URLs) have
              // no break opportunities at `/` or `.`, so in narrow containers
              // they'd overflow — and any overflow-y-auto ancestor (compare
              // columns, the detail sheet) computes overflow-x:auto per spec,
              // turning that overflow into a horizontal scrollbar.
              "rounded-sm border border-border/50 bg-foreground/10 px-1.5 py-0.5 font-medium wrap-break-word dark:bg-foreground/10",
            )}
          >
            {children}
          </code>
        );
      }
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
      blockquote: BlockquoteOverride,
      table: TableOverride,
      thead: TableHeadOverride,
      th: TableThOverride,
      td: TableTdOverride,
      h1: H1Demoted,
      h2: H2Demoted,
      h3: H3Demoted,
      h4: H4Demoted,
      h5: H5Demoted,
    };
  }, [preHighlighted, surface]);

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
        className="prose-code:before:content-none prose-code:after:content-none prose-headings:text-balance prose-p:text-pretty"
        components={components}
      >
        {children}
      </Streamdown>
    </div>
  );
}
