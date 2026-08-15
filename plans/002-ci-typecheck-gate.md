# Plan 002: Add a typecheck script and wire it into `pnpm check` and CI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a0cea73..HEAD -- package.json .github/workflows/test.yml`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `a0cea73`, 2026-07-18

## Why this matters

Nothing in this repo runs the TypeScript compiler as a gate: `pnpm check` is
lint + tests, and CI runs only those two. Type errors currently surface only
when someone runs `next build` locally or when the Vercel deploy fails —
after merge. The repo typechecks clean today (`npx tsc --noEmit` exits 0 at
the planned-at commit), so adding the gate is free now and prevents the
first regression from landing silently. This matters extra here because the
app runs a preview Next.js release (`16.3.0-preview.5`) where API drift is a
real risk.

## Current state

- `package.json:6-14` — scripts today:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest",
    "check": "pnpm lint && pnpm test"
  },
```

- `.github/workflows/test.yml:30-37` — CI steps today (after checkout /
  pnpm / node setup):

```yaml
- name: Install dependencies
  run: pnpm install --frozen-lockfile

- name: Lint
  run: pnpm lint

- name: Test
  run: pnpm test
```

- `tsconfig.json` exists at repo root and `npx tsc --noEmit` exits 0 as of
  commit `a0cea73`. `tsconfig.tsbuildinfo` on disk is git-ignored
  (`.gitignore` has `*.tsbuildinfo`) — leave it alone.
- `eslint.config.mjs` uses `eslint-config-next` — its TypeScript rules are
  syntactic and do NOT replace `tsc`.

## Commands you will need

| Purpose   | Command          | Expected on success   |
| --------- | ---------------- | --------------------- |
| Install   | `pnpm install`   | exit 0                |
| Typecheck | `pnpm typecheck` | exit 0 (after Step 1) |
| Tests     | `pnpm test`      | all pass              |
| Lint      | `pnpm lint`      | exit 0                |

## Scope

**In scope** (the only files you should modify):

- `package.json` (scripts block only)
- `.github/workflows/test.yml`

**Out of scope** (do NOT touch):

- `tsconfig.json` / `convex/tsconfig.json` — no compiler-option changes.
- Any source file. If typecheck fails, that is a STOP condition, not an
  invitation to fix types.
- Pre-commit hooks / husky — deliberately not part of this plan.

## Git workflow

- Branch: `advisor/002-ci-typecheck-gate`
- Conventional commit, e.g. `chore: add typecheck script and CI gate`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the script

In `package.json`, add `"typecheck": "tsc --noEmit"` to scripts and change
`check` to `"pnpm lint && pnpm typecheck && pnpm test"`.

**Verify**: `pnpm typecheck` → exit 0, no error output

### Step 2: Add the CI step

In `.github/workflows/test.yml`, insert between the Lint and Test steps
(matching the file's existing two-space indentation):

```yaml
- name: Typecheck
  run: pnpm typecheck
```

**Verify**: a YAML sanity check — `node -e "console.log('ok')"` is not
enough; instead run `npx yaml-lint .github/workflows/test.yml` if available,
otherwise visually confirm indentation matches the sibling steps exactly
(6 spaces before `-`, 8 before `name:`/`run:`).

### Step 3: Full local gate

**Verify**: `pnpm check` → lint passes, typecheck passes, all tests pass,
exit 0.

## Test plan

No new tests — this plan adds verification infrastructure. The verification
is Step 3 itself.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exists and exits 0
- [ ] `pnpm check` runs lint → typecheck → test and exits 0
- [ ] `.github/workflows/test.yml` contains a `Typecheck` step between Lint
      and Test
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `npx tsc --noEmit` reports ANY type error before your change — the
  codebase drifted from the planned-at commit; report the errors instead of
  fixing them.
- The scripts block or workflow file differs from the excerpts above.

## Maintenance notes

- CI wall time increases by roughly the `tsc --noEmit` duration (tens of
  seconds). If that becomes a problem, `tsc --noEmit --incremental` plus a
  CI cache for `tsconfig.tsbuildinfo` is the standard mitigation — not
  needed now.
- Plans 003–009 use `npx tsc --noEmit` in their done criteria; after this
  plan lands they can equivalently use `pnpm typecheck`.
