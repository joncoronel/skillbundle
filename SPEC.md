# SkillBundle — Product Spec

## Overview

SkillBundle is a catalog and discovery app for AI coding-assistant skills. It
syncs the public skills.sh ecosystem into its own database, then lets developers
**browse** (leaderboards, per-owner/per-repo catalog pages, a curated "official"
directory), **discover** (full-text search, or paste a GitHub repo to get skills
matched to that codebase), **compare** similar skills side by side, and **bundle**
the ones they want into a shareable set with a single install command.

It is a mostly-signed-out public directory: browsing, searching, and viewing
shared bundles need no account. Auth is only required to save and manage your own
bundles.

> This is the product spec. For the *how*, the two authoritative engineering
> guides are [docs/architecture.md](docs/architecture.md) (frontend, rendering,
> caching, auth, billing) and [docs/skill-lifecycle.md](docs/skill-lifecycle.md)
> (the sync/reconcile/audit/embedding pipeline). See also [AGENTS.md](AGENTS.md)
> for the repo map and [TODO.md](TODO.md) for parked ideas.

## Tech Stack

- **Framework:** Next.js 16 (App Router, React 19) with Cache Components + Partial Prefetching
- **Backend / DB:** Convex (database, serverless functions, cron jobs, vector search)
- **Auth:** Clerk (JWT, bridged to Convex; users synced via Svix-validated webhooks)
- **Billing:** Polar (Merchant of Record) via `@convex-dev/polar` — gating is behind a master switch, free at launch
- **Data layer:** TanStack Query + `@convex-dev/react-query` over the authed Convex websocket
- **URL state:** nuqs
- **Styling:** Tailwind CSS v4 (OKLch); UI components in `components/ui/cubby-ui/` (Radix + Base UI)
- **Package manager:** pnpm

## Core Features

### 1. Skills data pipeline

Skills are synced daily from the skills.sh public API into Convex and enriched.
Full state machine in [docs/skill-lifecycle.md](docs/skill-lifecycle.md); the
product-relevant summary:

**Entry points** — a skill enters the catalog three ways:

- **All-time leaderboard** (`syncSkills` walks the v1 all-time view; owns lifetime installs + rank)
- **Curated/official set** (`syncCurated` ensures curated skills exist and stamps `curatedOwner`)
- **Manual add** (admin-only `/dev/add-skill`, verified against the detail endpoint)

**Enrichment per skill:**

- **Content** — the SKILL.md is discovered (GitHub Tree walk for arbitrary repos, or the v1 detail endpoint for well-known sources) and downloaded; description comes from its YAML frontmatter. A content-hash skip path avoids re-parsing unchanged files.
- **Install history** — skills.sh only exposes a point-in-time install count, so a daily snapshot per skill (`skillSnapshots`) is what powers "installs over time" charts and 7/30-day momentum.
- **Leaderboard ranks** — all-time install rank, plus Trending (~24h window) and Hot (current-hour volume) ranks, refreshed on their own cadences.
- **Security audits** — third-party audit verdicts (`skillAudits`) per provider, with a denormalized worst-status badge (`pass` / `warn` / `fail` / `unknown`) on cards.
- **Embeddings** — each skill is embedded (512-dim vector in `skillEmbeddings`) to power repo-based recommendations via vector search.
- **Duplicate / rename detection** — GitHub repo-identity resolution flags forks and renamed aliases (`isDuplicate`, `copyCount`) so the catalog can collapse or hide copies.

**Health & delisting** — skills unseen by any sync for 30 days are soft-delisted
(hidden from all listing/search/recommendation queries, row retained for fast
relist). A row that fails content fetch shows an "install may fail" warning.

**Schedule** — a daily Convex cron chain (sync → curated → snapshot prune →
reconcile, with discovery/content/audit/embedding pipelines chained off it), plus
hourly/30-min leaderboard refreshes and a weekly duplicate-resolution chain.
Production-gated by `CRONS_ENABLED`.

### 2. Discovery & browse

The home page (`/`) is the primary surface. It combines browse and search:

**Leaderboards** (browse) — three tabs rendered from server-cached snapshots
(revalidated by the sync crons, no per-request Convex hit):

- **Popular** — ranked by lifetime installs (infinite scroll)
- **Trending** — ranked by ~24h install window
- **Hot** — ranked by current-hour install volume, with momentum chips

**Search** — full-text search over skill names (Convex search index on the slim
`skillSummaries` table), with an "Official only" filter. Typing crossfades the
results pane in place; the hero stays put.

> Search is currently single-field Convex full-text (prefix, no typo tolerance).
> Moving to a faceted engine (filters + sorting + typo tolerance across both
> search and browse) is under consideration — see [TODO.md](TODO.md).

**GitHub repo analysis** — paste a repo URL and get skills matched to that
codebase. The repo is fingerprinted (packages, config files, languages, topics,
README excerpt), embedded, and vector-searched against the skill embeddings;
results are grouped by skill with their variants. Cached per repo. This is a
**Pro-gated** feature (`canAutoDetect`).

**Catalog pages** (deep browse, public, shareable, SEO-oriented):

- `/[org]` — all skills published by one owner
- `/[org]/[repo]` — all skills in one repo
- `/[org]/[repo]/[skillId]` and `/site/[source]/[skillId]` — individual skill detail
- `/official` — the curated/official directory, grouped by owner

### 3. Skill detail page

For a single skill:

- Name, source repo, description, rendered SKILL.md content
- Install count + rank ("#142 · Top 3%") and an installs-over-time chart with 7/30-day momentum
- Security audit panel — per-provider verdicts with risk level and summary
- Install command (copyable)
- Variants — when the same skill exists across forks/aliases, they're surfaced as alternatives
- Add-to-bundle control (persists to a client-side selection)

### 4. Skill comparison

`/compare` — compare skills side by side (columns driven by a `?skills=` nuqs
param, one Convex query per column). Renders each skill's content and stats so a
user can pick which to add to their bundle. Add/remove column is an instant
shallow URL update.

### 5. Bundles

A bundle is a named, shareable set of skills.

**Create / manage** (requires auth):

- Name + optional description; skills stored as `{source, skillId}`
- Unique `urlId` for the public URL
- Public or private; private bundles use a `shareToken` for link-only access
- Owner dashboard at `/dashboard` (optimistic create/delete)

**Share** (`/bundle/[id]`):

- Public URL, no auth to view; private bundles open via `?share=<token>`
- OG tags (name/description/image) so links unfurl in chat apps
- One-tap copy of the combined install command

**Social / stats:**

- **Stars**, **forks** (copy someone's bundle into your own), and **copy count**
- Public bundles can be ranked by star count and surfaced on explore
- Featured bundles (`featuredAt`) for editorial placement

**Install commands** — skills are grouped by source repo to minimize commands
(`npx skills add owner/repo --skill a --skill b`); multiple repos are joined with
`&&`. A per-skill warning flags any skill whose content fetch failed.

### 6. Explore

`/explore` — browse public community bundles, sorted by recent or popularity
(stars/copies). All data client-fetched.

### 7. Accounts & settings

- Clerk-hosted sign-in/up (`/(auth)/...`) with SSO callback routes
- `/settings` — profile (via Clerk) and active-session management (server action)
- User records mirrored into Convex (denormalized name/email/image) via webhook

### 8. Billing

Polar subscriptions via `@convex-dev/polar`. Two-layer enforcement: Convex
mutations check plan limits server-side; the UI disables controls / shows upgrade
prompts. A master `FEATURE_GATING_ENABLED` switch keeps everything free until
turned on. See architecture.md §11.

### 9. Admin / dev

`/dev` (admin-only) — sync/pipeline stats, embedding-coverage monitoring, a
"dead but installable" health card, and `/dev/add-skill` for manual inserts.

## Data Model

Authoritative schema: [`convex/schema.ts`](convex/schema.ts). Key tables:

- **`skills`** — full skill rows (~25 KB): content, install/leaderboard state, pipeline flags (discovery/content/audit/embedding), duplicate + curated markers, denormalized worst-audit status.
- **`skillSummaries`** — slim (~200 B) denormalized rows that all listing / search / card / leaderboard queries read, so hot paths never touch the heavy rows. Holds the full-text search index.
- **`skillEmbeddings`** — 512-dim vectors + vector index for repo recommendations.
- **`skillAudits`** — per-provider security verdicts.
- **`skillSnapshots`** — daily install counts per skill (history + momentum).
- **`curatedOwnerSummaries`** — owner-level rollup for `/official`.
- **`bundles` / `bundleStats` / `bundleStars`** — bundles + denormalized social counts + stars.
- **`users`** — Clerk-synced, keyed by `externalId`.
- **Sync/dedup support** — `syncStats`, `githubTreeCache`, `githubRepoResolution`, `repoFingerprintCache`.

## Pages / routes

Full route inventory with rendering strategy in
[docs/architecture.md §1](docs/architecture.md). At a glance:

| Route | Purpose |
| --- | --- |
| `/` | Home: leaderboards + search + repo analysis |
| `/explore` | Community bundles |
| `/compare` | Side-by-side skill comparison |
| `/official` | Curated/official directory |
| `/[org]`, `/[org]/[repo]`, `/[org]/[repo]/[skillId]`, `/site/[source]/...` | Catalog browse + skill detail |
| `/bundle/[id]` | Public/shared bundle view |
| `/dashboard` | User's saved bundles (auth) |
| `/settings` | Profile + sessions (auth) |
| `/pricing` | Plans |
| `/dev`, `/dev/add-skill` | Admin (auth + admin) |
| `/(auth)/sign-in`, `/sign-up` | Clerk auth |

## Pricing tiers

**Free:**
- Browse all skills, leaderboards, and catalog
- Text search
- Up to 3 saved bundles, public only
- Basic install commands

**Pro ($8/month, $72/year):**
- GitHub repo auto-detection (repo analysis)
- Unlimited saved bundles
- Private bundles
- Bundle analytics (views, copies)

Gating is behind a master switch (`FEATURE_GATING_ENABLED`) — everything is free
until there's traction.

## Install command format

**skills.sh CLI:**
```bash
# One skill
npx skills add owner/repo --skill skill-name

# Multiple skills from the same repo (grouped into one command)
npx skills add owner/repo --skill skill-one --skill skill-two
```

When generating commands for a bundle, group skills by source repo to minimize
commands; join commands for different repos with `&&`.

## Out of scope

- Skill generation or editing
- Automatic compatibility detection between skills
- Team workspaces / shared team bundles
- Native mobile app

## Under consideration

Tracked in [TODO.md](TODO.md). Notably: a faceted search engine
(Typesense / Meilisearch / Algolia) to add typo tolerance, filters, and sorting
across both search and browse — weighed against the added sync-pipeline and
hosting cost on the current Vercel Hobby + Convex Pro setup.
