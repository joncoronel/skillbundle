# Plan 004: Validate skill identifiers before building copyable install commands

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a0cea73..HEAD -- lib/install-commands.ts lib/og/images.tsx "app/(main)/site/[source]/[skillId]/page.tsx" "app/(main)/[org]/[repo]/[skillId]/page.tsx" tests/`
> If an in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW-MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `a0cea73`, 2026-07-18 (rev 2, same day — scope
  widened after an executor STOP correctly found three additional
  command-assembly sites the original plan missed)

## Why this matters

SkillBundle's core action is: user copies a generated shell one-liner
(`npx skills add ...`) and pastes it into their terminal. The identifiers in
that command (`source`, `skillId`) originate from third-party repos via the
skills.sh catalog — and on the skill detail pages, **directly from URL route
params**. None of them are charset-validated anywhere. Consequences today:

1. A catalog identifier containing shell metacharacters would be embedded
   verbatim in the bundle-page copy command.
2. Worse: `/[org]/[repo]/[skillId]` and `/site/[source]/[skillId]` build
   their copyable command straight from route params, and the page's loading
   skeleton renders that command **before the skill lookup resolves** — so a
   crafted URL displays a hostile copy-pasteable command on a legitimate
   skillbundle.dev page even for a skill that doesn't exist.

This plan puts one strict allowlist in `lib/install-commands.ts` and routes
every command-assembly site through it. There are exactly FOUR sites
(verified by `grep -rn "npx skills add" --include="*.ts" --include="*.tsx" app components lib hooks`
at the planned-at commit): the shared lib, the two detail pages, and the OG
image renderer.

## Current state

- `lib/install-commands.ts` — the bundle-surface command builder. Entire
  current file:

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
  const grouped = new Map<
    string,
    { skillIds: string[]; hasWarning: boolean }
  >();

  for (const skill of skills) {
    const existing = grouped.get(skill.source) ?? {
      skillIds: [],
      hasWarning: false,
    };
    existing.skillIds.push(skill.skillId);
    if (skill.hasContentFetchError) existing.hasWarning = true;
    grouped.set(skill.source, existing);
  }

  return Array.from(grouped.entries()).map(
    ([source, { skillIds, hasWarning }]) => {
      const skillFlags = skillIds.map((id) => `--skill ${id}`).join(" ");
      return {
        source,
        skills: skillIds,
        command: `npx skills add ${source} ${skillFlags}`,
        hasWarning,
      };
    },
  );
}

export function generateAllCommandsText(skills: BundleSkill[]): string {
  return generateInstallCommands(skills)
    .map((cmd) => cmd.command)
    .join(" && ");
}
```

- `app/(main)/[org]/[repo]/[skillId]/page.tsx:59-61` — GitHub-source detail
  page:

```tsx
const { org, repo, skillId } = await params;
const source = `${org}/${repo}`;
const installCommand = `npx skills add ${source} --skill ${skillId}`;
```

- `app/(main)/site/[source]/[skillId]/page.tsx:55-57` — well-known-source
  detail page:

```tsx
const { source, skillId } = await params;
const installCommand = `npx skills add ${source}/${skillId}`;
```

Both pages pass `installCommand` to `<SkillDetailPage>`
(`components/skill-detail-page.tsx`), which renders it in a `<pre>` with a
`CopyButton content={installCommand}` (lines 247/251) AND passes it to the
Suspense fallback skeleton (line 162) — so it paints before data resolves.
`SkillDetailBody` calls `notFound()` when the skill lookup fails (line
200-202), but only after the skeleton has shown the command.

- `lib/og/images.tsx:168-170` — OG image renderer (display-only, but same
  string assembly); note it already imports `isGitHubSource` from
  `convex/lib/source` and already has a skill-not-found branch just above
  (`sectionOgImage({ word: "404", ... })` at ~line 160):

```tsx
const command = isGitHubSource(source)
  ? `npx skills add ${source} --skill ${skillId}`
  : `npx skills add ${source}/${skillId}`;
```

- `convex/lib/source.ts:11-14` — `isGitHubSource(source)`: exactly two
  slash-parts with a dot-free owner. Pure function, importable from app
  code (`lib/og/images.tsx` already does).
- Identifier reality: legitimate GitHub segments are `[A-Za-z0-9._-]` (see
  `GITHUB_URL_RE` in `lib/repo-match.ts:39-41`); well-known sources are
  domains (`example.com`); skill ids are slugs. Whitespace, `%`, and shell
  metacharacters are not legitimate.
- Route-param note (from docs/architecture.md §10): catch-all params arrive
  percent-encoded to the page. A `%` fails the allowlist, so any
  percent-encoded (i.e. non-slug) param is rejected — that is the intended
  behavior, since legitimate slugs never need encoding.
- Test conventions: pure-lib tests live in `tests/*.test.ts` using plain
  vitest — `tests/parse-skill-input.test.ts` is the structural exemplar.

## Commands you will need

| Purpose   | Command                                    | Expected on success |
| --------- | ------------------------------------------ | ------------------- |
| Typecheck | `npx tsc --noEmit`                         | exit 0              |
| Tests     | `pnpm test`                                | all pass            |
| One file  | `pnpm test tests/install-commands.test.ts` | passes              |
| Lint      | `pnpm lint`                                | exit 0              |

## Scope

**In scope** (the only files you should modify):

