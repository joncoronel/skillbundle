/**
 * Tailwind Typography's color variables, remapped onto this app's semantic
 * tokens.
 *
 * The plugin's default palette is a gray ramp with a different hue than our
 * OKLCH neutrals, so untouched `prose` reads slightly blue against the rest of
 * the page. Every long-form reading surface needs the same correction, and
 * there is now more than one of them: the SKILL.md renderer
 * (`components/markdown-content.tsx`) and the legal documents
 * (`components/legal-document.tsx`).
 *
 * It lives here, as a plain string, rather than in either of them because the
 * two surfaces have nothing else in common — one is a client component wrapping
 * Streamdown, the other is static server-rendered JSX — and a shared token map
 * is exactly the thing that goes stale when it is copied. A string constant is
 * importable from both without dragging either graph into the other.
 *
 * Both `--tw-prose-*` and `--tw-prose-invert-*` are set for each token, because
 * the surfaces apply `dark:prose-invert` and the invert variant reads the second
 * set. Setting only the first leaves dark mode on the plugin's defaults.
 */
export const PROSE_TOKEN_CLASSES = [
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
].join(" ");

/**
 * The app's link treatment inside prose: the single signal accent, underlined
 * for affordance, with the underline strengthening on hover.
 */
export const PROSE_LINK_CLASSES =
  "prose-a:font-medium prose-a:text-primary prose-a:underline prose-a:decoration-primary/40 prose-a:underline-offset-2 hover:prose-a:decoration-primary";
