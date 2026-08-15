# Plan 009: Remove dead `fuse.js` and align `eslint-config-next` with the Next.js version

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a0cea73..HEAD -- package.json pnpm-lock.yaml`
> If `package.json` changed since this plan was written, re-run the Step 1
> dead-dependency check before proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 002 (uses `pnpm typecheck` if landed; otherwise use `npx tsc --noEmit`)
- **Category**: migration
- **Planned at**: commit `a0cea73`, 2026-07-18

## Why this matters

`fuse.js` is a leftover from the pre-Typesense client-search approach: it is
declared in `package.json` but has **zero imports** anywhere in the source
tree (verified at plan time — search is now browser-direct Typesense via
`lib/search/typesense.ts`). It costs install weight, audit surface, and —
worse — signals to contributors/agents that fuzzy client search still
exists. Separately, `eslint-config-next` is pinned at `16.2.7` while `next`
is `16.3.0-preview.5`: lint rules from a different minor line than the
framework they lint. Aligning them keeps lint aware of current-version
behavior.

## Current state

- `package.json:47` — `"fuse.js": "^7.1.0"` (dependencies).
- `package.json:53` — `"next": "16.3.0-preview.5"`. The preview pin itself
  is a **deliberate, documented choice** (Cache Components migration —
  `docs/architecture.md` history note; AGENTS.md warns about it). Do NOT
  change `next`'s version in this plan.
- `package.json:77` — `"eslint-config-next": "16.2.7"` (devDependencies).
- Verified at plan time: `grep -rn "from ['\"]fuse" --include="*.ts" --include="*.tsx" app components lib hooks`
  → no matches (only the English words "fuses"/"refuses" appear in comments).
- Verification commands: `pnpm lint`, `pnpm test`, `npx tsc --noEmit` all
  pass at commit `a0cea73`.

## Commands you will need

| Purpose   | Command            | Expected on success |
| --------- | ------------------ | ------------------- |
| Install   | `pnpm install`     | exit 0              |
| Typecheck | `npx tsc --noEmit` | exit 0              |
| Tests     | `pnpm test`        | all pass            |
| Lint      | `pnpm lint`        | exit 0              |

## Scope

**In scope** (the only files you should modify):

- `package.json`
- `pnpm-lock.yaml` (via pnpm commands only — never hand-edit)

**Out of scope** (do NOT touch):

- The `next` version itself — preview pin is deliberate.
- Any other dependency (visx alpha pins, `convex-test` 0.0.x are known,
  accepted risks — see the plans index).
- Source files.

## Git workflow

- Branch: `advisor/009-deps-cleanup`
- Conventional commit, e.g. `chore: drop dead fuse.js, align eslint-config-next`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Re-confirm fuse.js is dead

Run:
`grep -rn "fuse" --include="*.ts" --include="*.tsx" app components lib hooks convex proxy.ts next.config.ts`
and confirm no _import_ of the package exists (English words in comments
are fine). Also check for dynamic imports:
`grep -rn "import(\"fuse" --include="*.ts" --include="*.tsx" app components lib hooks`

**Verify**: no import matches. If any exist → STOP.

### Step 2: Remove it

`pnpm remove fuse.js`

**Verify**: `grep -c "fuse.js" package.json` → 0; `pnpm install` exits 0.

### Step 3: Align eslint-config-next

Check whether a matching version exists:
`pnpm view eslint-config-next versions --json | grep "16.3.0-preview.5"`

- If it exists: `pnpm add -D eslint-config-next@16.3.0-preview.5`
- If it does NOT exist: try the closest published 16.3.x
  (`pnpm view eslint-config-next dist-tags`); if nothing on the 16.3 line is
  published, leave `eslint-config-next` at `16.2.7` and record that outcome
  in your final report and in the plans index row — that is a valid
  completion of this step, not a failure.

**Verify**: `pnpm lint` → exit 0 with the resulting version. If the new
version introduces lint ERRORS (not warnings), see STOP conditions.

### Step 4: Full gate

**Verify**: `npx tsc --noEmit` exit 0; `pnpm test` all pass; `pnpm lint`
exit 0.

## Test plan

No new tests — removal/alignment is verified by the full existing gate
(Step 4).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c "fuse" package.json` → 0
- [ ] `eslint-config-next` version matches `next`'s line, OR the report +
      index row records that no matching version is published
- [ ] `pnpm install`, `pnpm lint`, `npx tsc --noEmit`, `pnpm test` all exit 0
- [ ] Only `package.json` and `pnpm-lock.yaml` modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 finds a real `fuse` import.
- The aligned `eslint-config-next` produces new lint **errors** — do not
  fix source files (out of scope) and do not add eslint-disable comments;
  revert to `16.2.7` and report the rule names so the operator can decide.
- `pnpm remove`/`pnpm add` rewrites unrelated lockfile sections so broadly
  that unrelated package versions change (inspect `git diff pnpm-lock.yaml`
  summary) — report before committing.

## Maintenance notes

- When `next` moves off the preview to 16.3 GA, bump `eslint-config-next`
  in the same PR — same-line versions should move in lockstep from now on.
- Known accepted dependency risks deliberately NOT addressed here (recorded
  so nobody re-audits them): eight `@visx/*` packages exact-pinned to
  `4.0.1-alpha.0` (charts), `convex-test@0.0.51` (sole backend test
  harness), and the remaining transitive `pnpm audit` advisories whose
  vulnerable paths are unreachable (mermaid/dompurify via streamdown — the
  markdown renderer overrides `code`/`pre` so mermaid never mounts;
  `@clerk/clerk-react@5.60` as an unused peer of `convex`;
  `@conform-to/dom` used only by a vendored cubby-ui component).
