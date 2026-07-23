# TODO

A running list of things to build, ideas, and parked decisions — so they don't get
lost in chat. Not a committed roadmap; a scratchpad. Move items to a "Done" note or
delete them when shipped. Newest thinking near the top.

## Under consideration

### Public add-skill: moderation / report queue

The public add flow (`/add`, search empty-state) lets any signed-in user add a
GitHub-only skill. Abuse is bounded by hard validation (must be a real repo with
a resolvable SKILL.md), the free-tier cap (`maxGitHubOnlyAdds`), leaderboard
exclusion, and `addedBy` attribution for targeted removal. Not yet built: a
report affordance on skill pages + an admin moderation view keyed on `addedBy`
(e.g. list a user's adds, bulk-remove). Build when the first abuse actually shows
up — attribution is already in place to support it.

### Add-skill: repo-root URL should offer a skill picker

`/dev/add-skill` accepts GitHub deep links (tree/blob/raw, slug derived from
the URL tail — `lib/parse-skill-input.ts`), but a bare repo URL
(`github.com/owner/repo`) has no slug to derive and errors with guidance.
The nicer flow: recognize the repo-root case, list every SKILL.md the repo
contains (the `githubOnly.ts` resolver already walks the tree and collects
candidates), and let the admin pick one. Real feature, not a parse fix —
needs a picker UI state in the form and a "list skills in repo" action.
Admin-only surface, so build it when the guidance error actually annoys.

### Tighten SKILL.md slug matching to whole-word prefixes

`convex/lib/skillMatch.ts` (`matchesSkillId`) is now the single home of the
frontmatter-name-to-slug rule used by both discovery (`skills.ts`) and the
GitHub-only resolver (`githubOnly.ts`). The rule is deliberately loose: bare
`kebab.startsWith(skillId)` has no word boundary, so slug `test` matches a file
named "Testing Library Helper" (`testing-library-helper`). The tightening is
`kebab === skillId || kebab.startsWith(skillId + "-")` — whole-word prefix only.

Deferred from the GitHub-only PR (Jul 2026) because it changes matching
behavior for the entire existing catalog's discovery pipeline, not just the new
feature — it needs its own change with a look at whether any currently-matched
skill would unbind. When done, it's a one-line edit in `matchesSkillId`; never
tighten one caller without the others (that's the drift the shared matcher
exists to prevent).

### Per-skill cache invalidation (the "skill-sync" tag is all-or-nothing)

`loadSkill` / `loadInsights` / `loadCopies` in `components/skill-detail-page.tsx`
all tag their cache entries with one fixed string, `SKILL_SYNC_TAG = "skill-sync"`.
Each skill gets its own cache entry (keyed by `source` + `skillId`), but every entry
carries the *same* tag, so `revalidateHomeTag("skill-sync")` invalidates the entire
catalog at once. There is no way to refresh a single skill.

Fine today: invalidation only *marks* entries stale, so a page rebuilds only when
someone actually visits it. Cost is bounded by traffic, not by the ~9.5k catalog.
The tag is also only pinged a few times a day (syncSkills 06:00, reconcile 07:00,
and now the content-chain terminal, see below).

Idea: make the tag dynamic, `cacheTag("skill:" + source + "/" + skillId)`, and have
the content-fetch step ping only the skills it actually touched. This is also the
prerequisite for making the terminal ping fire "only when content changed" in any
meaningful way, since a targeted check buys nothing while the tag nukes everything.

Why deferred: the staggered per-skill `fetchSkillContent` calls are independent
scheduled actions with no shared state, so there is nowhere to collect "which skills
changed this run" without adding a counter table or similar; `/api/revalidate` would
also need to accept a batch of tags. Not worth it until cache churn shows up as real
Vercel function load (relevant on Hobby, so worth watching rather than ignoring).

Context: this came out of fixing the content-publish ordering (Jul 2026). The content
pipeline previously never pinged the tag itself; publishing relied on `reconcile`'s
07:00 ping, which is gated on `refreshed > 0` and fires at a fixed hour rather than
when content is ready. `backfillFetchContent` and `fetchSkillDetailBatch` now ping
`internal.skills.revalidateSkillSyncTag` at their terminals.

### Sign-in second factor: real MFA (future)

Today `submit`'s second-factor branch handles Clerk's `email_code` factor ONLY,
which is all this app produces (new-device Client Trust verification). There's no
MFA-setup UI, so no authenticator / SMS / backup factors exist. If real
user-configurable MFA is ever added (a Clerk dashboard setting + a management
surface), the branch in `components/auth/sign-in-form.tsx` must also handle
`totp` / `phone_code` / backup codes (verify methods already exist on
`signIn.mfa`).

### Auth OTP: shared-code-field reset refactor (deferred, low-value)

The four OTP surfaces share `components/auth/code-field.tsx`, but each form still
hand-lists its Activity-reset fields; a single reducer/reset would make forgetting
one impossible. Left as a state-management refactor of working auth forms for a
maintainability-only payoff — not worth the risk now.

### Match repo: GitHub App migration (read-only, per-repo consent)

The GitHub connect flow (Jul 2026) uses a GitHub **OAuth App** via Clerk's
social connection, which forces the classic `repo` scope for private access —
GitHub's consent screen honestly calls it "full control of private
repositories" (read+write; no read-only OAuth scope exists). The better
mechanism is a GitHub **App**: fine-grained read-only "Contents" permission,
and users pick which repos to grant during installation. Costs that keep it
parked: a separate install-then-authorize flow, expiring user-to-server
tokens, repo listing via the installations API instead of `/user/repos`, and
it doesn't drop into Clerk's social-connection plumbing that sign-in,
settings, and the picker all ride on. Revisit only if users measurably balk
at the consent screen (drop-off between clicking Connect and completing
authorization).

### Match repo: free-run quota (phase 2 of the paywall)

Shipped (Jul 2026, phase 1): repo match is Pro-gated, but the demo repo
(`shadcn-ui/ui`) runs free for everyone — signed out included — so people can
taste it before paying. Gate is server-enforced in `convex/recommendations.ts`
via the `matchesDemoRepo` allowlist in `lib/repo-match.ts`; free/logged-out
users who analyze their own repo get an inline, sign-in-aware paywall.

Deferred (phase 2): give **signed-in free users a small quota of real runs**
on their own repos (lean: ~3 lifetime, sign-in required) so the taste is
personal, not just the canned demo. Then upgrade-gate beyond that.

Why deferred, not built now: it's the expensive part (needs a per-user
usage-tracking table + reset logic, and every fresh repo costs a GitHub tree
fetch + Voyage embedding), and it only pays off if the free demo *isn't*
converting. Ship phase 1, watch whether demo → sign-up / upgrade happens, and
only build the quota if the canned demo under-converts. Enforce the quota
inside `isRepoMatchAllowed()` in `lib/repo-match.ts` — the one predicate both
the server gate and the client mirror already call, so the policy changes in
exactly one place; the client can show remaining count but never gates. Don't extend quota to logged-out users (no
reliable identity to meter → abuse surface); sign-in is the natural wall.

