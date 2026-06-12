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

const TableOverride: StreamdownComponents["table"] = ({
  children,
  className,
}) => (
  <div className="my-4 overflow-x-auto">
    <table className={className}>{children}</table>
  </div>
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
      if (!className?.startsWith("language-")) {
        return (
          <code
            className={cn(
              className,
              // break-words: long unbreakable tokens (file paths, URLs) have
              // no break opportunities at `/` or `.`, so in narrow containers
              // they'd overflow — and any overflow-y-auto ancestor (compare
              // columns, the detail sheet) computes overflow-x:auto per spec,
              // turning that overflow into a horizontal scrollbar.
              "rounded-md bg-muted px-1.5 py-0.5 font-medium wrap-break-word",
            )}
          >
            {children}
          </code>
        );
      }
      const language = className.replace("language-", "") as BundledLanguage;
      const code = String(children ?? "").replace(/\n$/, "");
      const initial = preHighlighted?.[codeKey(language, code)];
      return (
        <div className="not-prose my-4">
          <CodeBlock code={code} language={language} initial={initial}>
            <CodeBlockPre className="border-0 bg-transparent">
              <CodeBlockCode />
            </CodeBlockPre>
            <CodeBlockFloatingCopy className="opacity-0 transition-opacity group-hover:opacity-100" />
          </CodeBlock>
        </div>
      );
    };
    return {
      code: CodeOverride,
      table: TableOverride,
      h1: H1Demoted,
      h2: H2Demoted,
      h3: H3Demoted,
      h4: H4Demoted,
      h5: H5Demoted,
    };
  }, [preHighlighted]);

  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none",
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
        className="prose-code:before:content-none prose-code:after:content-none [&_thead]:border-b-border [&_th]:border-b-border prose-headings:text-balance prose-p:text-pretty"
        components={components}
      >
        {children}
      </Streamdown>
    </div>
  );
}
