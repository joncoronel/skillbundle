# Environment variables

The full reference for every variable the app reads. For getting a dev
environment running, start with [CONTRIBUTING.md](../CONTRIBUTING.md).

## Frontend (`.env.local`)

`.env.example` is a ready-to-copy template.

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID`, `NEXT_PUBLIC_POLAR_PRO_YEARLY_PRODUCT_ID`
- `NEXT_PUBLIC_TYPESENSE_HOST`, `NEXT_PUBLIC_TYPESENSE_SEARCH_KEY`, `NEXT_PUBLIC_TYPESENSE_COLLECTION`: search is browser-direct to Typesense, so these are required or search throws.
- `NEXT_PUBLIC_OPENPANEL_CLIENT_ID`, `OPENPANEL_CLIENT_SECRET` (optional, analytics)
- `NEXT_PUBLIC_CONVEX_URL` is written automatically by `npx convex dev`, so you don't need to set it by hand.

## Convex (`npx convex env set …`)

- `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SECRET`
- `CLERK_SECRET_KEY`: the same value as the frontend one. Convex uses it to
  read a user's GitHub OAuth token from Clerk for the repo picker and private
  repo matching (`convex/lib/clerkGithub.ts`).
- `POLAR_ORGANIZATION_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_SERVER`
- `POLAR_PRO_MONTHLY_PRODUCT_ID`, `POLAR_PRO_YEARLY_PRODUCT_ID`
- `SKILLS_SH_API_KEY`, `VOYAGE_API_KEY`
- `TYPESAFE_API_KEY`: category tagging with TypeSafe's Jev model
  (`convex/tags.ts`). Optional: without it the tagging step logs and skips, and
  flagged skills wait until a key is set.
- `GITHUB_TOKEN` (optional), `ADMIN_EMAILS`
- `TYPESENSE_HOST`, `TYPESENSE_ADMIN_API_KEY`, `TYPESENSE_COLLECTION` (required outside production, see `docs/search-overhaul.md`)
- `REVALIDATE_SECRET`, `SITE_REVALIDATE_URL`. **Both this and
  `SKILLS_TOKEN_URL` below must point at the canonical host** (the apex,
  `https://skillbundle.dev/…`, since `www` 308s to it). Convex sends their shared
  secrets in a custom header and refuses to follow redirects, since a hop would
  forward the secret to wherever it points, so a non-canonical URL fails every
  call rather than silently working.
- `SKILLS_TOKEN_URL`, `SKILLS_TOKEN_SECRET`: production only. Lets the sync
  authenticate to skills.sh with a Vercel OIDC token (their documented
  credential) instead of the undocumented `SKILLS_SH_API_KEY`, by pulling one
  from `/api/skills-token` on the site. `SKILLS_TOKEN_SECRET` must be
  byte-identical to the value set on Vercel, and ASCII (`openssl rand -hex 32`).
  With these unset, every call falls back to `SKILLS_SH_API_KEY`, so keep that
  set either way.
- `CRONS_ENABLED`: set to `true` on production only. Cron jobs (skill sync,
  leaderboards) are skipped unless this is `true`, so dev deployments don't run
  the sync. Populate a dev deployment on demand with
  `npx convex run skills:syncSkills`.
