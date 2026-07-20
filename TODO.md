# TODO

A running list of things to build, ideas, and parked decisions — so they don't get
lost in chat. Not a committed roadmap; a scratchpad. Move items to a "Done" note or
delete them when shipped. Newest thinking near the top.

## Under consideration

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

### Skills that are not on skills.sh at all ("GitHub-only")

Shipped (Jul 2026). `/dev/add-skill` now falls back to the GitHub repo when the
skills.sh detail endpoint 404s: `previewGitHubSkill` resolves the SKILL.md and shows
the admin the file path + parsed name to confirm, then `addSkillFromGitHub` inserts
with `installs: 0` and `isGitHubOnly: true`. Full design in
[docs/skill-lifecycle.md](docs/skill-lifecycle.md) ("GitHub-only skills").

Rather than exempting these rows from the 30-day delist, the content pipeline stamps
`lastSeenInApi` on every successful SKILL.md fetch (the "GitHub heartbeat"), so a row
lives exactly as long as GitHub serves the file and a dead repo still cleans itself up
on the normal track. Reconcile skips them (detail can only 404). Adoption needs no
special-casing beyond clearing the marker: matching is on `(source, skillId)`, so
`syncSkills` takes over installs and snapshots the moment the skill appears upstream.

Known cost, accepted: audits stay `"unknown"` for these rows because the audit
endpoint 404s. Revisit only if GitHub-only skills become common enough that the
missing security signal matters.

Deferred follow-up: nothing surfaces `isGitHubOnly` in the UI. A quiet marker on the
skill page (explaining why installs read 0 and the audit is unknown) would be honest,
but it's only worth building once more than a couple of these exist.

### Sign-in second factor: email code only (future: real MFA)

Shipped (Jul 2026): sign-in handles Clerk's Client Trust email-code step
(new-device verification) instead of silently stalling —
`components/auth/sign-in-form.tsx`. A non-email second factor already fails with
a distinct "this sign-in method isn't supported here" message.

Remaining (future): the branch handles the `email_code` factor ONLY, which is
all this app produces today — there's no MFA-setup UI, so no authenticator / SMS
/ backup factors exist. If real user-configurable MFA is ever added (a Clerk
dashboard setting + a management surface), `submit`'s second-factor branch must
also handle `totp` / `phone_code` / backup codes (verify methods already exist
on `signIn.mfa`).

### Auth OTP: shared code field (shipped)

Shipped (Jul 2026): all four OTP surfaces — `sign-up-form.tsx`,
`sign-in-form.tsx`, `settings/email-section.tsx`,
`settings/reverification-provider.tsx` — share `components/auth/code-field.tsx`
(on the cubby-ui `otp-field` primitive) with auto-submit on complete.
`shared.tsx` owns `navigateAfterAuth` (the open-redirect boundary, previously
copied twice) and `isExpiredCodeError` (expired-code clears now happen in the
verify event path, not a boolean-dep effect). Resend is unified on the
`useResendTimer` hook everywhere (a countdown). The old `input-otp` component +
dependency are removed.

Code-send failures now branch on the returned `{ error }` (the actions API
resolves with it rather than throwing) instead of a `try/catch` that never fired
— so a failed send no longer starts a misleading resend cooldown or claims a
code was sent. `AuthFormError` de-dupes so the hook's `errors.global` and our own
message don't double up.

Deferred (optional, low-value): each form still hand-lists its Activity-reset
fields; a single reducer/reset would make forgetting one impossible. Left as a
state-management refactor of working auth forms for a maintainability-only
payoff — not worth the risk now.

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

### Match repo: deferred features (recents, match counts, GitHub OAuth)

Shipped (Jul 2026): repo mode morphs the composer card in place — the composer
is a single input row + chin (no separate control row anymore; filter toggles
sit inside the input, sort lives in the chin), Analyze inline in the input row
(URL-bar pattern), chin persists with the mode switch in its right corner
("Match repo →" enters, "← Search skills" exits), repo-shaped query
carry-over, Esc-to-exit, and repo-result narrowing (Official toggle +
Best match / Most installed).

Still to build, independent of container:

- **RECENT** list of previously analyzed repos with match counts
  (e.g. `joncoronel/skillbundle · 42 matches`).
- **"Connect GitHub for private repos"** (OAuth).
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
  - The **"install may fail"** (fetch-warning) chip has real protective value — it warns
    before a user copies a broken install command. Lean: keep (restyle is fine).
  - The **"N copies" / shared-content** chip is informational and the easiest to cut from
    dense rows. Lean: remove from rows, keep only on the detail page.

## Parked decisions (context lives elsewhere)

- **Fast-delete for dead-but-installable skills ("Fix 2")** — deferred. Full context in
  `docs/skill-lifecycle.md` ("Dead-but-installable skills & the Fix 2 decision") and the
  `/dev` "Dead but installable" stat card. Only revisit if that count climbs.
