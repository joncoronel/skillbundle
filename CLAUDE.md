# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SkillBundle is a web app that helps developers discover, compare, and bundle AI coding assistant skills for their tech stack. Users select technologies, get matched with relevant skills from the skills.sh ecosystem, and save/share curated bundles with install commands. See SPEC.md for the full product specification.

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

### Frontend → Backend Connection

ClerkProvider wraps ConvexProviderWithClerk in the root layout (`app/layout.tsx`). Components use Convex's `useQuery`/`useMutation` hooks with the generated `api` object for real-time data.

### Convex Backend (`convex/`)

- **schema.ts** — Three tables: `users`, `skills`, `bundles`
- **skills.ts** — Skill sync pipeline (fetches from skills.sh API), technology auto-tagging via `tagSkill()`, and query functions (`listByTechnologies`, `list`, `getBySourceAndSkillId`)
- **users.ts** — User CRUD synced from Clerk. Helpers: `getCurrentUser()`, `getCurrentUserOrThrow()`
- **crons.ts** — Daily skill sync at 06:00 UTC
- **http.ts** — Clerk webhook handler (user create/update/delete) validated with Svix
- **auth.config.ts** — Clerk JWT issuer configuration

### Auth Flow

Clerk handles authentication. The middleware (`proxy.ts`) protects non-public routes. Public routes: `/`, `/sign-in`, `/sign-up`, `/bundle/*`, `/explore`. Clerk webhooks sync user data to the Convex `users` table.

### Technology Tagging

Two-tier system: `convex/skills.ts` has `tagSkill()` for backend auto-tagging during sync, and `lib/technologies.ts` defines the 25 frontend display technologies with IDs and names.

### Key Data Flow

1. Skills sync: Cron → `syncSkills` action → skills.sh API → batch upsert with auto-tagging
2. Discovery: User selects technologies → `useQuery(api.skills.listByTechnologies)` → filtered/sorted results
3. User sync: Clerk event → HTTP webhook → Svix validation → Convex user upsert/delete

## Conventions

- **Path alias:** `@/*` maps to project root
- **Class names:** Use `cn()` from `lib/utils.ts` (clsx + tailwind-merge)
- **Component variants:** Use `class-variance-authority` (cva)
- **UI components config:** See `components.json` for shadcn/ui style ("new-york"), icon library, and path aliases
- **Convex functions:** Use `v` validator from `convex/values` for all argument/return validation

<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

<!-- END:nextjs-agent-rules -->
