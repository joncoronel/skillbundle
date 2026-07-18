# Plan 004: Validate skill identifiers before building copyable install commands

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a0cea73..HEAD -- lib/install-commands.ts components/install-commands.tsx tests/`
> If an in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW-MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `a0cea73`, 2026-07-18

## Why this matters

SkillBundle's core action is: user copies a generated shell one-liner
(`npx skills add <source> --skill <id> && ...`) and pastes it into their
terminal. `source` and `skillId` originate from third-party repos via the
skills.sh catalog — untrusted input by this app's own threat model. Today
they are interpolated into the command string with **no charset validation
anywhere** (the backend's `isGitHubSource` in `convex/lib/source.ts` is
explicitly documented as a shape check that "does NOT fully sanitize"). An
identifier containing shell metacharacters (`;`, `&&`, `$(...)`, backticks,
spaces) would land verbatim in the string the user pastes — turning a
catalog listing into command execution on the user's machine. This plan puts
a strict allowlist validation at the one choke point where the string is
built, so a hostile identifier can never reach the clipboard.

## Current state

- `lib/install-commands.ts` — the ONLY place install command strings are
  built (verified: `components/install-commands.tsx` and every other copy
  surface call `generateInstallCommands` / `generateAllCommandsText`).
  Entire current file:

```ts
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
}

export function generateInstallCommands(
  skills: BundleSkill[],
): InstallCommand[] {
  const grouped = new Map<string, { skillIds: string[]; hasWarning: boolean }>();

  for (const skill of skills) {
    const existing = grouped.get(skill.source) ?? { skillIds: [], hasWarning: false };
    existing.skillIds.push(skill.skillId);
    if (skill.hasContentFetchError) existing.hasWarning = true;
    grouped.set(skill.source, existing);
  }

  return Array.from(grouped.entries()).map(([source, { skillIds, hasWarning }]) => {
    const skillFlags = skillIds.map((id) => `--skill ${id}`).join(" ");
    return {
      source,
      skills: skillIds,
      command: `npx skills add ${source} ${skillFlags}`,
      hasWarning,
    };
  });
}

