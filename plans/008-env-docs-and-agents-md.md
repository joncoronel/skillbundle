# Plan 008: Add `.env.example`, reconcile README env docs, fix the stale AGENTS.md tagging section

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a0cea73..HEAD -- README.md AGENTS.md`
> If either file changed since this plan was written, compare the
> "Current state" excerpts against the live files before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **SECURITY RULE for this plan**: `.env.example` gets PLACEHOLDER values
> only (e.g. `pk_test_xxx`, `https://your-typesense-host.example`). You must
> NEVER open, read, or copy from `.env.local` or any real env store. If you
> find a real-looking secret anywhere, stop and report its location and
> type — never its value.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `a0cea73`, 2026-07-18

## Why this matters

Two documentation defects with concrete cost. (1) There is no `.env.example`
and the README's env list predates the Typesense search overhaul — a fresh
clone that follows the README gets an app whose search is broken (the
browser Typesense client requires `NEXT_PUBLIC_TYPESENSE_*` vars) with no
template to copy. (2) `AGENTS.md` — the primary steering file for AI coding
agents (`CLAUDE.md` just imports it) — has a "Technology tagging" section
describing a `tagSkill()` function in `convex/skills.ts` and a
`lib/technologies.ts` file, **neither of which exists**. Agents told to
touch tagging will hunt for phantom symbols.

## Current state

- Env vars actually read by the code (from a repo-wide
  `process.env.*` sweep at commit `a0cea73`):
  - **Frontend (`.env.local` / Vercel):** `NEXT_PUBLIC_CONVEX_URL`
    (auto-written by `npx convex dev`), `NEXT_PUBLIC_SITE_URL`,
    `NEXT_PUBLIC_TYPESENSE_HOST`, `NEXT_PUBLIC_TYPESENSE_SEARCH_KEY`,
    `NEXT_PUBLIC_TYPESENSE_COLLECTION`, `NEXT_PUBLIC_OPENPANEL_CLIENT_ID`,
    `NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID`,
    `NEXT_PUBLIC_POLAR_PRO_YEARLY_PRODUCT_ID`, plus the Clerk pair the
    README already lists (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
    `CLERK_SECRET_KEY`) and the Clerk sign-in/up URLs. `OPENPANEL_CLIENT_SECRET`
    is read server-side in `lib/openpanel.ts` (currently unused export —
    still list it, marked optional).
  - **Convex deployment (`npx convex env set`):** `CLERK_JWT_ISSUER_DOMAIN`,
    `CLERK_WEBHOOK_SECRET`, `POLAR_ORGANIZATION_TOKEN`,
    `POLAR_WEBHOOK_SECRET`, `POLAR_SERVER`, `POLAR_PRO_MONTHLY_PRODUCT_ID`,
    `POLAR_PRO_YEARLY_PRODUCT_ID`, `SKILLS_SH_API_KEY`, `VOYAGE_API_KEY`,
    `GITHUB_TOKEN` (optional), `ADMIN_EMAILS`, `CRONS_ENABLED`,
    `TYPESENSE_HOST`, `TYPESENSE_ADMIN_API_KEY`, `TYPESENSE_COLLECTION`
    (required outside prod — see `docs/search-overhaul.md` Status section),
    `REVALIDATE_SECRET`, `SITE_REVALIDATE_URL`.
  - **Vercel-provided (do not put in the example):** `VERCEL_PROJECT_PRODUCTION_URL`, `NODE_ENV`.

- `README.md` "Environment Variables" section (lines ~41-58) currently
  lists only: Clerk keys + sign-in/up URLs, `NEXT_PUBLIC_SITE_URL`, the two
  `NEXT_PUBLIC_POLAR_*` ids, the auto-written `NEXT_PUBLIC_CONVEX_URL`
  note; Convex-side: Clerk pair, Polar trio + product ids,
  `SKILLS_SH_API_KEY`, `VOYAGE_API_KEY`, `GITHUB_TOKEN`, `ADMIN_EMAILS`,
  `CRONS_ENABLED` (with a good explanatory note — keep it). Missing: all
  Typesense vars (both sides), OpenPanel, `REVALIDATE_SECRET` /
  `SITE_REVALIDATE_URL`.

- `AGENTS.md` "Technology tagging" section (near the end of the file,
  before "## Conventions"):

```md
### Technology tagging

Two-tier: `convex/skills.ts` `tagSkill()` auto-tags during sync;
`lib/technologies.ts` defines the frontend display technologies with IDs and names.
```

  Verified at plan time: `grep -rn "tagSkill" convex lib` → no matches;
  `lib/technologies.ts` does not exist. The only tech-related surface is an
  optional `technologies?: string[]` prop on `components/skill-card.tsx:91`.

- `.gitignore` contains `.env*` — `.env.example` must therefore be
  force-added OR the ignore pattern adjusted. Prefer adding a negation line
  `!.env.example` to `.gitignore` (self-documenting; a bare `git add -f`
  leaves future clones unable to see why the file tracks).

## Commands you will need

| Purpose   | Command            | Expected on success |
|-----------|--------------------|---------------------|
| Lint      | `pnpm lint`        | exit 0              |
| Tracked?  | `git check-ignore .env.example` | exit 1 (NOT ignored) after the .gitignore edit |

