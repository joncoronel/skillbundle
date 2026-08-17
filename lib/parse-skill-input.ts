/**
 * Pure parser for skill identifiers in the manual-add flow.
 *
 * Used by both:
 *   - The /dev/add-skill form (client) — runs validation before calling the
 *     `addSkillManually` Convex action. Catching invalid input client-side
 *     avoids the dev-mode "Server Error" console overlay that Convex
 *     intentionally surfaces for any server-side throw.
 *   - The `addSkillManually` / `previewGitHubSkill` / `addSkillFromGitHub`
 *     actions (server) — defense-in-depth in case anyone calls an action via
 *     the Convex dashboard or programmatically. The server wraps thrown
 *     `Error`s in `ConvexError` so production preserves the message instead
 *     of redacting to a generic "Server Error".
 *
 * No Convex / React / Node imports — safe to use anywhere.
 *
 * Accepts:
 *   - "https://skills.sh/vercel-labs/agent-skills/next-js-development"
 *   - "vercel-labs/agent-skills/next-js-development" (the v1 API `id` shape)
 *   - "mintlify.com/mintlify" (well-known source)
 *   - GitHub deep links — the natural artifact in hand for the GitHub-only
 *     fallback (that flow starts from "it's NOT on skills.sh"):
 *       "https://github.com/owner/repo/tree/main/skills/my-skill"
 *       "https://github.com/owner/repo/blob/main/skills/my-skill/SKILL.md"
 *       "https://raw.githubusercontent.com/owner/repo/main/skills/my-skill/SKILL.md"
 *     The slug is the SKILL.md's parent folder (or the deepest path segment).
 *     A SKILL.md at the repo ROOT has no parent folder, so the slug falls back
 *     to the repo name (the conventional slug for a single-skill repo, and what
 *     skills.sh uses for it). A bare repo/tree URL — which names no specific
 *     skill — still errors with guidance.
 *     A wrong guess is harmless: the resolver verifies against the repo (a root
 *     SKILL.md only binds when its frontmatter name matches the slug) and the
 *     user confirms the resolved file path before anything is written.
 *
 * Source-vs-slug split mirrors `isGitHubSource` in convex/skills.ts: a dot in
 * the first segment means it's a well-known source (1-segment source), no dot
 * means GitHub (2-segment source). The remainder is the slug.
 */
/**
 * Hosts that name the SITE and can never be a source.
 *
 * A URL pasted without its scheme fails `new URL` and falls through to the raw
 * `source/slug` path below, where a dot in the first segment marks a
 * well-known source — so `github.com/owner/repo/tree/main/skills/x` parses
 * SUCCESSFULLY as source `github.com` with the whole remainder as the slug.
 * It is the one input shape that looks resolved and is always wrong, and left
 * alone it surfaces downstream as "Only GitHub repos can be added without a
 * skills.sh listing" about a github.com link. Rejected here so every caller
 * (both add surfaces, the live readout, and the server) gets one actionable
 * message instead of a plausible wrong answer.
 */
const SITE_HOSTS = new Set([
  "github.com",
  "raw.githubusercontent.com",
  "skills.sh",
]);

/**
 * The input echoed back inside an error message, length-capped.
 *
 * Every message below quotes what was pasted, and what gets pasted here is
 * long unbreakable machine strings. Uncapped, a stray paste turns a one-line
 * error into a paragraph, which the live readout renders per keystroke.
 */
function quoteInput(input: string): string {
  const trimmed = input.trim();
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
}

export function parseSkillInput(input: string): {
  source: string;
  skillId: string;
  /**
   * The SKILL.md path the input already named, when it named one, e.g.
   * `skills/my-skill/SKILL.md`. GitHub links only — a skills.sh link or the
   * `source/slug` form has no path, and this is absent for them.
   *
   * A HINT, never an authority: the resolver fetches it on the repo's default
   * branch and falls back to the full walk if it isn't there (wrong branch,
   * moved file, or a `tree` URL pointing at a container folder rather than a
   * skill). It exists so a direct link doesn't pay a repo-tree listing to
   * rediscover the path it was handed.
   */
  path?: string;
} {
  let raw = input.trim();
  // If it parses as a URL, use the pathname. Strips host (incl. www.), query
  // (?utm=...), and fragment (#...) uniformly. An unrecognized-host URL is a
  // hard error — better than silently slicing the URL string and shipping
  // garbage to skills.sh, which would surface as a confusing 404.
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(raw);
  } catch {
    // not a URL — fall through to raw "source/slug" handling
  }
  if (parsedUrl) {
    const host = parsedUrl.hostname.replace(/^www\./, "");
    if (host === "github.com" || host === "raw.githubusercontent.com") {
      return parseGitHubUrl(host, parsedUrl.pathname);
    }
    if (host !== "skills.sh") {
      throw new Error(
        `URL must be from skills.sh or github.com. Got "${parsedUrl.hostname}".`,
      );
    }
    raw = parsedUrl.pathname;
  }
  raw = raw.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!raw) {
    throw new Error("Skill input is empty.");
  }

  const parts = raw.split("/").filter(Boolean);
  if (parts.length < 2) {
    // Single-segment input containing a dot (e.g. "google.com") looks like
    // someone pasted a domain without protocol. Give a clearer hint than the
    // generic "expected source/slug" message.
    if (parts.length === 1 && parts[0].includes(".")) {
      throw new Error(
        `"${quoteInput(input)}" looks like a domain. Paste a full skills.sh URL or use the "source/slug" form like "owner/repo/skill-name".`,
      );
    }
    throw new Error(
      `Invalid skill input "${quoteInput(input)}". Expected "source/slug" or a skills.sh URL.`,
    );
  }

  // Dot in first segment → well-known source (e.g. "skills.sh", "mintlify.com").
  const isWellKnown = parts[0].includes(".");
  const sourceSegments = isWellKnown ? 1 : 2;

  // A scheme-less URL lands here with its HOST as the would-be source. See
  // SITE_HOSTS. `www.` is stripped for the comparison because the strip above
  // only runs for inputs that parsed as a real URL, so `www.github.com/...`
  // reaches this point intact.
  if (
    isWellKnown &&
    SITE_HOSTS.has(parts[0].toLowerCase().replace(/^www\./, ""))
  ) {
    throw new Error(
      `Add "https://" to the front. Without it, "${parts[0]}" becomes the source.`,
    );
  }

  if (parts.length <= sourceSegments) {
    throw new Error(
      `Invalid skill input "${quoteInput(input)}". Slug is missing after source.`,
    );
  }

  const source = parts.slice(0, sourceSegments).join("/");
  const skillId = parts.slice(sourceSegments).join("/");
  return { source, skillId };
}