export function generateAllCommandsText(skills: BundleSkill[]): string {
  return generateInstallCommands(skills)
    .map((cmd) => cmd.command)
    .join(" && ");
}
```

- `components/install-commands.tsx:41-70` — renders `cmd.command` in a
  `<pre>` with a `CopyButton content={cmd.command}`. `hasWarning` already
  drives an "install may fail" warning chip elsewhere
  (`components/skill-status-badge.tsx` keys off `hasContentFetchError`).
- Identifier reality: legitimate values are GitHub `owner/repo` sources
  (charset `[A-Za-z0-9._-]` per segment — see `GITHUB_URL_RE` in
  `lib/repo-match.ts:39-41`), well-known-domain sources (e.g.
  `example.com`), and slug-style skill ids (`widget-skill`). Dots, hyphens,
  underscores, and the single `/` in sources are legitimate; whitespace and
  shell metacharacters are not.
- Test conventions: pure-lib tests live in `tests/*.test.ts` using plain
  vitest — `tests/parse-skill-input.test.ts` is the structural exemplar
  (no convex-test, just import + assert).

## Commands you will need

| Purpose   | Command            | Expected on success |
|-----------|--------------------|---------------------|
| Typecheck | `npx tsc --noEmit` | exit 0              |
| Tests     | `pnpm test`        | all pass            |
| One file  | `pnpm test tests/install-commands.test.ts` | passes |
| Lint      | `pnpm lint`        | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `lib/install-commands.ts`
- `tests/install-commands.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):
- `convex/skills.ts` ingestion path / `convex/lib/source.ts` — ingestion-time
  validation is a deliberate follow-up (see Maintenance notes), not this
  plan. Do not add validators to the sync pipeline.
- `components/install-commands.tsx` — the UI keeps rendering whatever the
  lib returns; the lib is the boundary.
- The command format itself (`npx skills add ...`) — it matches skills.sh
  and is documented in `SPEC.md` ("Install command format").

## Git workflow

- Branch: `advisor/004-install-command-id-validation`
- Conventional commit, e.g.
  `fix: exclude unsafe skill identifiers from copyable install commands`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the validators

In `lib/install-commands.ts`, add and export:

```ts
// Strict allowlist for identifiers interpolated into the copyable shell
// command. Sources are "owner/repo" or a bare domain; skill ids are slugs.
// Anything outside this charset is excluded from generated commands rather
// than escaped — a skill that needs escaping is a skill we don't trust.
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
```

Rationale for exclusion over escaping: correct escaping is shell-dependent
(the user may paste into bash, zsh, PowerShell, cmd) — there is no single
safe quoting. Excluding is unambiguous.

**Verify**: `npx tsc --noEmit` → exit 0

### Step 2: Filter in `generateInstallCommands`

Inside the loop, skip any skill whose `source` fails `isSafeCommandSource`
or whose `skillId` fails `isSafeCommandSkillId`, and record that something
was dropped. Extend `InstallCommand` with `excludedSkills: string[]`
(default `[]`), and set `hasWarning: true` for a group that had exclusions
(reusing the existing warning affordance). A group whose skills are ALL
excluded must not emit a command at all. Keep the existing grouping,
ordering, and `&&` joining behavior byte-identical for safe inputs.

**Verify**: `npx tsc --noEmit` → exit 0 (the added field is optional-safe
for existing consumers because nothing reads it yet)

### Step 3: Tests

Create `tests/install-commands.test.ts` (model on
`tests/parse-skill-input.test.ts`). Cases — use placeholder-shaped ids, do
NOT embed real attack payloads beyond single metacharacters:

1. Happy path unchanged: two skills same source → one grouped command
   `npx skills add owner/repo --skill a --skill b`; two sources →
   `generateAllCommandsText` joins with `" && "`.
2. `hasContentFetchError` still sets `hasWarning`.
3. A skillId containing a space is excluded; command contains only the safe
   sibling; `excludedSkills` lists it; `hasWarning` is true.
4. Each of these skillIds is excluded: one containing `;`, one containing
   `$`, one containing a backtick, one empty string.
5. A source with three slash segments or a segment failing the charset is
   excluded entirely (no command emitted for that group).
6. Safe punctuation survives: source `owner/repo.name-x`, skillId
   `my_skill.v2` are NOT excluded.

**Verify**: `pnpm test tests/install-commands.test.ts` → all pass

### Step 4: Full suite + lint

**Verify**: `pnpm test` → all pass; `pnpm lint` → exit 0

## Test plan

Covered in Step 3. The regression this plan exists for is cases 3–5: no
string failing the allowlist ever appears in `command` output.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx tsc --noEmit` exits 0; `pnpm lint` exits 0
- [ ] `pnpm test` exits 0; `tests/install-commands.test.ts` exists, ≥ 8
      assertions across the cases above
- [ ] `grep -n "SAFE_SEGMENT" lib/install-commands.ts` shows the allowlist
      applied in `generateInstallCommands`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `lib/install-commands.ts` no longer matches the excerpt (drifted).
- You find a *second* place command strings are assembled from skill data
  (search: `grep -rn "npx skills add" --include="*.ts" --include="*.tsx" app components lib hooks`)
  — the plan assumes one choke point; report the extra site.
- Any legitimate catalog identifier shape you can verify in the repo's
  fixtures/tests fails the allowlist (the charset would be too strict —
  report, don't loosen unilaterally).

## Maintenance notes

- **Deferred follow-up (recommend as a future plan):** ingestion-time
  validation in `convex/skills.ts`'s upsert path (`skillId: s.slug` at
  `convex/skills.ts:103`), so hostile identifiers never enter the catalog at
  all. Render-time exclusion is the user-protecting boundary; ingestion
  validation is the data-hygiene layer.
- If the UI later wants to *show* "N skills excluded for safety", the
  `excludedSkills` field added in Step 2 already carries the data.
- Reviewer: confirm the happy-path command string is byte-identical to
  before (SPEC.md documents the format; snapshot in test case 1 guards it).
