/**
 * URL helpers for skill detail / source pages.
 *
 * skills.sh uses two URL shapes for skills based on the source type:
 *   - GitHub (owner/repo):      /{source}/{skillId}        — no prefix
 *   - Well-known (domain.com):  /site/{source}/{skillId}   — `/site/` prefix
 *
 * The `/site/` prefix exists because well-known sources are domain names
 * containing dots, and a bare `/open.feishu.cn/...` URL would collide with
 * single-segment site routes. The prefix namespaces well-known sources
 * cleanly without changing the URL shape for GitHub-sourced skills.
 *
 * Always route through these helpers when building hrefs to a skill or its
 * source — never hard-code the path shape at call sites.
 */

/** "owner/repo" (GitHub) vs "domain.com" (well-known). Dots in the org
 *  segment indicate well-known. Mirrors the same check on the Convex side. */
export function isGitHubSource(source: string): boolean {
  const parts = source.split("/");
  return parts.length === 2 && !parts[0].includes(".");
}

/** href for a skill's detail page. */
export function skillHref(source: string, skillId: string): string {
  return isGitHubSource(source)
    ? `/${source}/${skillId}`
    : `/site/${source}/${skillId}`;
}

/** href for a source's browse page (org for GitHub, all-skills-from-domain
 *  for well-known). */
export function sourceHref(source: string): string {
  return isGitHubSource(source) ? `/${source}` : `/site/${source}`;
}

/** href for an owner-level page — single segment (no slash). Used by the
 *  curated/official directory where each row links to a publisher's home.
 *  GitHub orgs go to bare path; well-known domains (dotted) get /site/. */
export function ownerHref(owner: string): string {
  return owner.includes(".") ? `/site/${owner}` : `/${owner}`;
}

/** Skills.sh's external skill URL for a security audit detail. Used to
 *  link from our audit section to the upstream report. */
export function externalAuditDetailUrl(
  source: string,
  skillId: string,
  partnerSlug: string,
): string {
  const base = isGitHubSource(source)
    ? `https://skills.sh/${source}/${skillId}`
    : `https://skills.sh/site/${source}/${skillId}`;
  return `${base}/security/${partnerSlug}`;
}
