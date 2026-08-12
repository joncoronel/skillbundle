# SkillBundle

SkillBundle helps developers discover, compare, and bundle AI coding-assistant skills for their tech stack. Pick your technologies, get matched with relevant skills from the [skills.sh](https://skills.sh) ecosystem, then save and share curated bundles with ready-to-run install commands.

**🔗 Live at [skillbundle.dev](https://skillbundle.dev)**

## Features

- **Discovery:** browse skills by technology, popularity, trending, and "hot" leaderboards.
- **Bundles:** curate skills into reusable bundles and share them with a link.
- **Install commands:** copy a single command to install a whole bundle.
- **Auth & billing:** account sync via Clerk, optional Pro plan via Polar.

## Tech Stack

- **Framework:** Next.js (App Router) + React
- **Backend:** [Convex](https://convex.dev) (database, serverless functions, cron jobs)
- **Auth:** [Clerk](https://clerk.com) (JWT, synced to Convex via webhooks)
- **Billing:** [Polar](https://polar.sh) (merchant of record)
- **Styling:** Tailwind CSS v4
- **Package manager:** pnpm
- **Hosting:** Vercel

## Getting Started

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
- `REVALIDATE_SECRET`, `SITE_REVALIDATE_URL`
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
- `pnpm build`: production build
- `pnpm lint`: ESLint
- `pnpm test`: Vitest
- `npx convex dev` / `npx convex deploy`: Convex dev / deploy

## Contributing

Contributions are welcome. Please read the [Code of Conduct](./CODE_OF_CONDUCT.md) before participating.

## License

[MIT](./LICENSE) © Jonathan Coronel