- `lib/install-commands.ts`
- `app/(main)/[org]/[repo]/[skillId]/page.tsx`
- `app/(main)/site/[source]/[skillId]/page.tsx`
- `lib/og/images.tsx`
- `tests/install-commands.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):

- `components/skill-detail-page.tsx` — its `installCommand: string` prop
  stays required; the pages now guarantee safety before passing it.
- `convex/skills.ts` ingestion path / `convex/lib/source.ts` —
  ingestion-time validation is a deliberate follow-up, not this plan.
- `components/install-commands.tsx` — the UI keeps rendering whatever the
  lib returns; the lib is the boundary.
- The command formats themselves (`npx skills add <owner/repo> --skill <id>`
  and `npx skills add <domain>/<id>`) — they match skills.sh and SPEC.md.

## Git workflow

- Branch: `advisor/004-install-command-id-validation`
- Conventional commit, e.g.
  `fix: validate skill identifiers before building install commands`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the validators and the single-skill builder

In `lib/install-commands.ts`, add:

```ts
import { isGitHubSource } from "@/convex/lib/source";

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
```

If the `@/convex/lib/source` import creates a cycle or lint error, STOP.

**Verify**: `npx tsc --noEmit` → exit 0

### Step 2: Filter in `generateInstallCommands`

Inside the loop, skip any skill whose `source` fails `isSafeCommandSource`
or whose `skillId` fails `isSafeCommandSkillId`. Extend `InstallCommand`
with `excludedSkills: string[]` (default `[]`), and set `hasWarning: true`
for a group that had exclusions. A group whose skills are ALL excluded must
not emit a command at all. Keep grouping, ordering, and `&&` joining
byte-identical for safe inputs.

**Verify**: `npx tsc --noEmit` → exit 0

### Step 3: Route the detail pages through the builder

In BOTH `app/(main)/[org]/[repo]/[skillId]/page.tsx` and
`app/(main)/site/[source]/[skillId]/page.tsx`, replace the inline template
string with:

```tsx
const installCommand = buildSkillInstallCommand(source, skillId);
if (installCommand === null) notFound();
```

(`notFound` from `next/navigation`; check whether each page already imports
it — add the import if not.) This must run BEFORE the `<SkillDetailPage>`
render so the skeleton can never paint an unvalidated command. Everything
else in the pages stays unchanged. Note the produced command strings are
byte-identical to the old inline templates for valid identifiers — the
GitHub page's `--skill` form and the site page's `source/skillId` form both
come out of `buildSkillInstallCommand` via its `isGitHubSource` branch.

**Verify**: `npx tsc --noEmit` → exit 0

### Step 4: Route the OG image through the builder

In `lib/og/images.tsx`, replace the `isGitHubSource(...) ? ... : ...`
command assembly with `buildSkillInstallCommand(source, skillId)`; when it
returns null, return the same not-found OG variant the function already
uses for a missing skill (the `sectionOgImage({ word: "404", ... })` branch
directly above). Remove the now-unused `isGitHubSource` import ONLY if
nothing else in the file uses it.

**Verify**: `npx tsc --noEmit` → exit 0; `pnpm lint` → exit 0

### Step 5: Tests

Create `tests/install-commands.test.ts` (model on
`tests/parse-skill-input.test.ts`). Use placeholder-shaped ids; single
metacharacters only, no composed payloads.

1. Happy path unchanged: two skills same source → one grouped command
   `npx skills add owner/repo --skill a --skill b`; two sources →
   `generateAllCommandsText` joins with `" && "`.
2. `hasContentFetchError` still sets `hasWarning`.
3. A skillId containing a space is excluded; command contains only the safe
   sibling; `excludedSkills` lists it; `hasWarning` is true.
4. Each of these skillIds is excluded: one containing `;`, one containing
   `$`, one containing a backtick, one empty string.
5. A source with three slash segments or a charset-failing segment is
   excluded entirely (no command emitted for that group).
6. Safe punctuation survives: source `owner/repo.name-x`, skillId
   `my_skill.v2` are NOT excluded.
7. `buildSkillInstallCommand`: GitHub source → `--skill` form; well-known
   domain source (`example.com`) → `source/skillId` form; skillId with a
   space → null; source with `%` (an encoded route param) → null.

**Verify**: `pnpm test tests/install-commands.test.ts` → all pass

### Step 6: Full suite + lint

**Verify**: `pnpm test` → all pass; `pnpm lint` → exit 0

## Test plan

Covered in Step 5. The regression this plan exists for: no string failing
the allowlist ever appears in any `command` output, and the detail pages
404 instead of rendering an unvalidated command.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx tsc --noEmit` exits 0; `pnpm lint` exits 0
- [ ] `pnpm test` exits 0; `tests/install-commands.test.ts` exists, ≥ 10
      assertions across the cases above
- [ ] `grep -rn "npx skills add" --include="*.ts" --include="*.tsx" app components lib hooks`
      matches ONLY inside `lib/install-commands.ts` (all other sites now go
      through the builder)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any in-scope file no longer matches its excerpt (drifted).
- The `@/convex/lib/source` import fails from `lib/install-commands.ts`
  (cycle, lint boundary, bundler error) — report; do not copy the function
  body as a workaround.
- The done-criteria grep still finds a fifth assembly site this plan
  doesn't cover — report it.
- Any legitimate catalog identifier shape verifiable in the repo's
  fixtures/tests fails the allowlist — report, don't loosen unilaterally.

## Maintenance notes

- **Deferred follow-up (recommend as a future plan):** ingestion-time
  validation in `convex/skills.ts`'s upsert path (`skillId: s.slug`,
  `convex/skills.ts:103`) so hostile identifiers never enter the catalog.
- The detail pages 404-on-invalid also covers the pre-data skeleton flash;
  if a future refactor moves `installCommand` computation later, keep the
  validation ahead of the first render.
- If the UI later wants "N skills excluded for safety", `excludedSkills`
  already carries the data.
- Reviewer: confirm happy-path command strings are byte-identical to before
  on both page forms and the bundle surface.
