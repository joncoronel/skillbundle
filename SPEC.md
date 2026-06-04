# SkillBundle — Product Spec

## Overview

A web app that helps developers discover, compare, and bundle AI coding assistant skills for their tech stack. Users connect a GitHub repo or manually select their technologies, get matched with relevant skills from the skills.sh ecosystem, compare similar options, and save/share curated bundles with install commands.

## Tech Stack

- Next.js (App Router)
- Convex (database, backend functions, cron jobs)
- Better Auth (GitHub OAuth)
- Polar (billing — wired up but free at launch)
- Tailwind CSS

## Core Features

### 1. Skills Data Pipeline

Sync skills from the skills.sh public API into Convex.

**Data source:**
- `https://skills.sh/api/skills/all-time/{page}` — paginated, returns skills with install counts
- `https://skills.sh/api/skills/trending/{page}` — trending skills
- `https://skills.sh/api/skills/hot/{page}` — hot skills
- Paginate until `hasMore` is false

**For each skill:**
- Store: source (GitHub repo), skillId, name, installs, leaderboard type
- Fetch the SKILL.md from GitHub raw content to extract description from YAML frontmatter
- Add technology tags based on skill name and source repo matching

**Fetching SKILL.md files:**

Given a skill with `source` and `skillId`, the SKILL.md is typically at:

```
https://raw.githubusercontent.com/{source}/main/skills/{skillId}/SKILL.md
```

Example: For source `supabase/agent-skills` and skillId `supabase-postgres-best-practices`:
```
https://raw.githubusercontent.com/supabase/agent-skills/main/skills/supabase-postgres-best-practices/SKILL.md
```

Some repos use different structures. Common fallback paths to try:
- `skills/{skillId}/SKILL.md` (most common)
- `{skillId}/SKILL.md` (root level)
- `.claude/skills/{skillId}/SKILL.md`
- `.cursor/skills/{skillId}/SKILL.md`

If a SKILL.md can't be fetched, store the skill without a description.

**Schedule:** Run daily via Convex cron job.

### 2. Stack Selection

Two input methods:

**Manual selection:**
- Multi-select UI with common technologies (Next.js, React, Vue, Svelte, Tailwind, Supabase, Convex, Prisma, etc.)
- As user selects, matching skills populate below

**GitHub repo URL:**
- User pastes a GitHub repo URL
- Fetch package.json via GitHub API
- Extract dependencies
- Auto-match to technologies
- Show matching skills

### 3. Skill Discovery & Display

- Display matching skills grouped by technology
- Each skill card shows: name, source repo, description, install count
- Expandable to show full SKILL.md content
- Checkbox to add skill to bundle
- When multiple skills match the same technology, indicate they're alternatives

### 4. Skill Comparison

- When comparing similar skills, show them side by side
- Render the full SKILL.md content for each
- Let user pick which one to add to their bundle

### 5. Bundles

**Save:**
- Requires authentication (GitHub OAuth)
- User names their bundle
- Saves selected skills to Convex
- Generates a unique shareable slug

**Share:**
- Public URL: `/stack/{slug}`
- Shows all skills in the bundle with descriptions
- No auth required to view

**Install commands:**
- Generate install commands for all skills in the bundle
- Support both `npx skills add` and `npx ctx7 skills install` formats
- Copy all button

### 6. Explore

- Browse public bundles from the community
- Sort by recent or popular

## Data Model

**skills**
- source (string) — GitHub repo path, e.g., "supabase/agent-skills"
- skillId (string) — skill identifier
- name (string)
- description (string) — from SKILL.md frontmatter
- installs (number)
- technologies (array of strings) — for matching
- leaderboard (string) — "all-time" | "trending" | "hot"

**bundles**
- userId (reference to users)
- name (string)
- slug (string) — unique, for shareable URL
- skills (array of {source, skillId})
- isPublic (boolean)
- createdAt (number)

**users**
- Managed by Better Auth with GitHub OAuth

## Pages

- `/` — Home with stack selection and skill discovery
- `/compare` — Side-by-side skill comparison (could also be a modal)
- `/stack/[slug]` — Public bundle view
- `/explore` — Browse community bundles
- `/dashboard` — User's saved bundles (authenticated)

## User Flows

**Discovery flow:**
1. User lands on home page
2. Either selects technologies manually OR pastes GitHub repo URL
3. Matching skills appear grouped by technology
4. User checks skills to add to bundle
5. User compares similar skills if needed
6. User saves bundle (requires auth) or copies install commands directly

**Sharing flow:**
1. User saves a bundle
2. Gets a shareable URL
3. Anyone can view the bundle and copy install commands

## Pricing Tiers

**Free:**
- Manual stack selection only
- 3 saved bundles max
- All bundles are public
- Basic install commands

**Pro ($8-12/month):**
- GitHub repo URL auto-detection
- Unlimited saved bundles
- Private bundles (not visible on explore page)
- Bundle analytics (views, copies)
- Export as shell script or config file

**Team ($15-20/seat/month):**
- Everything in Pro
- Shared team workspace
- Team bundles that sync across members
- Onboarding bundle link for new hires

For MVP launch, keep everything free to get users. Gate features behind Polar once there's traction.

## Out of Scope for MVP

- Skill generation or editing
- Automatic compatibility detection between skills
- GitHub PR integration
- Team workspace features
- Mobile-first design
- Search within skills

## Install Command Formats

**skills.sh CLI:**
```bash
# Single skill
npx skills add owner/repo --skill skill-name

# Multiple skills from same repo
npx skills add owner/repo --skill skill-one --skill skill-two

# All skills from a repo
npx skills add owner/repo --all
```

**Context7 CLI:**
```bash
# Single skill
npx ctx7 skills install /owner/repo skill-name

# Multiple skills
npx ctx7 skills install /owner/repo skill-one skill-two
```

**Updating skills:**
```bash
# Check for updates
npx skills check

# Update all to latest
npx skills update
```

When generating commands for a bundle, group skills by source repo to minimize commands. For skills from different repos, generate separate commands.
