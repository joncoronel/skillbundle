/**
 * The one place the "does this SKILL.md frontmatter `name` correspond to this
 * catalog slug?" rule lives. Used by BOTH the background discovery pipeline
 * (skills.ts, discoverSkillMdUrls pass 2) and the admin-facing GitHub-only
 * resolver (githubOnly.ts, pass 2 + the root-file probe), which must bind the
 * same file for the same slug — a preview that matched a different file than
 * post-insert discovery would silently rebind the skill after the admin
 * confirmed it.
 *
 * Matching is deliberately loose (exact name, exact kebab, kebab prefix)
 * because skills.sh derives slugs from names in non-obvious ways. Known
 * looseness, parked in TODO.md: bare `startsWith` has no word boundary, so
 * slug "test" matches a file named "Testing Library Helper"
 * (testing-library-helper). Tightening to `skillId + "-"` is a
 * behavior change for the whole existing catalog, so it happens here, once,
 * as its own change — never in just one caller.
 */
export function kebabCase(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

export function matchesSkillId(fmName: string, skillId: string): boolean {
  const kebab = kebabCase(fmName);
  return fmName === skillId || kebab === skillId || kebab.startsWith(skillId);
}

/**
 * The slug a frontmatter `name` corresponds to, or `null` when that name
 * cannot be one.
 *
 * `kebabCase` above is a COMPARATOR: it feeds `matchesSkillId`, where an odd
 * character just means "no match" and nothing is written. This is the WRITE
 * side — the result can become a row's permanent `skillId`, which is also a
 * single URL path segment (`/[org]/[repo]/[skillId]`) and has to satisfy
 * `SAFE_SEGMENT` in lib/install-commands.ts or the detail page 404s forever
 * and the install command is silently dropped.
 *
 * So anything outside `[a-z0-9._-]` is REJECTED rather than mangled. Two
 * reasons it must be a rejection: `kebabCase` only lowercases and collapses
 * whitespace, so `/`, `&`, `(`, `)` and friends survive it intact; and the
 * module comment above is explicit that skills.sh derives slugs "in
 * non-obvious ways", so a name this transform can't handle cleanly is exactly
 * the case where guessing writes an unroutable row nothing can repair.
 * Callers treat `null` as "no alias" and fall back to the slug they were
 * given.
 */
export function canonicalSlug(fmName: string): string | null {
  const slug = kebabCase(fmName.trim());
  return /^[a-z0-9._-]+$/.test(slug) ? slug : null;
}
