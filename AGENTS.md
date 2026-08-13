# AGENTS.md

This file is the primary guidance for AI coding agents (Claude Code, Codex, etc.)
working in this repository. It is the single source of truth — `CLAUDE.md` just
imports this file.

## Project Overview

SkillBundle is a web app that helps developers discover, compare, and bundle AI coding assistant skills for their tech stack. Users select technologies, get matched with relevant skills from the skills.sh ecosystem, and save/share curated bundles with install commands. See SPEC.md for the full product specification.

## Roadmap & ideas

Things we want to build, ideas, and parked decisions live in [TODO.md](TODO.md).
Check it for planned work and deferred decisions, and add to it rather than letting
ideas get lost in chat.

## Commands

- `pnpm dev` — Start Next.js dev server
- `pnpm build` — Production build
- `pnpm lint` — Run ESLint
- `pnpm test` — Unit tests (vitest, `tests/**/*.test.ts` — Convex backend logic)
- `pnpm e2e` / `pnpm e2e:ui` — Playwright (`e2e/**/*.spec.ts`): instant-navigation
  guards signed out, plus signed-in functional coverage in `e2e/authenticated/`
- `npx convex dev` — Start Convex dev server (runs alongside Next.js dev)
- `npx convex deploy` — Deploy Convex functions to production

Both `pnpm dev` and `npx convex dev` must be running during local development.

**`pnpm build` needs a reachable Convex deployment.** Every `generateStaticParams`
calls `fetchQuery` (via `lib/representative-params.ts`), and prerendering those
paths runs the `'use cache'` loaders. A fresh clone without `.env.local` cannot
build. The hardcoded fallbacks in `representative-params.ts` harden *param
selection*, not the render.

**Two test suites, deliberately non-overlapping.** `pnpm test` is vitest over
`tests/**/*.test.ts`; `pnpm e2e` is Playwright over `e2e/**/*.spec.ts`, against a
production build on port 3100. Don't put one kind of test in the other's
directory — the globs are what keep the runners apart. `pnpm check` is
lint + typecheck + unit tests only; e2e is separate because it builds the app.

## Tech Stack

- **Framework:** Next.js 16 (App Router) with React 19
- **Backend:** Convex (database, serverless functions, cron jobs)
- **Auth:** Clerk (JWT-based, synced to Convex via webhooks)
- **Styling:** Tailwind CSS v4 with OKLch color system
- **Package manager:** pnpm
- **UI components:** Custom library in `components/ui/cubby-ui/` built on Radix UI and Base UI primitives. Component docs available at https://www.cubby-ui.dev/llms.txt
- **Icons:** HugeIcons (primary) and Lucide React
- **Animations:** Motion library (motion)

## Architecture

This is a high-level map. The detailed, authoritative guides are:

- **[docs/architecture.md](docs/architecture.md)** — frontend & platform: Next.js 16 static-first rendering + caching, the route inventory (static / ISR / dynamic), the Suspense-default-state pattern, Clerk auth wiring, the provider tree, data-fetching patterns, nuqs URL state, and Polar billing. **Read this before any frontend / rendering / caching / auth work.**
Two rules from that guide that are easy to break without noticing, because
**direct page loads keep working either way**:

- Catalog pages (`/[org]`, `/[org]/[repo]`, `/site/[source]`) must **not**
  `await params` above their `<Suspense>` boundaries. Doing so empties the
  route's shared App Shell and makes every client navigation into it blocking.
  Keep the page component synchronous and pass the `params` promise down.
- Error handling has three layers (`app/global-error.tsx`,
  `app/(main)/error.tsx`, `components/data-error-boundary.tsx`). Use the
  innermost one that fits rather than adding `try/catch` inside a Server
  Component — that swallows the error and loses `retry()`.
- **Restructuring a page means updating its `loading.tsx` / Suspense fallback in
  the same change.** Nothing catches that drift — the e2e guards assert a shell
  commits instantly, not that it resembles the page — and a stale fallback reads
  to users as the skeleton being replaced by a second, different skeleton rather
  than as a bug. See docs/architecture.md §2.
- **A section that's expensive on the client usually belongs on the server, not
  behind a deferral.** Deferring keeps the cost and adds a loading phase. Only
  genuinely per-interaction work (e.g. the shiki diff in
  `components/skill-history-row.tsx`) should stay lazy.

`e2e/instant-navigation.spec.ts` guards the first one. See docs/architecture.md
§1, §14 and §15.

- **[docs/skill-lifecycle.md](docs/skill-lifecycle.md)** — backend skill pipeline: how skills enter the catalog, the sync / reconcile / curated / duplicate-detection jobs, "seen" + delisting rules, snapshots, and the `needs*` work-set patterns. **Read this before touching the sync or skill-lifecycle code.**

### Frontend → backend

ClerkProvider wraps ConvexProviderWithClerk in the root layout (`app/layout.tsx`). Static-first: route shells prerender (CDN), and per-user/interactive data arrives over the authenticated Convex websocket via `useQuery`/`useMutation` (or `useQuery(convexQuery(...))` through TanStack Query). Auth is Clerk, bridged to Convex by JWT; the `proxy.ts` middleware uses an **inverted private-route list** (`/dashboard`, `/settings`, `/dev`) because the catch-all org routes shadow everything — see docs/architecture.md §3.

