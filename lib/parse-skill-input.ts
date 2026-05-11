/**
 * Pure parser for skill identifiers in the manual-add flow.
 *
 * Used by both:
 *   - The /dev/add-skill form (client) — runs validation before calling the
 *     `addSkillManually` Convex action. Catching invalid input client-side
 *     avoids the dev-mode "Server Error" console overlay that Convex
 *     intentionally surfaces for any server-side throw.
 *   - The `addSkillManually` action (server) — defense-in-depth in case
 *     anyone calls the action via the Convex dashboard or programmatically.
 *     The server wraps thrown `Error`s in `ConvexError` so production
 *     preserves the message instead of redacting to a generic "Server Error".
 *
 * No Convex / React / Node imports — safe to use anywhere.
 *
 * Accepts:
 *   - "https://skills.sh/vercel-labs/agent-skills/next-js-development"
 *   - "vercel-labs/agent-skills/next-js-development" (the v1 API `id` shape)
 *   - "mintlify.com/mintlify" (well-known source)
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
  // (?utm=...), and fragment (#...) uniformly. A non-skills.sh URL is treated
  // as a hard error — better than silently slicing the URL string and shipping
  // garbage to skills.sh, which would surface as a confusing 404.
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(raw);
  } catch {
    // not a URL — fall through to raw "source/slug" handling
  }
  if (parsedUrl) {
    if (parsedUrl.hostname.replace(/^www\./, "") !== "skills.sh") {
      throw new Error(
        `URL must be from skills.sh — got "${parsedUrl.hostname}". Manual adds must reference a skills.sh skill.`,
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
