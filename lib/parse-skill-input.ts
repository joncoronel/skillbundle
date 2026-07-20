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
 *     A repo-root GitHub URL has no derivable slug and errors with guidance.
 *     A wrong guess is harmless: the resolver verifies against the repo and
 *     the admin confirms the resolved file path before anything is written.
 *
 * Source-vs-slug split mirrors `isGitHubSource` in convex/skills.ts: a dot in
 * the first segment means it's a well-known source (1-segment source), no dot
 * means GitHub (2-segment source). The remainder is the slug.
 */
export function parseSkillInput(input: string): {
  source: string;
  skillId: string;
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
        `URL must be from skills.sh or github.com — got "${parsedUrl.hostname}".`,
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
        `"${input}" looks like a domain. Paste a full skills.sh URL or use the "source/slug" form like "owner/repo/skill-name".`,
      );
    }
    throw new Error(
      `Invalid skill input "${input}". Expected "source/slug" or a skills.sh URL.`,
    );
  }

  // Dot in first segment → well-known source (e.g. "skills.sh", "mintlify.com").
  const isWellKnown = parts[0].includes(".");
  const sourceSegments = isWellKnown ? 1 : 2;

  if (parts.length <= sourceSegments) {
    throw new Error(
      `Invalid skill input "${input}". Slug is missing after source.`,
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
 */
function parseGitHubUrl(
  host: string,
  pathname: string,
): { source: string; skillId: string } {
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
  if (rest.length > 0 && rest[rest.length - 1].toLowerCase() === "skill.md") {
    rest = rest.slice(0, -1);
  }

  const skillId = rest[rest.length - 1];
  if (!skillId) {
    throw new Error(
      `That GitHub URL points at the repo, not a specific skill. Link the skill's folder (e.g. .../tree/main/skills/my-skill) or use the "owner/repo/skill-name" form.`,
    );
  }
  return { source, skillId };
}
