import type { ReactElement } from "react";
import type { BundledLanguage } from "shiki/langs";
import { highlight } from "@/components/ui/cubby-ui/code-block/lib/shiki-shared";

export type PreHighlightedCode = Record<string, ReactElement>;

export function codeKey(language: string, code: string): string {
  return `${language}\n---\n${code}`;
}

const FENCE_REGEX = /```([\w+-]+)?[ \t]*\n([\s\S]*?)\n```/g;

export async function highlightMarkdownCode(
  markdown: string,
): Promise<PreHighlightedCode> {
  const fences: Array<{ language: string; code: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = FENCE_REGEX.exec(markdown)) !== null) {
    // Fences with no language (file trees, plain output) are highlighted as
    // "text" — a no-op grammar — so they're pre-rendered server-side too and
    // don't flash or fall back to inline-code rendering on the client.
    const language = match[1] ?? "text";
    fences.push({ language, code: match[2] });
  }

  const entries = await Promise.all(
    fences.map(async ({ language, code }) => {
      const element = await highlight(code, language as BundledLanguage);
      return [codeKey(language, code), element] as const;
    }),
  );

  return Object.fromEntries(entries);
}
