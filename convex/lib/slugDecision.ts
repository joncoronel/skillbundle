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
 * Pure so the policy is unit-testable — the alternative is only exercising it by
 * making GitHub's tree API fail mid-add, which is not something a test can
 * arrange. It imports `foldSeparators` (also pure) so that "is this the same
 * slug?" is answered by the one comparator, rather than by a second-guess here.
 */

import { foldSeparators } from "./skillMatch";

/** What the caller should do with the slug. */
export type SlugDecision<TAlias = never> =
  /** Store the slug the caller's input carried. */
  | { kind: "keep_typed" }
  /**
   * Store the frontmatter-derived slug instead, and here is whatever the caller
   * attached to that alias.
   *
   * `payload` is carried through rather than re-derived by the caller because a
   * non-null alias is the same condition that produced the caller's alias
   * lookup — so handing it back makes that tie a type fact. Re-deriving it
   * meant either defaulting the lookup away (which would silently flip
   * `wasDelisted` for a delisted alias row, reporting a relist as an insert)
   * or asserting the invariant with a runtime throw.
   */
  | { kind: "adopt_alias"; alias: string; payload: TAlias }
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
 * name already agrees with the typed slug once separators are folded (case is
 * not folded — a case difference IS a rename, see `foldSeparators`).
 *
 * Gated on `matchedBy === "dir"` because only there did the caller point at this
 * exact folder, making its frontmatter a statement about the skill they meant.
 * That gate used to be the only thing standing between a partial-name match and
 * a permanent slug; now that the resolver matches frontmatter names exactly
 * (`matchesSkillIdExactly`), a `"frontmatter"` match implies the name equals the
 * SEPARATOR-FOLDED typed slug — so for a slug that differs only by `_` vs `-`
 * the check above returns null first and this one is unreachable. A CASE
 * difference still reaches it, which is the point: `MySkill` must adopt
 * `myskill`, because that is the slug skills.sh emits.
 *
 * It stays because it is still load-bearing elsewhere: the alias also decides
 * whether `on_skills_sh_as_alias` is returned, and that status makes the client
 * re-run the add with NO confirmation step. Nothing the caller did not
 * explicitly point at may reach an unconfirmed write.
 *
 * That is also why the obvious UX improvement here is not a small change.
 * Pre-filling the confirm card with the corrected slug ("did you mean
 * `panel-review`?") is nicer than refusing, and the display side already exists
 * (`components/add-skill/slug-swap-note.tsx`). But letting an inferred name
 * produce an alias hands it to the unconfirmed re-add above, so it needs a
 * two-tier trust model separating "may pre-fill a card" from "may drive a write
 * nobody confirmed". The UI is the easy half.
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
  // Separator-folded, NOT `kebabCase`d. Comparing against a RAW typed slug
  // reported a rename whenever the two differed only by punctuation: typing
  // `foo_bar` for a file named `foo_bar` derived the alias `foo-bar` and adopted
  // it, silently changing a permanent identity, and on the tree-unavailable path
  // refused the add outright. But folding CASE too would swallow the one
  // difference that must still fire — typed `MySkill` with a file named
  // `MySkill` has to adopt `myskill`, because that is the slug skills.sh emits
  // and the only one adoption can ever match.
  if (canonicalFmName === foldSeparators(typedSkillId)) return null;
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
export function decideSlug<TAlias>({
  alias,
  typedRowExists,
  aliasBindsSameFile,
  treeListed,
}: {
  /**
   * The candidate slug from `aliasCandidate`, paired with whatever the caller
   * looked up for it — handed straight back on `adopt_alias`, so the caller
   * never has to re-derive it. Null when there is no alias to weigh.
   */
  alias: { slug: string; payload: TAlias } | null;
  /** Is there any row on the typed slug? (Only a delisted one can reach here.) */
  typedRowExists: boolean;
  /** Would discovery still bind the previewed file if we stored the alias? */
  aliasBindsSameFile: boolean;
  /** Did we get the repo's file list? Only shapes the refusal's `cause`. */
  treeListed: boolean;
}): SlugDecision<TAlias> {
  if (alias === null) return { kind: "keep_typed" };
  if (typedRowExists) return { kind: "keep_typed" };
  if (!aliasBindsSameFile) {
    return {
      kind: "refuse",
      expectedSkillId: alias.slug,
      // We either saw a folder claim the alias, or never got the listing at
      // all. Only the first is definite.
      cause: treeListed ? "conflict" : "unlisted",
    };
  }
  return { kind: "adopt_alias", alias: alias.slug, payload: alias.payload };
}
