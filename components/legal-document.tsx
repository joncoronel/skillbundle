import { cn } from "@/lib/utils";
import { LEGAL_LAST_UPDATED } from "@/lib/legal";
import { PROSE_LINK_CLASSES, PROSE_TOKEN_CLASSES } from "@/lib/prose-classes";

/**
 * The reading shell for `/privacy` and `/terms`.
 *
 * These are hand-written JSX rather than markdown run through
 * `components/markdown-content.tsx`, and that is deliberate. That renderer
 * exists to display UNTRUSTED third-party SKILL.md files, so it drags in
 * Streamdown, shiki and the rehype hardening pipeline — several hundred KB of
 * client JS to render text that this repo wrote and that never changes. Static
 * JSX ships zero. Both routes prerender completely.
 *
 * The typographic tokens come from `lib/prose-classes.ts`, shared with the
 * SKILL.md renderer so a legal page and a skill page read as the same document
 * surface.
 *
 * `max-w-2xl` rather than the SKILL.md column's 74ch cap: there is no code
 * block or table here that wants the container's full width, so the whole
 * document can take the measure and the wrapper does the capping in one place.
 */
export function LegalDocument({
  title,
  summary,
  children,
}: {
  title: string;
  /**
   * A plain-language sentence under the title. Not a substitute for the
   * document and not a legal summary — it is there so someone who opened the
   * page with one question can tell within a line whether this is the right
   * page for it.
   */
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 pt-16 pb-8">
      <header>
        <h1 className="text-display-sm">{title}</h1>
        <p className="mt-4 text-sm text-muted-foreground">{summary}</p>
        <p className="mt-6 text-(length:--text-micro) tracking-wide text-muted-foreground uppercase">
          Last updated {LEGAL_LAST_UPDATED}
        </p>
      </header>

      <div
        className={cn(
          "prose mt-12 max-w-none dark:prose-invert",
          "prose-headings:font-semibold prose-headings:tracking-tight",
          // Section headings are anchor targets: every `<LegalSection>` carries
          // an id so a support reply can link to one clause rather than to the
          // top of a long page. 96px is the app-wide sticky-header clearance
          // (DESIGN.md §4) — without it the heading lands under the pill.
          "prose-headings:scroll-mt-24",
          PROSE_LINK_CLASSES,
          PROSE_TOKEN_CLASSES,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * One numbered clause. The `id` is the linkable anchor; keep it stable once
 * published, because an external link to a renamed anchor silently lands at the
 * top of the document instead of erroring.
 */
export function LegalSection({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 id={id}>{heading}</h2>
      {children}
    </section>
  );
}
