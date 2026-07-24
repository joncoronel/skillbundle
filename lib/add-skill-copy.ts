/**
 * User-facing copy for a non-`ok` GitHub preview, shared by the public flow
 * (`components/add-skill/add-skill-flow.tsx`) and the admin form
 * (`app/(main)/dev/add-skill/add-skill-form.tsx`).
 *
 * The two used to keep hand-written `previewError` switches that had already
 * drifted in wording while describing the same server state, and each
 * re-declared the status union inline — so a new preview status compiled fine
 * against a stale copy table. Here the parameter is the preview object itself,
 * derived from the action's return type, which makes both the wording and the
 * exhaustiveness single-sourced.
 *
 * Only the failure arms live here. `ok` is a card, not a sentence, and the
 * sink (an aria-live notice vs a toast) stays with each component.
 */
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { parseSkillInput } from "@/lib/parse-skill-input";

/**
 * Every preview outcome except `ok`. The admin and public actions return the
 * same union apart from `quota` (an `ok`-only field), so one type covers both.
 */
export type PreviewFailure = Exclude<
  FunctionReturnType<typeof api.githubOnly.previewGitHubSkillPublic>,
  { status: "ok" }
>;

export function previewFailureCopy(preview: PreviewFailure): string {
  switch (preview.status) {
    case "not_github":
      return "Only GitHub repos can be added without a skills.sh listing.";
    case "on_skills_sh":
      // The listing appeared between the add and the preview — a real race, so
      // retrying the same input genuinely is the fix.
      return "skills.sh does list this skill. Try adding it again.";
    case "on_skills_sh_as_alias":
      // Reached only AFTER the client has already re-run the add under this
      // slug and it still failed, so "try again" would point at something that
      // has now failed twice. Name the slug the listing uses instead — it's
      // the one thing this whole path exists to compute.
      return `skills.sh lists that SKILL.md as "${preview.source}/${preview.skillId}" — its frontmatter name, not the folder name in the link. Adding it under that name just failed too, so the listing and the add disagree right now. Try again shortly.`;
    case "already_exists":
      return `${preview.name} is already in the catalog as "${preview.source}/${preview.skillId}".`;
    case "no_repo":
      return "Couldn't find a public GitHub repo there (or GitHub rate-limited the lookup). Try again in a minute.";
    case "no_skill_md":
      return "No matching SKILL.md in that repo (matched by folder name and frontmatter name). Check the slug.";
    case "tree_unavailable":
      return "Couldn't list the repo's files (too large or GitHub rate-limited); the conventional SKILL.md paths were probed with no match. Try again shortly.";
  }
}

/**
 * The slug the user's own input names, or null when it isn't parseable.
 *
 * The confirm card shows the slug the row will actually get, which the
 * frontmatter-name alias can make different from the one in the pasted link.
 * Comparing against this is how the card knows to explain the swap.
 */
export function typedSlugOf(input: string): string | null {
  try {
    return parseSkillInput(input).skillId;
  } catch {
    return null;
  }
}

/**
 * Explains a corrected-slug retry: the add succeeded, but under a slug the
 * user never typed. Shown on the success card / appended to the admin toast so
 * the substitution isn't silent — the flow deliberately re-runs the add
 * without a confirm step, so this sentence is the only place it's disclosed.
 */
export function aliasRetryNote(skillId: string): string {
  return `skills.sh lists it as "${skillId}" — the name in its SKILL.md frontmatter, not the folder name in the link.`;
}