## Scope

**In scope** (the only files you should modify/create):
- `.env.example` (create)
- `.gitignore` (one negation line)
- `README.md` (Environment Variables section only)
- `AGENTS.md` (Technology tagging section only)

**Out of scope** (do NOT touch):
- `.env.local` or any real environment store — never open it (see the
  security rule above).
- `docs/architecture.md`, `docs/search-overhaul.md` — reference them, don't
  edit them.
- Any source code.

## Git workflow

- Branch: `advisor/008-env-docs-and-agents-md`
- Conventional commit, e.g. `docs: add .env.example and fix stale env/tagging docs`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create `.env.example`

Frontend vars only (this file feeds `.env.local`; Convex-side vars are set
via `npx convex env set` and belong in the README list, not here). Every
value a placeholder. Include short comments grouping Clerk / Convex / Site /
Polar / Typesense / OpenPanel, and note which are optional. Example shape
(adjust wording freely, values must stay placeholders):

```bash
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx
CLERK_SECRET_KEY=sk_test_xxx
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

# Convex — written automatically by `npx convex dev`; no need to set by hand
# NEXT_PUBLIC_CONVEX_URL=

# Site
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Polar checkout product ids
NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID=00000000-0000-0000-0000-000000000000
NEXT_PUBLIC_POLAR_PRO_YEARLY_PRODUCT_ID=00000000-0000-0000-0000-000000000000

# Typesense (search is browser-direct; REQUIRED or search throws)
NEXT_PUBLIC_TYPESENSE_HOST=your-typesense-host.example.com
NEXT_PUBLIC_TYPESENSE_SEARCH_KEY=search-only-key-xxx
NEXT_PUBLIC_TYPESENSE_COLLECTION=skills_dev

# OpenPanel analytics (optional)
NEXT_PUBLIC_OPENPANEL_CLIENT_ID=
OPENPANEL_CLIENT_SECRET=
```

**Verify**: `grep -cE "=(pk_test_xxx|sk_test_xxx|/sign-|http|0000|your-|search-only|skills_dev|)$" .env.example`
→ every non-comment line matches a placeholder shape (manually confirm no
real-looking key material).

### Step 2: Un-ignore the example

Add to `.gitignore`, directly under the `.env*` line:

```
!.env.example
```

**Verify**: `git check-ignore .env.example` → exit code 1 (not ignored);
`git status` shows `.env.example` as untracked/added.

### Step 3: Reconcile the README

In `README.md`'s Environment Variables section: add the three
`NEXT_PUBLIC_TYPESENSE_*` vars and the OpenPanel pair to the Frontend list
(with one sentence: search is browser-direct to Typesense, these are
required for search to work; point at `.env.example`); add
`TYPESENSE_HOST`, `TYPESENSE_ADMIN_API_KEY`, `TYPESENSE_COLLECTION`
(required outside prod), `REVALIDATE_SECRET`, `SITE_REVALIDATE_URL` to the
Convex list. Keep the existing `CRONS_ENABLED` explanation verbatim.

**Verify**: every var name in the "Current state" inventory above appears in
either `README.md`'s env section or `.env.example` (Vercel-provided ones
excluded): spot-check with
`grep -c "TYPESENSE" README.md` → ≥ 2.

### Step 4: Fix AGENTS.md

Replace the "Technology tagging" section body with an accurate statement.
First re-verify it's still phantom:
`grep -rn "tagSkill" convex lib` → no matches, and confirm
`lib/technologies.ts` doesn't exist. Then replace the two-tier claim with
(adjust wording to match the file's voice):

```md
### Technology tagging

Not implemented. An earlier design (auto-tagging during sync + a frontend
technology registry) was never built; `components/skill-card.tsx` exposes an
optional `technologies` prop that nothing currently populates. If you're
asked to add technology tagging, treat it as new work, not a refactor.
```

**Verify**: `grep -n "tagSkill\|lib/technologies" AGENTS.md` → no matches.

### Step 5: Lint

**Verify**: `pnpm lint` → exit 0 (markdown/env files aren't linted, this
confirms nothing else was touched).

## Test plan

No code tests — verification is the greps in each step.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `.env.example` exists, is not git-ignored, and contains only
      placeholder values
- [ ] `grep -c "TYPESENSE" README.md` ≥ 2
- [ ] `grep -n "tagSkill\|lib/technologies" AGENTS.md` → no matches
- [ ] `pnpm lint` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `grep -rn "tagSkill"` DOES find an implementation — the plan's premise is
  wrong; report where it lives instead of rewriting the section.
- You cannot determine whether a var is frontend or Convex-side for some
  newly-appeared variable — list it in your report rather than guessing.
- Anything resembling a real credential value would need to be written —
  never write it; report the situation.

## Maintenance notes

- When new `process.env.*` reads are added, `.env.example` and the README
  list should be updated in the same PR — reviewers should treat a new env
  read without a docs update as a review flag.
- The `docs/search-overhaul.md` Status section notes the Typesense frontend
  vars are the "remaining merge gate" for prod — this plan documents them;
  it does not set them anywhere.
