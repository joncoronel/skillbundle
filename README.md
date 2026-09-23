# SkillBundle

Find the right AI coding skills, and stay on top of the ones you use.

**Live at [skillbundle.dev](https://skillbundle.dev)**

SkillBundle is built on the [skills.sh](https://www.skills.sh/docs/api) API. The skill catalog and install counts come from skills.sh, and SkillBundle adds search, comparison, bundles, and update tracking on top.

<img width="1920" height="1440" alt="796_1x_shots_so" src="https://github.com/user-attachments/assets/5c9c8044-35e8-4751-b706-3a8ffed69e66" />

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

## About the code

SkillBundle is a hosted app. The code is open so you can see how it works and suggest changes, but it isn't packaged for self-hosting: it depends on the skills.sh API and several hosted services (Convex, Clerk, Typesense, Voyage AI, Polar).

Built with Next.js 16, [Convex](https://convex.dev), [Clerk](https://clerk.com), [Typesense](https://typesense.org), [Voyage AI](https://voyageai.com), and [Polar](https://polar.sh), hosted on Vercel. [docs/architecture.md](./docs/architecture.md) is the map of how it fits together.

## Contributing

Bug reports and ideas are welcome. [CONTRIBUTING.md](./CONTRIBUTING.md) covers running it locally and opening a pull request, and the [Code of Conduct](./CODE_OF_CONDUCT.md) applies to everyone taking part. To report a security issue, follow [SECURITY.md](./SECURITY.md) instead of opening an issue.

## Support

If SkillBundle is useful to you, you can support it through [GitHub Sponsors](https://github.com/sponsors/joncoronel).

## Acknowledgements

Skill data, install counts, and audit results come from the [skills.sh](https://skills.sh) API.

## License

[MIT](./LICENSE) © Jonathan Coronel
