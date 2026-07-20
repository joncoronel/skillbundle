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
