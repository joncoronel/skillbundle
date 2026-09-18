import { isGitHubSource } from "./skill-urls";

export interface BundleSkill {
  source: string;
  skillId: string;
  hasContentFetchError?: boolean;
}

/**
 * What each well-known source can be installed from, keyed by source: the base
 * `npx skills add` takes, and the skill names its index advertises. Comes from
 * `wellKnown.wellKnownSkillNames` (convex/wellKnown.ts). A source absent from
 * the map has no usable index, and an id absent from `skills` is not
 * installable through it.
 *
 * The base is carried rather than rebuilt from the source, because it is not
 * always `https://{source}`: mintlify.com publishes under `/docs`. The prober
 * builds it from a fixed list of base paths, never from a response.
 *
 * Every builder below takes this and defaults it to empty, which is the safe
 * direction: with no map, well-known sources get no command rather than a
 * guessed one. GitHub sources ignore it entirely.
 */
export type WellKnownIndexes = Record<
  string,
  { base: string; skills: string[] }
>;

export interface InstallCommand {
  source: string;
  skills: string[];
  command: string;
  hasWarning: boolean;
  excludedSkills: string[];
}

// Strict allowlist for identifiers interpolated into copyable shell
// commands. Sources are "owner/repo" or a bare domain; skill ids are slugs.
// Anything outside this charset is excluded rather than escaped — correct
// escaping is shell-dependent (bash/zsh/PowerShell/cmd), exclusion is
// unambiguous, and a skill that needs escaping is a skill we don't trust.
//
// The leading lookahead rejects a segment that is exactly "." or "..". The
// charset alone admits both, and these values are also interpolated into URL
// PATHS (e.g. the GitHub API call in loadStars, which carries a token), where
// RFC 3986 dot-segment resolution would collapse `/repos/../x` onto `/x` — a
// different endpoint. `encodeURIComponent` does NOT help: `.` is unreserved,
// so it re-emits ".." unchanged. Rejecting here is the only thing that closes
// it, and it costs nothing real — GitHub does not permit an owner or repo
// named "." or "..", and only exact dot segments are special ("..." is an
// ordinary name and still passes).
const SAFE_SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

export function isSafeCommandSource(source: string): boolean {
  const parts = source.split("/");
  return (
    parts.length >= 1 &&
    parts.length <= 2 &&
    parts.every((p) => p.length > 0 && SAFE_SEGMENT.test(p))
  );
}

export function isSafeCommandSkillId(id: string): boolean {
  return id.length > 0 && SAFE_SEGMENT.test(id);
}

/**
 * Does this (source, skillId) pair look like a real skill reference?
 *
 * The skill routes use this as their 404 guard. It used to be spelled
 * "`buildSkillInstallCommand` returned null", which stopped working the moment
 * a command could be legitimately absent — a well-known skill whose domain
 * publishes no root index still has a page, it just has nothing to copy.
 */
export function isSafeSkillRef(source: string, skillId: string): boolean {
  return isSafeCommandSource(source) && isSafeCommandSkillId(skillId);
}

/**
 * What `npx skills add` takes for this source, or null when it takes nothing.
 *
 * The one place the GitHub / well-known split is decided. A GitHub source is
 * its own `owner/repo` shorthand. A well-known source is only reachable through
 * an absolute URL, and only when its domain serves a skills index at its root,
 * which is what the map records. Why, and what it costs: convex/wellKnown.ts.
 *
 * `skillId` narrows the well-known case further: the CLI matches `--skill`
 * against the names in that index, so a skill the index does not name has no
 * command even when its domain does. Pass it for a single-skill command, omit
 * it for a whole-source one.
 */
export function installBase(
  source: string,
  wellKnown: WellKnownIndexes = {},
  skillId?: string,
): string | null {
  if (!isSafeCommandSource(source)) return null;
  if (isGitHubSource(source)) return source;
  const entry = wellKnown[source];
  if (!entry || entry.skills.length === 0) return null;
  if (skillId !== undefined && !entry.skills.includes(skillId)) return null;
  // The base is built by the prober, but it ends up in a command the reader
  // pastes into a shell, so it gets the same allowlist treatment as every other
  // identifier here rather than being trusted for its provenance. The whole
  // grammar the prober can produce is `https://{source}` plus at most one path
  // segment, so that is all this accepts.
  const root = `https://${source}`;
  if (entry.base === root) return root;
  if (!entry.base.startsWith(`${root}/`)) return null;
  const segment = entry.base.slice(root.length + 1);
  return SAFE_SEGMENT.test(segment) ? entry.base : null;
}