### Convex backend (`convex/`) at a glance

Tables (`schema.ts`), grouped by concern:

- **Skills catalog:** `skills` (full ~25 KB rows), `skillSummaries` (slim ~200 B denormalized rows that lists/search/cards read), `skillEmbeddings` (vector search), `skillAudits` + `skillSnapshots` (security verdicts + install-count history), `syncStats`.
- **Sync / dedup support:** `curatedOwnerSummaries`, `githubTreeCache`, `githubRepoResolution`, `repoFingerprintCache`.
- **Version archive:** `skillVersions` (one row per detected SKILL.md change, raw file in `_storage`; `isBaseline` marks a starting point rather than an edit).
- **Users & bundles:** `users`, `bundles`. (`bundleStats` and `bundleStars` were removed — see the note at the end of `schema.ts`.)

Modules, grouped by concern:

- **Skill sync & lifecycle:** `skills.ts` (sync pipeline + catalog queries), `reconcile.ts`, `curated.ts` / `curatedRefresh.ts`, `duplicates.ts`, `audits.ts`, `crons.ts`, plus `lib/*` helpers (`detailRefresh`, `skillHealth`, `source`, `appDay`, `pagination`, `github`, `skillsApi`, `embeddings`). Documented in docs/skill-lifecycle.md.
- **Leaderboards & discovery:** `leaderboards.ts` (trending/hot), `recommendations.ts` (repo-fingerprint matching).
- **Version archive & monitoring:** `skillVersions.ts` (read + write API over the change archive; `freshness.ts` decides which SKILL.mds to re-check).
- **Bundles & social:** `bundles.ts`.
- **Users, auth & billing:** `users.ts`, `http.ts` (Clerk + Polar webhooks, Svix-validated), `auth.config.ts`, `subscriptions.ts` / `plans.ts` / `polar.ts` (+ `convex.config.ts` registers the `@convex-dev/polar` component).
- **Admin / dev:** `devStats.ts` (the `/dev` dashboard stats), `devSeed.ts`,
  `githubOnly.ts` (admin add of skills that exist only on GitHub, not on
  skills.sh — see docs/skill-lifecycle.md "GitHub-only skills"),
  `githubOnlyAudit.ts` (read-only diagnostic: GitHub-only rows whose stored
  slug disagrees with their SKILL.md's frontmatter name), `bindAudit.ts`
  (read-only diagnostic: is the RIGHT SKILL.md bound to each skill — a
  different question from `githubOnlyAudit.ts`), `devSeedFeed.ts` (dev-only
  seeding for the dashboard's change feed).

This list is "at a glance", not exhaustive — but every module and table it
NAMES should exist. It has twice pointed at files that had been deleted.

### Crons (`crons.ts`)

Daily sync chain (`syncSkills` 06:00 UTC → curated 06:30 → snapshot prune 06:45 → `reconcileUnseenSkills` 07:00, with the discovery/content/audit/embedding pipeline chained off the sync), hourly + 30-min leaderboard refreshes (trending / hot), daily cache cleanups, and a weekly Sunday duplicate chain (resolve repo identities 08:00 → curated refresh 09:00 → re-resolve stale identities 10:00). Production-only (gated by `CRONS_ENABLED`).

### Technology tagging

Not implemented. An earlier design (auto-tagging during sync + a frontend
technology registry) was never built; `components/skill-card.tsx` exposes an
optional `technologies` prop that nothing currently populates. If you're
asked to add technology tagging, treat it as new work, not a refactor.

## Conventions

- **Path alias:** `@/*` maps to project root
- **Class names:** Use `cn()` from `lib/utils.ts` (clsx + tailwind-merge)
- **Component variants:** Use `class-variance-authority` (cva)
- **UI components config:** See `components.json` for shadcn/ui style ("new-york"), icon library, and path aliases
- **Convex functions:** Use `v` validator from `convex/values` for all argument/return validation
- **One-shot repairs and backfills** (hand-run once via `npx convex run`, then
  dead) go in their own `convex/<name>Repair.ts`, with a DELETE-ON-COMPLETION
  header naming the commands and the exit condition, and a `TODO.md` entry that
  owns the deletion. Not inline in the module they repair. Reason, from Aug
  2026: a one-shot documented only in its own header was cloned into a
  near-duplicate the next day (`6e12f16` → `dcb61f5`) because nothing outside
  the file recorded that it existed. `skills.ts` still carries several that
  pre-date this rule (`backfillIsDelistedFalse`, `backfillLastSeenInApi`,
  `backfillNeedsRepoResolution`, `backfillArchiveBaselines`) — don't add
  another. Their presence is the argument for the rule, not an exception to it:
  none is called by anything, and what records that each is finished is
  scattered — a schema comment for two (`schema.ts`), a migration note for the
  same two (`docs/skill-lifecycle.md`), a `TODO.md` entry plus `freshness.ts`
  prose for `backfillArchiveBaselines`, and nothing at all outside its own file
  for `backfillNeedsRepoResolution`. No single place says which are retirable,
  which is exactly what the rule above fixes.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
