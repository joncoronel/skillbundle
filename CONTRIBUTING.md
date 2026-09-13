# Contributing

Thanks for taking an interest in SkillBundle.

## Before you open a pull request

- **Open an issue first** for anything bigger than a small fix, so we can agree on the approach before you spend time on it.
- Bug reports and feature ideas are welcome as issues on their own, no pull request needed.
- For security issues, follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.

## Running it locally

Setup is in the [README](./README.md#getting-started). The full app depends on several hosted services, so expect to create a few free accounts:

- **Required:** Convex, Clerk, and Typesense.
- **Only for the features that use them:** Polar (billing), Voyage AI (repo matching), and a skills.sh API key (syncing the catalog).

Development deployments don't run the scheduled sync. Populate one with `npx convex run skills:syncSkills` once your skills.sh key is set.

## Checks

Run `pnpm format` before you commit, then `pnpm check`, which runs the format check, lint, typecheck, and unit tests. CI runs lint, typecheck, and tests on every pull request. If you change rendering, navigation, or auth, also run `pnpm e2e`.

## Conventions

[AGENTS.md](./AGENTS.md) documents the architecture and the rules that are easy to break without noticing. Read the parts that touch your change.

By participating, you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
