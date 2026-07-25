/**
 * Explains that a candidate's slug came from the SKILL.md's frontmatter name
 * rather than the folder in the pasted link.
 *
 * Shared by both confirm cards (public `/add` and admin `/dev/add-skill`)
 * because it is the highest-stakes sentence in the flow: it discloses an
 * identity substitution on a permanent, public URL segment. Two hand-written
 * copies drifted by three words on first writing, which is exactly what
 * `lib/add-skill-copy.ts` exists to prevent — this one lives in a component
 * rather than that module only because it needs a `<code>` element.
 *
 * Renders nothing when the slug is unchanged, so callers can mount it
 * unconditionally.
 */
export function SlugSwapNote({
  typedSlug,
  slugId,
}: {
  /** The slug the caller's own input named, or null if it didn't parse. */
  typedSlug: string | null;
  /** The slug the row will actually get. */
  slugId: string;
}) {
  if (typedSlug === null || typedSlug === slugId) return null;
  return (
    <p className="text-xs text-muted-foreground">
      The slug comes from the name set inside the SKILL.md, not the{" "}
      <code className="font-mono">{typedSlug}</code> folder in the link. That is
      the name skills.sh would give it too.
    </p>
  );
}
