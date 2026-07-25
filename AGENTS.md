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
- `npx convex dev` — Start Convex dev server (runs alongside Next.js dev)
- `npx convex deploy` — Deploy Convex functions to production

Both `pnpm dev` and `npx convex dev` must be running during local development.

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
- **[docs/skill-lifecycle.md](docs/skill-lifecycle.md)** — backend skill pipeline: how skills enter the catalog, the sync / reconcile / curated / duplicate-detection jobs, "seen" + delisting rules, snapshots, and the `needs*` work-set patterns. **Read this before touching the sync or skill-lifecycle code.**

### Frontend → backend

ClerkProvider wraps ConvexProviderWithClerk in the root layout (`app/layout.tsx`). Static-first: route shells prerender (CDN), and per-user/interactive data arrives over the authenticated Convex websocket via `useQuery`/`useMutation` (or `useQuery(convexQuery(...))` through TanStack Query). Auth is Clerk, bridged to Convex by JWT; the `proxy.ts` middleware uses an **inverted private-route list** (`/dashboard`, `/settings`, `/dev`) because the catch-all org routes shadow everything — see docs/architecture.md §3.

### Convex backend (`convex/`) at a glance

Tables (`schema.ts`), grouped by concern:

- **Skills catalog:** `skills` (full ~25 KB rows), `skillSummaries` (slim ~200 B denormalized rows that lists/search/cards read), `skillEmbeddings` (vector search), `skillAudits` + `skillSnapshots` (security verdicts + install-count history), `syncStats`.
- **Sync / dedup support:** `curatedOwnerSummaries`, `githubTreeCache`, `githubRepoResolution`, `repoFingerprintCache`.
- **Users & bundles:** `users`, `bundles`, `bundleStats`, `bundleStars`.

Modules, grouped by concern:

- **Skill sync & lifecycle:** `skills.ts` (sync pipeline + catalog queries), `reconcile.ts`, `curated.ts` / `curatedRefresh.ts`, `duplicates.ts`, `audits.ts`, `crons.ts`, plus `lib/*` helpers (`detailRefresh`, `skillHealth`, `source`, `appDay`, `pagination`, `github`, `skillsApi`, `embeddings`). Documented in docs/skill-lifecycle.md.
- **Leaderboards & discovery:** `leaderboards.ts` (trending/hot), `recommendations.ts` (repo-fingerprint matching).
- **Bundles & social:** `bundles.ts`, `bundleStars.ts`, `bundleEvents.ts`.
- **Users, auth & billing:** `users.ts`, `http.ts` (Clerk + Polar webhooks, Svix-validated), `auth.config.ts`, `subscriptions.ts` / `plans.ts` / `polar.ts` (+ `convex.config.ts` registers the `@convex-dev/polar` component).
- **Admin / dev:** `devStats.ts` (the `/dev` dashboard stats), `devSeed.ts`,
  `githubOnly.ts` (admin add of skills that exist only on GitHub, not on
  skills.sh — see docs/skill-lifecycle.md "GitHub-only skills"),
  `githubOnlyAudit.ts` (read-only diagnostic: GitHub-only rows whose stored
  slug disagrees with their SKILL.md's frontmatter name).

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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->
