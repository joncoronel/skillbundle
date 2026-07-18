import { isGitHubSource } from "./skill-urls";

export interface BundleSkill {
  source: string;
  skillId: string;
  hasContentFetchError?: boolean;
}

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
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

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
 * The single-skill install command (detail pages, OG images). Returns null
 * when either identifier fails the allowlist — callers must treat null as
 * "this is not a real skill" (the pages 404).
 */
export function buildSkillInstallCommand(
  source: string,
  skillId: string,
): string | null {
  if (!isSafeCommandSource(source) || !isSafeCommandSkillId(skillId)) {
    return null;
  }
  return isGitHubSource(source)
    ? `npx skills add ${source} --skill ${skillId}`
    : `npx skills add ${source}/${skillId}`;
}

export function generateInstallCommands(
  skills: BundleSkill[],
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
    if (!isSafeCommandSource(skill.source) || !isSafeCommandSkillId(skill.skillId)) {
      existing.excludedSkills.push(skill.skillId);
      existing.hasWarning = true;
    } else {
      existing.skillIds.push(skill.skillId);
      if (skill.hasContentFetchError) existing.hasWarning = true;
    }
    grouped.set(skill.source, existing);
  }

  const commands: InstallCommand[] = [];
  for (const [source, { skillIds, hasWarning, excludedSkills }] of grouped) {
    if (skillIds.length === 0) continue;
    const skillFlags = skillIds.map((id) => `--skill ${id}`).join(" ");
    commands.push({
      source,
      skills: skillIds,
      command: `npx skills add ${source} ${skillFlags}`,
      hasWarning,
      excludedSkills,
    });
  }
  return commands;
}

export function generateAllCommandsText(skills: BundleSkill[]): string {
  return generateInstallCommands(skills)
    .map((cmd) => cmd.command)
    .join(" && ");
}
