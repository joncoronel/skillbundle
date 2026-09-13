# SkillBundle

Find the right AI coding skills, and stay on top of the ones you use.

**Live at [skillbundle.dev](https://skillbundle.dev)**

SkillBundle is built on the [skills.sh](https://skills.sh) API. The skill catalog and install counts come from skills.sh, and SkillBundle adds search, comparison, bundles, and update tracking on top.

## Features

**Finding skills**

- Search the catalog and filter by publisher, description, official skills, install count, and skills whose install may fail.
- Browse the Popular, Trending, and Hot leaderboards, and a directory of official skills.
- Paste a GitHub repo to find skills that fit that codebase (Pro).
- Compare skills side by side.
- Add a skill that isn't on skills.sh yet.

**Keeping up with them**

- An update history for each skill, with a diff of what changed.
- Bundles: save skills into a set you can share with a link, with install commands ready to copy.
- A change feed for the skills in your bundles.
- Install counts over time, and security audit results from skills.sh's audit partners.

## Tech Stack

- **Framework:** Next.js 16 (App Router) + React 19
- **Backend:** [Convex](https://convex.dev) (database, serverless functions, cron jobs)
- **Auth:** [Clerk](https://clerk.com) (JWT, synced to Convex via webhooks)
- **Billing:** [Polar](https://polar.sh) (merchant of record)
- **Search:** [Typesense](https://typesense.org)
- **Embeddings:** [Voyage AI](https://voyageai.com), for repo matching
- **UI:** Tailwind CSS v4, components built on [Base UI](https://base-ui.com) and Radix primitives, [TanStack Charts](https://tanstack.com)
- **Package manager:** pnpm
- **Hosting:** Vercel

## Getting Started

SkillBundle is a hosted app. The code is open so you can see how it works, but it isn't packaged for self-hosting: it depends on the skills.sh API and several hosted services (Convex, Clerk, Typesense, Voyage AI, Polar). The setup below is for development and contributing.

You need [pnpm](https://pnpm.io) and a [Convex](https://convex.dev) account.

```bash
pnpm install
```

Run the Next.js dev server and the Convex dev server side by side (both are required):

```bash
pnpm dev        # Next.js
npx convex dev  # Convex (separate terminal)
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Frontend (`.env.local`) — see `.env.example` for a ready-to-copy template:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID`, `NEXT_PUBLIC_POLAR_PRO_YEARLY_PRODUCT_ID`
- `NEXT_PUBLIC_TYPESENSE_HOST`, `NEXT_PUBLIC_TYPESENSE_SEARCH_KEY`, `NEXT_PUBLIC_TYPESENSE_COLLECTION` — search is browser-direct to Typesense, so these are required or search throws.
- `NEXT_PUBLIC_OPENPANEL_CLIENT_ID`, `OPENPANEL_CLIENT_SECRET` (optional, analytics)
- `NEXT_PUBLIC_CONVEX_URL` is written automatically by `npx convex dev`, so you don't need to set it by hand.

Convex (set with `npx convex env set …`):

- `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SECRET`
- `POLAR_ORGANIZATION_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_SERVER`
- `POLAR_PRO_MONTHLY_PRODUCT_ID`, `POLAR_PRO_YEARLY_PRODUCT_ID`
- `SKILLS_SH_API_KEY`, `VOYAGE_API_KEY`
- `GITHUB_TOKEN` (optional), `ADMIN_EMAILS`
- `TYPESENSE_HOST`, `TYPESENSE_ADMIN_API_KEY`, `TYPESENSE_COLLECTION` (required outside production — see `docs/search-overhaul.md`)
- `REVALIDATE_SECRET`, `SITE_REVALIDATE_URL`. **Both this and
  `SKILLS_TOKEN_URL` below must point at the canonical host** (the apex,
  `https://skillbundle.dev/…` — `www` 308s to it). Convex sends their shared
  secrets in a custom header and refuses to follow redirects, since a hop would
  forward the secret to wherever it points, so a non-canonical URL fails every
  call rather than silently working.
- `SKILLS_TOKEN_URL`, `SKILLS_TOKEN_SECRET`: production only. Lets the sync
  authenticate to skills.sh with a Vercel OIDC token (their documented
  credential) instead of the undocumented `SKILLS_SH_API_KEY`, by pulling one
  from `/api/skills-token` on the site. `SKILLS_TOKEN_SECRET` must be
  byte-identical to the value set on Vercel, and ASCII (`openssl rand -hex 32`).
  With these unset, every call falls back to `SKILLS_SH_API_KEY` — keep that set
  either way.
- `CRONS_ENABLED`: set to `true` on production only. Cron jobs (skill sync, leaderboards) are skipped unless this is `true`, so dev deployments don't run the sync. Populate a dev deployment on demand with `npx convex run skills:syncSkills`.

## Scripts

- `pnpm dev`: Next.js dev server
- `pnpm build`: production build (needs a reachable Convex deployment)
- `pnpm check`: format check, lint, typecheck, and unit tests
- `pnpm format`: format with Prettier
- `pnpm test`: Vitest unit tests
- `pnpm e2e`: Playwright tests against a production build
- `npx convex dev` / `npx convex deploy`: Convex dev / deploy

## Contributing

Bug reports and ideas are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request, and the [Code of Conduct](./CODE_OF_CONDUCT.md) before participating. To report a security issue, follow [SECURITY.md](./SECURITY.md) instead of opening an issue.

## Acknowledgements

Skill data, install counts, and audit results come from the [skills.sh](https://skills.sh) API.

## License

[MIT](./LICENSE) © Jonathan Coronel