/**
 * Derive {source, skillId} from a GitHub deep link.
 *
 * Path anatomy: `/owner/repo[/tree|blob/<branch>]/<...path>` on github.com,
 * `/owner/repo/<branch>/<...path>` (or `/owner/repo/refs/heads/<branch>/...`)
 * on raw.githubusercontent.com. The slug is derived from the TAIL — the
 * SKILL.md's parent folder when the link points at the file, otherwise the
 * deepest path segment — so a branch name containing slashes can't corrupt
 * it (it only pads the middle of the path, never the tail).
 *
 * The returned `path` gets no such protection, and can't: only one branch
 * segment is dropped, so a slashed branch (`tree/feat/new-stuff/...`) leaves its
 * remainder glued to the front, and GitHub's URL shape gives no way to tell a
 * branch segment from a directory without asking the API. That is why `path` is
 * documented as a hint — a wrong one 404s on the default branch and the resolver
 * falls through to the full tree walk, costing one cheap request rather than a
 * wrong answer. See the slashed-branch case in tests/parse-skill-input.test.ts.
 */
function parseGitHubUrl(
  host: string,
  pathname: string,
): { source: string; skillId: string; path?: string } {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error(
      `That GitHub URL is missing the "owner/repo" part of the path.`,
    );
  }
  const source = `${parts[0]}/${parts[1]}`;

  let rest = parts.slice(2);
  if (host === "github.com") {
    // Drop the "/tree/<branch>" or "/blob/<branch>" structural segments.
    // Anything ELSE after owner/repo (issues/123, pulls, releases/tag/v1,
    // actions, wiki, …) is a non-content GitHub page with no skill path in
    // it — clear it so those URLs land in the guidance error below instead
    // of silently deriving a nonsense slug ("123", "v1") that would surface
    // as a misleading "no matching SKILL.md — check the slug".
    if (rest[0] === "tree" || rest[0] === "blob") rest = rest.slice(2);
    else if (rest.length > 0) rest = [];
  } else {
    // raw.githubusercontent.com: the branch (or "refs/heads/<branch>")
    // comes straight after owner/repo.
    rest =
      rest[0] === "refs" && rest[1] === "heads" ? rest.slice(3) : rest.slice(1);
  }
  // Link to the SKILL.md file itself → the slug is its parent folder.
  let pointedAtSkillMd = false;
  if (rest.length > 0 && rest[rest.length - 1].toLowerCase() === "skill.md") {
    rest = rest.slice(0, -1);
    pointedAtSkillMd = true;
  }

  // A SKILL.md at the repo root leaves no tail segment. Fall back to the repo
  // name — but ONLY when the URL actually pointed at a SKILL.md. A bare repo
  // URL, a tree/branch root, or a non-content page (issues/pulls/...) names no
  // specific skill, so those still error below with guidance. The guess is
  // verified downstream: the resolver only binds a root SKILL.md when its
  // frontmatter name matches this slug, so a monorepo root SKILL.md that isn't
  // named after the repo fails cleanly instead of adding a mis-slugged row.
  let skillId = rest[rest.length - 1] ?? "";
  if (!skillId && pointedAtSkillMd) skillId = parts[1];
  if (!skillId) {
    throw new Error(
      `That GitHub URL points at the repo, not a specific skill. Link the skill's folder (e.g. .../tree/main/skills/my-skill) or use the "owner/repo/skill-name" form.`,
    );
  }
  // The SKILL.md path this URL implies, handed on so the resolver doesn't have
  // to list the whole repo tree to rediscover it. `rest` is already stripped of
  // host, branch and the SKILL.md filename, so it IS the containing directory:
  // append the filename back. A `tree` link (folder, no filename) gets the same
  // treatment, which is a convention rather than a certainty — the resolver
  // verifies by fetching and falls back if it 404s.
  //
  // The BRANCH is deliberately not carried. Every stored `skillMdUrl` is built
  // on the repo's default branch, and discovery re-derives it there too, so
  // honouring a link's branch would let the preview vouch for a file the
  // pipeline never fetches.
  const path = [...rest, "SKILL.md"].join("/");
  return { source, skillId, path };
}
