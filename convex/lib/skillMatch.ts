/**
 * The "does this SKILL.md frontmatter `name` correspond to this catalog slug?"
 * question, in TWO rules over one comparator.
 *
 * `matchesSkillId` is discovery's (skills.ts): loose, because it hunts for the
 * file behind a slug skills.sh already assigned. `matchesSkillIdExactly` is the
 * GitHub-only resolver's (githubOnly.ts): strict, because it invents a permanent
 * slug. They must still bind the SAME file for the same slug — a preview that
 * matched a different file than post-insert discovery would silently rebind the
 * skill after the admin confirmed it — which is a property of ORDER, spelled out
 * on `matchesSkillIdExactly` below.
 *
 * `matchesSkillId`'s looseness (exact name, exact kebab, kebab prefix) exists
 * because skills.sh derives slugs from names in non-obvious ways. Known
 * looseness, parked in TODO.md: bare `startsWith` has no word boundary, so slug
 * "test" matches a file named "Testing Library Helper". Tightening it to
 * `skillId + "-"` is a behaviour change for the whole existing catalog and
 * happens here, once — but it is now DISCOVERY-only, so it no longer touches a
 * slug-inventing write path.
 *
 * Read `matchesSkillIdExactly`'s doc before making the two agree again.
 */
export function kebabCase(name: string): string {
  // Mirrors `normalizeSkillName` in the official CLI (vercel-labs/skills,
  // src/skills.ts): `name.toLowerCase().replace(/[\s_]+/g, "-")`. This used to
  // omit `_`, which was a near-copy missing one character class rather than a
  // deliberate difference — and it showed up in the wild: the bind audit's first
  // production run flagged `github/gh-aw/http-mcp-headers` as not corresponding
  // to its own file, whose name is `http_mcp_headers`. Under the CLI's rule those
  // are the same string.
  //
  // Keep this in step with the CLI rather than with intuition. It is the
  // reference implementation of "what does this name normalise to", and the whole
  // catalog is populated from an ecosystem that follows it.
  return name.toLowerCase().replace(/[\s_]+/g, "-");
}

/**
 * Fold separator runs to `-`, WITHOUT lowercasing.
 *
 * For the slug side of a comparison. `kebabCase` is the right transform for a
 * frontmatter NAME (it reproduces the CLI's `normalizeSkillName`), but applying
 * it to a slug throws away case — and case is exactly the signal the mis-slug
 * guard reads. Folding both sides with `kebabCase` made
 * `matchesSkillIdExactly("MySkill", "MySkill")` true again, reopening the hole
 * that removing the raw-identity arm had closed: a row stored as `MySkill`,
 * which skills.sh (emitting `myskill`) can never adopt.
 *
 * So: separators are noise and fold; case is signal and does not.
 */
export function foldSeparators(slug: string): string {
  return slug.replace(/[\s_]+/g, "-");
}

export function matchesSkillId(fmName: string, skillId: string): boolean {
  const kebab = kebabCase(fmName);
  // The slug side folds separators too, so `matchesSkillIdExactly` stays a
  // SUBSET of this — which the loose/strict framing above assumes, and which
  // `bindAudit` depends on when it judges a bind the binder made. Without it the
  // strict matcher accepted pairs the loose one rejected, and the audit flagged
  // rows the binder had just bound.
  //
  // Widening only ever adds matches to THIS function — but discovery's scan is
  // first-match-wins, so a newly-matching row can take a file another row would
  // otherwise have had. See `censusSeparatorSlugs` (convex/bindAudit.ts) for what
  // is and is not counted.
  const slug = foldSeparators(skillId);
  return fmName === skillId || kebab === slug || kebab.startsWith(slug);
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
 * What makes the two agree is ORDER, and it took a wrong argument to find that
 * out. The original claim here was "a stricter preview can only refuse where
 * discovery would have matched, so a refusal writes no row to disagree about".
 * That is false in a first-match-wins scan over an ordered candidate list:
 * skipping a candidate the loose rule would have taken does not end the walk, it
 * selects a LATER file. Given `a-sdk/SKILL.md` (name `vercel-ai-sdk`) listed
 * before `z-ai/SKILL.md` (name `vercel-ai`), a preview for slug `vercel-ai`
 * vouches for z-ai while a loose scan binds a-sdk on the prefix rule — two
 * different files, no refusal anywhere.
 *
 * So discovery's pass 2 was restructured to try EXACT across every candidate
 * before ANY candidate is offered to the loose rule (skills.ts). With that,
 * whatever the strict preview binds, discovery's exact phase reaches first. The
 * invariant to preserve is that global two-phase ordering, not "exact lookups
 * come first in the loop".
 *
 * A consequence worth knowing: a match here means `kebabCase(fmName) ===
 * foldSeparators(skillId)` — the SEPARATOR-folded forms agree, so the two may
 * differ by `_` vs `-` but never by case. `canonicalSlug(fmName)` therefore
 * equals `foldSeparators(typedSlug)`, or is null (it also enforces a charset),
 * and `aliasCandidate` compares against that same folded form: a separator
 * difference must not read as a rename, while a case difference must.
 */
export function matchesSkillIdExactly(
  fmName: string,
  skillId: string,
): boolean {
  // Both sides fold SEPARATORS; only the name side folds case.
  //
  // Folding neither was a regression: a repo `owner/agent_skills` with a root
  // SKILL.md named `agent_skills` compared "agent-skills" against the raw typed
  // "agent_skills" and refused a file whose name is character-for-character what
  // the caller typed.
  //
  // Folding BOTH with `kebabCase` was a worse one, and it is the reason
  // `foldSeparators` exists: `kebabCase` lowercases, so `("MySkill","MySkill")`
  // matched again and the row stored `MySkill` — a slug skills.sh (which emits
  // `myskill`) can never adopt. That is the hole removing the raw-identity arm
  // had closed. Case difference is the signal; separator difference is noise.
  //
  // A folder match reaches the same place by a different route: `aliasCandidate`
  // sees the canonical name differs and adopts or refuses it.
  return kebabCase(fmName) === foldSeparators(skillId);
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
 * So anything outside `[a-z0-9.-]` is REJECTED rather than mangled (no `_` —
 * see the inline comment on the charset). Two
 * reasons it must be a rejection: `kebabCase` only lowercases and collapses
 * `[\s_]+` runs, so `/`, `&`, `(`, `)` and friends survive it intact; and the
 * module comment above is explicit that skills.sh derives slugs "in
 * non-obvious ways", so a name this transform can't handle cleanly is exactly
 * the case where guessing writes an unroutable row nothing can repair.
 * Callers treat `null` as "no alias" and fall back to the slug they were
 * given.
 */
export function canonicalSlug(fmName: string): string | null {
  const slug = kebabCase(fmName.trim());
  // No `_` in the charset: `kebabCase` folds every underscore into `-`, so a
  // canonical slug can never contain one and allowing it here would be a dead
  // branch encoding an undecided invariant. This is only about what a NAME can
  // produce — `SAFE_SEGMENT` (lib/install-commands.ts) must keep `_`, because
  // slugs also arrive from the skills.sh sync and from `parseSkillInput` without
  // passing through here, and some of those genuinely contain one.
  if (!/^[a-z0-9.-]+$/.test(slug)) return null;
  // The charset alone still admits ".", ".." and "---" — path-traversal
  // shapes, not names. `.` also survives encodeURIComponent, so ".." would
  // normalise a segment away in the skills.sh request path. Require at least
  // one alphanumeric so the guard can't hand back something that is only
  // separators.
  return /[a-z0-9]/.test(slug) ? slug : null;
}