/**
 * The single-skill install command (detail pages, OG images), or null when
 * there isn't one to give. Null is a real answer here, not an error: callers
 * render nothing rather than 404.
 */
export function buildSkillInstallCommand(
  source: string,
  skillId: string,
  wellKnown: WellKnownIndexes = {},
): string | null {
  if (!isSafeSkillRef(source, skillId)) return null;
  const base = installBase(source, wellKnown, skillId);
  return base === null ? null : `npx skills add ${base} --skill ${skillId}`;
}

/**
 * The source-level install command shown on a source's directory page. With no
 * `--skill` flag the CLI lists every skill the source publishes and prompts for
 * a selection, which is the whole point of offering it beside the per-skill
 * commands.
 *
 * A well-known source gets one only when its domain serves an index at its
 * root; see `installBase`.
 */
export function buildSourceInstallCommand(
  source: string,
  wellKnown: WellKnownIndexes = {},
): string | null {
  const base = installBase(source, wellKnown);
  return base === null ? null : `npx skills add ${base}`;
}

export function generateInstallCommands(
  skills: BundleSkill[],
  wellKnown: WellKnownIndexes = {},
): InstallCommand[] {
  const grouped = new Map<
    string,
    { skillIds: string[]; hasWarning: boolean; excludedSkills: string[] }
  >();

  for (const skill of skills) {
    const existing = grouped.get(skill.source) ?? {
      skillIds: [],
      hasWarning: false,
      excludedSkills: [],
    };
    if (!isSafeSkillRef(skill.source, skill.skillId)) {
      // An identifier we refuse to put in a shell command. `hasWarning` is the
      // amber "source files could not be found" line, which is only ever about
      // a skill we cannot fetch, so it stays scoped to that plus the two cases
      // below. A well-known skill its index does not name is neither; it falls
      // to `uncoveredSkills`, which states the real reason.
      existing.excludedSkills.push(skill.skillId);
      existing.hasWarning = true;
    } else if (
      buildSkillInstallCommand(skill.source, skill.skillId, wellKnown)
    ) {
      existing.skillIds.push(skill.skillId);
      if (skill.hasContentFetchError) existing.hasWarning = true;
    }
    grouped.set(skill.source, existing);
  }

  const commands: InstallCommand[] = [];
  for (const [source, { skillIds, hasWarning, excludedSkills }] of grouped) {
    if (skillIds.length === 0) continue;
    const base = installBase(source, wellKnown);
    if (base === null) continue;
    const skillFlags = skillIds.map((id) => `--skill ${id}`).join(" ");
    commands.push({
      source,
      skills: skillIds,
      command: `npx skills add ${base} ${skillFlags}`,
      hasWarning,
      excludedSkills,
    });
  }
  return commands;
}

export function generateAllCommandsText(
  skills: BundleSkill[],
  wellKnown: WellKnownIndexes = {},
): string {
  return generateInstallCommands(skills, wellKnown)
    .map((cmd) => cmd.command)
    .join(" && ");
}

/**
 * Well-known skills whose domain publishes no usable index, grouped by source.
 * The bundle page names them instead of quietly listing fewer skills than the
 * reader added.
 *
 * Scoped to that one reason on purpose. Unsafe identifiers are excluded from a
 * command too, but they already surface as their source's `excludedSkills`, and
 * folding them in here would attach them to a sentence about missing indexes
 * that is not true of them.
 */
export function uncoveredSkills(
  skills: BundleSkill[],
  wellKnown: WellKnownIndexes = {},
): { source: string; skillIds: string[] }[] {
  const bySource = new Map<string, string[]>();
  for (const skill of skills) {
    if (isGitHubSource(skill.source)) continue;
    if (!isSafeSkillRef(skill.source, skill.skillId)) continue;
    if (installBase(skill.source, wellKnown, skill.skillId) !== null) continue;
    const ids = bySource.get(skill.source) ?? [];
    ids.push(skill.skillId);
    bySource.set(skill.source, ids);
  }
  return [...bySource].map(([source, skillIds]) => ({ source, skillIds }));
}
