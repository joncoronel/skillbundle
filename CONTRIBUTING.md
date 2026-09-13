# Contributing

Thanks for taking an interest in SkillBundle.

## Before you open a pull request

- **Open an issue first** for anything bigger than a small fix, so we can agree on the approach before you spend time on it.
- Bug reports and feature ideas are welcome as issues on their own, no pull request needed.
- For security issues, follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.

## Running it locally

The full app depends on several hosted services, so expect to create a few free accounts:

- **Required:** Convex, Clerk, and Typesense.
- **Only for the features that use them:** Polar (billing), Voyage AI (repo matching), and a skills.sh API key (syncing the catalog).

You need [pnpm](https://pnpm.io). Then:

```bash
pnpm install
cp .env.example .env.local   # fill in the frontend values
npx convex dev               # Convex dev server; set backend values with `npx convex env set`
pnpm dev                     # Next.js, in a second terminal
```

Both dev servers have to be running. Open [http://localhost:3000](http://localhost:3000). Every variable, frontend and Convex, is listed in [docs/environment.md](./docs/environment.md).

Development deployments don't run the scheduled sync. Populate one with `npx convex run skills:syncSkills` once your skills.sh key is set. `pnpm build` also needs a reachable Convex deployment, because prerendering reads from it.

## Checks

Run `pnpm format` before you commit, then `pnpm check`, which runs the format check, lint, typecheck, and unit tests. CI runs lint, typecheck, and unit tests on every pull request. The Playwright e2e suite, which is also the only job that runs a production build, runs only for branches in this repository, because GitHub doesn't give repository secrets to pull requests from forks. If you're working from a fork and your change touches rendering, navigation, or auth, run `pnpm build` and, if you can, `pnpm e2e` before opening the pull request.

## Conventions

[AGENTS.md](./AGENTS.md) documents the architecture and the rules that are easy to break without noticing. Read the parts that touch your change.

By participating, you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
