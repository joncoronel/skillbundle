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
import { ConvexError } from "convex/values";
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

/**
 * The ONLY prose table for this status union.
 *
 * There used to be a second one server-side, because the confirm action threw
 * its refusals where the preview returned them — and it drifted, exactly as
 * predicted: one round rewrote the wording here and missed the twin. Confirm
 * now returns preview failures too, so every status has one sentence in one
 * place, and a new arm here is the whole change.
 */
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
      return `skills.sh lists that SKILL.md as "${preview.source}/${preview.skillId}", using its frontmatter name rather than the folder name in the link. Adding it under that name just failed too, so the listing and the add disagree right now. Try again shortly.`;
    case "already_exists":
      return alreadyInCatalogCopy(preview);
    case "alias_unverifiable":
      // Deliberately says nothing was added. This is the one failure where the
      // add COULD have gone through — under the wrong slug, producing a row
      // skills.sh can never adopt and only a manual fix repairs. Refusing is
      // the feature, so the copy has to make the refusal read as deliberate
      // rather than as a glitch.
      return preview.cause === "unlisted"
        ? // Hedged: "unlisted" is either a rate limit or a repo whose file tree
          // is permanently too large to list, and the server can't tell which,
          // so this must not promise that waiting fixes it.
          `This skill calls itself "${preview.expectedSkillId}", but GitHub wouldn't list the repo's files, so we couldn't confirm it's safe to add it under that name. Nothing was added. Try again shortly, or once skills.sh lists it.`
        : // Ends with a way out, like the other arm does. This is the one
          // arm of the status a user cannot simply wait out, so a refusal with
          // no recourse would read as a bug rather than the deliberate safety
          // behaviour it is.
          `This skill calls itself "${preview.expectedSkillId}", but another folder in the repo already uses that name, so adding it would attach the wrong file. Nothing was added. It can be added once skills.sh lists it.`;
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
 * Any thrown add-skill failure, as one sentence a user can act on.
 *
 * Shared because the two surfaces had drifted halves of this and only one of
 * them unwrapped `ConvexError.data` — so a structured server refusal reached the
 * admin toast as a stacktrace-flavoured `err.message` with the stringified data
 * inside it, on the page whose job is diagnosing those failures.
 *
 * Still needed now that preview refusals are RETURNED rather than thrown: quota
 * rejections and rate limits are genuinely exceptional and still throw, and both
 * put their prose in `ConvexError.data`.
 *
 * Unwrap first, then normalise: the `[Request ID: …]` strip only helps once the
 * real message has been extracted.
 */
export function addSkillErrorText(err: unknown): string {
  const raw = convexErrorText(err);
  const cleaned = raw.replace(/\[Request ID:.*?\]\s*/g, "").trim();
  if (/URL must be from skills\.sh/i.test(cleaned)) {
    return "That URL isn't from skills.sh or GitHub. Paste one of those, or an owner/repo/slug.";
  }
  // Every arm here is case-insensitive on purpose: this function sniffs message
  // text it does not own (thrown from three different modules), so a narrowed
  // matcher fails silently the first time a caller capitalises differently.
  // Folding a second alternative into a `/i` pattern without keeping the flag is
  // exactly how that happens.
  if (/sign in|not authenticated/i.test(cleaned)) {
    return "Sign in to add a skill.";
  }
  if (/not authorized/i.test(cleaned)) {
    return "You don't have access to do that.";
  }
  // Input-shape complaints from parseSkillInput are already written for a human.
  if (
    /Slug is missing|Invalid skill input|Skill input is empty|looks like a domain/i.test(
      cleaned,
    )
  ) {
    return cleaned;
  }
  return cleaned || "Something went wrong.";
}

/** The message a Convex failure actually carries, `data` before `message`. */
function convexErrorText(err: unknown): string {
  if (err instanceof ConvexError) {
    return typeof err.data === "string"
      ? err.data
      : ((err.data as { message?: string })?.message ?? "Something went wrong.");
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * "X is already in the catalog", naming the slug it actually lives under.
 *
 * Naming it matters most on the alias path, which is exactly when the existing
 * row sits under a slug the caller never typed — so "X is already in the
 * catalog" alone reads as a wrong match, and the real slug would survive only
 * inside a "View skill" link a screen reader never announces.
 */
export function alreadyInCatalogCopy(row: {
  name: string;
  source: string;
  skillId: string;
}): string {
  return `${row.name} is already in the catalog as "${row.source}/${row.skillId}".`;
}

/**
 * The toast title for a failed preview, paired with `previewFailureCopy`.
 *
 * A hand-maintained `status === a || status === b` chain at the call site is the
 * drift this module exists to prevent: a new status defaults to the wrong title
 * and compiles clean. An exhaustive switch makes it a type error instead. The
 * `on_skills_sh*` and `alias_unverifiable` arms are add failures — titling them
 * "Not on skills.sh" makes one toast contradict itself.
 */
export function previewFailureTitle(preview: PreviewFailure): string {
  switch (preview.status) {
    case "on_skills_sh":
    case "on_skills_sh_as_alias":
    case "alias_unverifiable":
    case "already_exists":
      return "Couldn't add skill";
    case "not_github":
    case "no_repo":
    case "no_skill_md":
    case "tree_unavailable":
      return "Not on skills.sh";
  }
}

/**
 * Explains a corrected-slug retry: the add succeeded, but under a slug the
 * user never typed. Shown on the success card / appended to the admin toast so
 * the substitution isn't silent — the flow deliberately re-runs the add
 * without a confirm step, so this sentence is the only place it's disclosed.
 */
export function aliasRetryNote(skillId: string): string {
  return `skills.sh lists it as "${skillId}", using the name in its SKILL.md frontmatter rather than the folder name in the link.`;
}
