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
 *
 * That looseness is for DISCOVERY only. The GitHub-only resolver uses
 * `matchesSkillIdExactly` below, because it is inventing a permanent slug rather
 * than finding the file behind one skills.sh already assigned. Read that
 * function's doc before making these two agree again: they are deliberately
 * different, and the direction of the difference is what makes it safe.
 */
export function kebabCase(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

export function matchesSkillId(fmName: string, skillId: string): boolean {
  const kebab = kebabCase(fmName);
  return fmName === skillId || kebab === skillId || kebab.startsWith(skillId);
}

/**
 * The same question WITHOUT the prefix arm, for the GitHub-only add.
 *
 * The two callers are asking different questions, which is why the strictness
 * differs:
 *
 *   - **Discovery** (skills.ts) has a slug skills.sh already assigned and is
 *     hunting for the file behind it. skills.sh derives slugs from names in
 *     non-obvious ways, so a loose match is the safety net. A wrong guess there
 *     binds the wrong file's URL to the row and the content pipeline serves that
 *     file's body, which is a real bug — but a REPAIRABLE one: tighten the rule,
 *     re-run discovery, and the row rebinds. Nothing about the row's identity
 *     changes.
 *   - **The GitHub-only add** (githubOnly.ts) has no upstream slug at all. It is
 *     INVENTING the row's permanent identity from what the caller typed. There
 *     is nothing to be lenient towards, and a wrong guess is unrepairable: type
 *     `panel`, bind the SKILL.md named `panel-review`, and the row is stored as
 *     `panel` forever. skills.sh can then never adopt it (adoption matches
 *     `source` + `skillId`) and the daily sync inserts a SECOND row under the
 *     real slug. See TODO.md, "re-slug a mis-slugged GitHub-only row".
 *
 * Asymmetry is safe in THIS direction only. The shared matcher exists so the
 * file the preview vouches for is the file discovery later binds; a preview that
 * is STRICTER can only refuse where discovery would have matched, and a refusal
 * writes no row for discovery to disagree with. The dangerous direction is a
 * looser preview, which vouches for one file while discovery binds another.
 *
 * A consequence worth knowing: when this matcher is what bound the file,
 * `kebabCase(fmName) === skillId`, so `canonicalSlug(fmName)` equals the typed
 * slug and there is no alias left to adopt. The frontmatter path can no longer
 * produce a row whose stored slug disagrees with its own SKILL.md.
 */
export function matchesSkillIdExactly(
  fmName: string,
  skillId: string,
): boolean {
  return fmName === skillId || kebabCase(fmName) === skillId;
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
  if (!/^[a-z0-9._-]+$/.test(slug)) return null;
  // The charset alone still admits ".", ".." and "---" — path-traversal
  // shapes, not names. `.` also survives encodeURIComponent, so ".." would
  // normalise a segment away in the skills.sh request path. Require at least
  // one alphanumeric so the guard can't hand back something that is only
  // separators.
  return /[a-z0-9]/.test(slug) ? slug : null;
}
