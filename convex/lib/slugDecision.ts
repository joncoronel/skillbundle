/**
 * The WRITE policy for a GitHub-only add's slug: given what we learned about
 * the repo, do we store the slug the caller typed, store the one the SKILL.md
 * implies, or refuse to write at all?
 *
 * Separate from `skillMatch.ts`, which owns the read-side question ("does this
 * frontmatter name correspond to this catalog slug?"). This module owns the
 * consequence: a `skillId` is permanent, is a public URL segment, and is the
 * key adoption matches on, so choosing it wrongly is not recoverable without a
 * manual re-slug.
 *
 * Pure and dependency-free so the policy is unit-testable — the alternative is
 * only exercising it by making GitHub's tree API fail mid-add, which is not
 * something a test can arrange.
 */

/** What the caller should do with the slug. */
export type SlugDecision =
  /** Store the slug the caller's input carried. */
  | { kind: "keep_typed" }
  /** Store the frontmatter-derived slug instead. */
  | { kind: "adopt_alias"; alias: string }
  /**
   * Write nothing. We know the right slug and can't safely store it, and
   * storing the typed one would leave a row skills.sh can never adopt.
   *
   * `cause` says WHAT blocked us, not whether waiting helps — deliberately,
   * because "unlisted" covers both a transient rate limit and a repo whose
   * tree is permanently too large to list, and `fetchRepoTree` returns the
   * same `null` for both. A boolean called `retryable` claimed a certainty
   * neither the caller nor this module has.
   */
  | {
      kind: "refuse";
      expectedSkillId: string;
      cause: "unlisted" | "conflict";
    };

/**
 * Which slug, if any, is worth a second look.
 *
 * `null` means "no alias" — either the SKILL.md carried no usable name, or the
 * name already agrees with the typed slug. Gated on `matchedBy === "dir"`
 * because only there did the caller point at this exact folder, making its
 * frontmatter a statement about the skill they meant; a `"frontmatter"` match
 * can come from `matchesSkillId`'s loose prefix arm, and a prefix guess must
 * never name a row.
 */
export function aliasCandidate({
  typedSkillId,
  canonicalFmName,
  matchedBy,
}: {
  typedSkillId: string;
  /** `canonicalSlug(frontmatter name)`, or null when there wasn't one. */
  canonicalFmName: string | null;
  matchedBy: "dir" | "frontmatter";
}): string | null {
  if (canonicalFmName === null) return null;
  if (canonicalFmName === typedSkillId) return null;
  if (matchedBy !== "dir") return null;
  return canonicalFmName;
}

/**
 * The decision, once the alias lookups have come back without claiming the
 * slug themselves (a claimed alias is terminal earlier — `already_exists` or
 * `on_skills_sh_as_alias` — and never reaches here).
 *
 * Order matters and each branch is load-bearing:
 *
 * 1. No alias → nothing to weigh.
 * 2. A row already sits on the typed slug (delisted, since a live one is
 *    terminal earlier) → RELIST it. Beats both writing a second row and
 *    erroring out, and is why this outranks the refusal below.
 * 3. Adopting the alias would make discovery bind a different file, or we
 *    never got the folder list to check → REFUSE. Storing the typed slug here
 *    would "work" (discovery's folder pass binds it) but produces a slug
 *    skills.sh never emits, so the row can never be adopted and reconcile
 *    skips it — a permanently stuck row, written silently. An error the user
 *    can retry is strictly better, and the realistic cause clears on its own.
 * 4. Otherwise the alias is verified safe → adopt it, so a future listing can
 *    adopt the row instead of duplicating it.
 */
export function decideSlug({
  alias,
  typedRowExists,
  aliasBindsSameFile,
  treeListed,
}: {
  /** From `aliasCandidate`. */
  alias: string | null;
  /** Is there any row on the typed slug? (Only a delisted one can reach here.) */
  typedRowExists: boolean;
  /** Would discovery still bind the previewed file if we stored `alias`? */
  aliasBindsSameFile: boolean;
  /** Did we get the repo's file list? Only affects `retryable`. */
  treeListed: boolean;
}): SlugDecision {
  if (alias === null) return { kind: "keep_typed" };
  if (typedRowExists) return { kind: "keep_typed" };
  if (!aliasBindsSameFile) {
    return {
      kind: "refuse",
      expectedSkillId: alias,
      // We either saw a folder claim the alias, or never got the listing at
      // all. Only the first is definite.
      cause: treeListed ? "conflict" : "unlisted",
    };
  }
  return { kind: "adopt_alias", alias };
}