### Match repo: deferred features (recents, match counts)

Shipped (Jul 2026): repo mode morphs the composer card in place — the composer
is a single input row + chin (no separate control row anymore; filter toggles
sit inside the input, sort lives in the chin), Analyze inline in the input row
(URL-bar pattern), chin persists with the mode switch in its right corner
("Match repo →" enters, "← Search skills" exits), repo-shaped query
carry-over, Esc-to-exit, and repo-result narrowing (Official toggle +
Best match / Most installed).

Shipped (Jul 2026): **Connect GitHub + repo picker with private-repo
analysis.** Clerk-based (no separate OAuth app): the picker in the repo empty
state (`components/repo-picker.tsx`) connects via
`user.createExternalAccount({ strategy: "oauth_github", additionalScopes: ["repo"] })`
(or `reauthorize` when GitHub was the sign-in provider), `listMyRepos` in
`convex/githubAccount.ts` pulls the token from Clerk's Backend API
(`convex/lib/clerkGithub.ts`, needs `CLERK_SECRET_KEY` in Convex env) and
lists the user's repos, and `analyzeRepo` retries private repos with the user
token under user-scoped (`user_…:owner/repo`) cache keys so private
fingerprints never enter the global cache. Requires custom GitHub OAuth
credentials on the Clerk GitHub connection (extra scopes don't work on
Clerk's shared dev credentials).

Still to build, independent of container:

- **RECENT** list of previously analyzed repos with match counts
  (e.g. `joncoronel/skillbundle · 42 matches`). Its slot is marked in
  `RepoMatchEmptyState` between the picker and the example button.
- Free users see the recents area replaced by the Pro upsell.

Container decision, updated Jul 2026: the original vision (Paper artboard "F")
put these in a **popover on the button** — but that was designed when repo mode
was a clunky separate toolbar worth avoiding. Now that the mode is a pleasant
in-place morph, the current lean is to build them **inside repo mode**: the
repo empty state under the input is the natural home for RECENT + Connect
GitHub (replacing the single example button). The popover only earns its keep
if we ever want repo-as-chip **composing with** search (filters/sort applying
to repo matches at the same time, `⚡ skillbundle ✕` chip) — treat that as a
separate product question, not the default plan.

Why deferred: needs backend that doesn't exist yet — per-user history of
analyzed repos, stored match counts per repo, and GitHub OAuth.

Small parked idea (Jul 2026): analyzeRepo already returns `matchedPackages`
per recommendation group (lexical package overlaps) but nothing renders it —
per-row "matches react" notes were tried and cut as noise. Its natural home
is the skill detail sheet, where a clicked row has room to explain "why this
matched your repo" properly.

### Home-list chips

- **Reconsider the row-level chips** as part of a list redesign.
  - The **fetch-warning** signal (now the unified `SkillStatusBadge` via
    `deriveSkillStatus({ hasContentFetchError })` in `components/skill-card.tsx`) has real
    protective value — it warns before a user copies a broken install command. Lean: keep
    (restyle is fine).
  - The **"N copies"** chip (`CopiesBadge` in `components/skill-card.tsx`) is informational
    and the easiest to cut from dense rows. Lean: remove from rows, keep only on the detail
    page.

## Parked decisions (context lives elsewhere)

- **Fast-delete for dead-but-installable skills ("Fix 2")** — deferred. Full context in
  `docs/skill-lifecycle.md` ("Dead-but-installable skills & the Fix 2 decision") and the
  `/dev` "Dead but installable" stat card. Only revisit if that count climbs.
