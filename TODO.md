# TODO

A running list of things to build, ideas, and parked decisions — so they don't get
lost in chat. Not a committed roadmap; a scratchpad. Move items to a "Done" note or
delete them when shipped. Newest thinking near the top.

## Under consideration

### Monitoring pivot: state, decisions, and what is left (Aug 2026)

Why any of this exists: skills.sh (which is Vercel) launched Packs, which does
bundle-and-install better than we can, and their v1 API already serves
leaderboards, trending/hot, curated, audits, duplicate flags and semantic search
— all of which the catalog was re-rendering. The defensible position left is the
one thing a registry has no incentive to build: telling you when a skill you
depend on **changed, broke, or became unsafe**. Full positioning lives in
PRODUCT.md, which was rewritten for this.

**Decisions already made. Do not relitigate without new information.**

- **No email/push.** The product is pull: you open the app and see what changed.
  This killed the notifier, the alert-severity ladder, and the `skillWatchers`
  inverted index (built, then deleted — it existed only to answer "who do I
  email about this skill", and nothing else needs that direction).
- **"Since you last looked" instead of alerts.** One `bundles.lastViewedAt`
  timestamp. Baseline is `max(lastViewedAt, addedAt)` per skill so a newly added
  skill does not arrive carrying months of unread history.
- **A bundle IS a watchlist.** No separate bookmark primitive. Watching a skill
  means it sits in a bundle; a default bundle covers the one-click case.
- **Skill checkup via lockfile: dropped.** `~/.agents/.skill-lock.json` does
  track source, but it lives on the user's machine and most installs are global
  rather than committed, so a web app cannot read it. Accepted consequence: we
  track "skills you care about", not "skills you have".
- **Set-aware search and semantic dedup: dropped.** Both depended on the above.
- **One-link model.** `isPublic` collapses into a single toggleable share link.
  Built.

**Shipped and committed** (`66fd930`, `4c08500`, `c7a2a00`):

- `skillVersions` archive: raw SKILL.md per change in file storage, metadata
  inline, captured at BOTH content-write paths. Descriptions stored inline in
  full because a description change is the high-severity event (it decides when
  an agent invokes a skill).
- `skillAudits` keeps its previous verdict instead of overwriting it.
- Unread state: `lastViewedAt`, `markBundleViewed`, `listUnreadCounts`,
  `changedSinceViewed` on the bundle read.
- Read API in `convex/skillVersions.ts`: `listForSkill`, `getVersions`,
  `getAuditChange`, `listRecentChangesForUser`.
- Skill-page History UI (`components/skill-history.tsx`) on `@pierre/diffs`.
- Daily per-repo freshness sweep (`convex/freshness.ts`) plus tiered content
  cadences: GitHub 30-day backstop behind the sweep, well-known daily.
- Social teardown: `/explore`, stars, forks, copy counts, featured placement,
  public-bundle search, and the `bundleStats` / `bundleStars` tables are gone.
- Bundle page rebuilt as a register (`components/bundle/bundle-register.tsx`):
  one row per skill, ordered by consequence, with a tally above it and install
  demoted to a disclosure. `markBundleViewed` is wired back on, which the
  register earns by showing each change inline. Steady rows collapse behind
  their own count, so a healthy 40-skill bundle is a short page rather than 40
  em-dashes, and the table carries a `max-h` so its sticky column strip has
  something to stick inside.
- Edit mode is the same register, not a separate card grid. Rows keep their
  consequence ordering and condition text while you stage adds and removes, so
  the skill you came to remove is the first row and still says why. Removing is
  a control on the row; staging, the save bar and the picker are unchanged.
- One-link model: `isPublic` plus a separate `shareToken` URL collapsed to one
  link and one switch. Bundles are created closed and the Pro gate on privacy is
  gone. `listChangesForBundle` and the dashboard feed share one
  `resolveSkillChange` so their ranking cannot drift.
- Dashboard change panel (`app/(main)/dashboard/change-feed.tsx`). The feed
  query now carries audit regressions as first-class rows, ranks by consequence
  ahead of recency, drops baselines (no previous content = no diff to show), and
  trips a mass-change breaker. `markAllBundlesViewed` clears it in bulk and is
  currently the ONLY thing that clears it. `devSeedFeed.ts` populates it
  locally.

**Deployed Aug 8 2026.** The archive and the sweep are both live in production.

**Open item: verify the first clean sweep.** The initial production run hit two
bugs (an infinite chain loop, and over-flagging every first-seen skill), both
fixed in `6b1aea3`. The run that followed was still draining ~7,000 spurious
re-fetches, so the first genuinely clean reading is the 04:00 UTC cron on
Aug 9 or later. Check it with:

    npx convex run freshness:sweepHealth --prod

Healthy: `reposSweptInLast25h` ≈ `reposTracked` (~1,600), `skillsFlagged` in the
low hundreds with `skillsFlaggedCapped: false`, `versionsBaseline` ≈ 0 now that
bootstrapping is done. `skillsFlagged` in the thousands means over-flagging has
returned and the sweep has become a daily full-catalog re-download — that is the
number to look at first.

Why a dedicated check rather than reading a row count: "the counter stopped
going up" is what a stalled chain looks like AND what a finished one looks like.
That ambiguity is exactly how the loop bug survived being watched.

**Remaining work, in order:**

1. **Pricing rewrite.** Two of the four Pro bullets (private bundles, unlimited
   bundles) are now free on skills.sh. Intended shape is in PRODUCT.md: free =
   capped watched skills on a weekly digest, Pro = unlimited + immediate
   security-regression surfacing + full version history.

**Loose ends worth knowing about:**

- `skillVersions.suppressed` is declared and still nothing sets it — the
  mass-change breaker got built at READ time instead (`isCatalogWideChangeEvent`
  in `skillVersions.ts`), because at write time you cannot know you are the 3rd
  of 3,000. A per-row flag would need a second pass over the archive to set, and
  the read-time count is one bounded index scan that only runs when a user
  already has 8+ changed skills. Drop the field on the next schema change unless
  a use appears. (Precedent that mass events happen: ~60% of prod shares one
  `contentUpdatedAt` from the launch backfill.)
- The dashboard feed hides a change whose only archived version is a baseline,
  because a baseline has no previous content and so no diff to link to. That
  silently under-reports while the archive backfills. It self-corrects as
  skills accumulate a second version, so it needs no work — just do not read
  an empty feed as proof that nothing changed until roughly Sep 2026.
- **Dropping a Convex field takes two deploys.** Worth remembering next time:
  the schema is validated against existing documents, so a field cannot leave
  `schema.ts` while any row still carries it. Declare it deprecated-optional,
  ship a migration that strips it, run that everywhere, THEN remove it and
  deploy again. Done for `shareToken` / `featuredAt` in Aug 2026; the migration
  was deleted afterwards because it could not outlive the fields it referenced.
- Virtualising the register was listed here and was never a real problem:
  bundles cap at 100 skills (`MAX_BUNDLE_SKILLS`) and 100 table rows render
  instantly. Removed rather than carried.
- `next.config.ts` carries a Turbopack alias for `@shikijs/themes/horizon-bright`,
  which `@pierre/theming@1.0.1` imports and which exists in no published release
  of that package. Both packages are already at their latest version, so there
  is no upgrade to take. Delete the alias if upstream ever fixes it.
- The diff renderer wraps long lines rather than scrolling them. That is forced,
  not preferred — CodeView's horizontal scroller lives in its shadow root while
  the vertical one has to live outside, and no placement of the height cap
  merges them (measured, including `max-h-96 overflow-auto` directly on
  CodeView). If this ever hosts code-dominant files, add a wrap toggle rather
  than flipping the default.

### skills.sh API auth is moving to Vercel OIDC (build the token relay before the key dies)

Measured Aug 2026. The skills.sh v1 API now rejects unauthenticated requests
and the docs no longer mention API keys at all:

    GET /api/v1/skills            401 authentication_required
    GET /api/v1/skills/search     401
    GET /api/v1/skills/audit/...  200   (enforcement inconsistent, for now)

The 401 body points at a Vercel OIDC token. Our `SKILLS_SH_API_KEY` (`sk_live_`)
still works as of Aug 2026, so nothing is broken yet, but it is now an
undocumented mechanism on a first-party API. Treat its removal as a matter of
when. Emailed skills.sh asking whether keys are being retired; no reply.

**Why this is awkward for us:** the token is minted per-request inside a Vercel
runtime, and our whole sync runs on Convex crons. Convex cannot get one.

**The migration, when needed (token relay):**

1. A secret-gated route handler on our Vercel app returns
   `await getVercelOidcToken()` from `@vercel/oidc`.
2. Convex caches that token and refreshes every ~10h (lifetime is ~12h), or
   lazily on a 401 from skills.sh.
3. `authHeaders()` in `convex/lib/skillsApi.ts` sends the cached token.

This works because skills.sh verifies the token the standard way: JWT signature
against `oidc.vercel.com/[TEAM_SLUG]`'s JWKS, checking issuer / audience /
`owner:...:project:...:environment:...` subject. There is no check that the
request originated from Vercel infrastructure, so a relayed token validates.

Rejected alternative: proxying every skills.sh call through a Vercel route. Our
sync is thousands of staggered per-skill scheduled actions carrying multi-MB
`files[]` payloads, so that converts one cron chain into thousands of Hobby
function invocations. The relay costs 2-3 invocations a day and keeps all sync
bandwidth on Convex.

**Two things to check before building it:**

- Whether OIDC Federation (Settings → OIDC Federation) is available on our
  Vercel plan at all. This decides whether the plan works; unverified.
- It moves a bearer credential carrying our team/project identity off Vercel.
  Scoped to us and attributed to us either way, so not misrepresentation, but
  keep it in Convex env/table, never log it, keep the relay secret-gated.

**Cheapest insurance, do this before migrating:** make `authHeaders()` prefer
the key and fall back to a relayed OIDC token on a 401, so the day the key dies
it is a config flip rather than an outage. Also fix the stale comment at the top
of `convex/lib/skillsApi.ts`, which still documents a 60 req/min unauthenticated
tier that no longer exists; a future reader would plan around it.

Strategic note, not just an ops note: skills.sh is Vercel, and OIDC-only auth
scopes every consumer to a Vercel team and project with `owner_id` /
`project_id` / `environment` logged per request. Our entire catalog is
downstream of an API that a competitor controls, meters, and can identify us on.
That is the backdrop for any decision about what this app should be.

### Embedding-powered catalog features (parked while monitoring is the focus)

Context (Aug 2026): skills.sh launched Packs and their v1 search API now does
semantic search on multi-word queries, so "we have embeddings and they don't" is
false. What is still true is that **their embeddings only answer query → skill.
Nobody uses embeddings for structure**: skill ↔ skill relationships, clustering,
overlap, mapping. Every idea below lives in that gap, and all of them run over
the 512-dim `voyage-code-3` vectors already sitting in `skillEmbeddings`.

The pairwise math is already written and calibrated: `cosineSimilarity`
(`convex/skills.ts:3283`) and the `cosineSimilarityBetween` internalQuery
(`:3301`), with an empirical threshold table at `:3276-3281` — 0.97+ near-verbatim
duplicate, 0.90 same topic, 0.70 same category, <0.5 unrelated. Those thresholds
are the tuning input for everything here.

Deliberately **not** in this list: semantic dedup at catalog scale, and set-aware
search ("find me an X that doesn't overlap what I have"). Both were considered and
cut — dedup wasn't wanted, and set-aware search depends on knowing a user's
installed set, which the dropped lockfile-checkup idea was going to supply.

**1. Similar skills / alternatives on catalog pages.** Every skill detail page
gets a "related" block of its nearest neighbors. Do NOT run an O(N²) sweep over
~9.5k skills; instead query each skill's own vector against the existing
`by_embedding` vector index with a small limit — one cheap call per skill, reusing
machinery that's already tuned. Store the neighbor list on `skillSummaries` so it
renders from the slim row. Smallest item here, and it doubles as the SEO play:
real internal linking across catalog pages, which is the only search angle we have
against skills.sh (they own the canonical page for every skill and will always win
the head terms). Also makes `/compare` self-suggesting instead of requiring the
user to already know what to compare.

**2. Auto-derived topics.** Cluster the catalog's embeddings (k-means or HDBSCAN),
label each cluster from its centroid-nearest member or a cheap LLM pass over the
top ~10 descriptions. Batch job, not per request. Worked example from a real
machine's installed set: `next-cache-components-adoption` +
`next-cache-components-optimizer` + `next-best-practices` cluster into "Next.js
caching"; `impeccable` + `baseline-ui` + `building-components` +
`web-design-guidelines` + `html` + `css-motion-systems` cluster into "frontend
design". Nobody wrote those categories — they fall out of the vectors.

Why it beats skills.sh: their `/topics` is hand-curated (7 buckets: React,
Next.js, Design & UI, Mobile, Databases, Testing, Marketing) and covers what
someone thought to create. Derived topics cover what exists, including emerging
clusters the week they form. This is also the honest way to close the technology-
tagging gap described in AGENTS.md, and it would finally populate the
`technologies` prop on `components/skill-card.tsx` that nothing feeds today.

**3. Ecosystem map.** UMAP/t-SNE the whole catalog from 512 dims to 2, precompute
offline, render as a static explorable scatter where position means similarity.
Dense blobs are saturated categories, empty space is unbuilt territory, and
colouring dots by install count shows where lots of people are building the same
unwanted thing. Nobody has made a picture of this ecosystem. Honest framing: this
is marketing and portfolio value, not product value — nobody pays for a map — but
it is one offline batch job over vectors we already have, and it is the most
shareable artifact on this list.

**4. Author tools.** Different audience: people writing skills, not installing
them. Point it at a SKILL.md and get "this overlaps 0.91 with these six existing
skills," plus whether the description is distinctive enough to trigger reliably
instead of colliding with something already popular. Vercel serves consumers;
nobody serves authors, and authors are small, motivated and vocal. Treat as a
distribution/credibility wedge, not a revenue line.

Sequencing note: #1 is a weekend and improves the catalog whether or not anything
else lands. #2 is the next-cheapest. #3 any time. #4 is independent of all of them.
None of these block or are blocked by the monitoring work.

### Focus rings fail the 3:1 contrast threshold app-wide (design decision)

Measured Jul 2026 while fixing a disabled-button focus ring, then re-measured
against every surface token after a reviewer pointed out the first pass had only
checked one backdrop. `app/globals.css`'s global
`outline-color: color-mix(in oklab, var(--color-ring) 50%, transparent)` against
`--ring: oklch(0.55 0.2 250)`, per surface 1→5:

    alpha 0.50 (today)  light  2.03 2.07 2.10 2.10 2.10
                        dark   1.82 1.78 1.72 1.65 1.57
    alpha 1.00          light  4.35 4.54 4.74 4.74 4.74   all pass
                        dark   3.78 3.52 3.24 2.95 2.67   surfaces 4-5 STILL FAIL

WCAG 2.2 asks 3:1 for non-text indicators, so every focus ring in the app is under
it today. **Dropping the 50% mix is NOT sufficient on its own** — an earlier version
of this entry said it was, having checked only `--surface-1`. Dark needs a lighter
`--ring` as well, because the dark surfaces climb to `oklch(0.321)` while the ring
sits at `0.55`.

Not done here because it changes how focus looks on **every** focusable element in
the app, which is a visual-identity call rather than a side effect of a backend
branch. User's decision (Jul 2026): its own branch, with eyes on it.

Note the disabled+focused case is already handled — `components/ui/cubby-ui/button.tsx`
uses full ring alpha under `data-disabled` to compensate for `opacity-60`, since CSS
opacity dims the outline too.

The measurements behind that, recorded here because the comment carrying them lived
above a cva that a registry refresh replaced, and `button.tsx` is vendored so the next
one would take it again: CSS `opacity` dims the outline too, so a disabled+focused
button rendered its `/50` ring at 0.5 × 0.6 ≈ 0.3 alpha — 1.53:1 on light, 1.35:1 on
dark. Full alpha under the same dimming gives 2.44:1 and 2.16:1, i.e. slightly *more*
visible than an ordinary focus ring, which is the right way round for the one state
where you most need to find focus. `data-disabled:focus-visible:outline-ring` (no
`/50`) is therefore deliberate, not a typo — do not "normalise" it. Residual and not
from this: the ordinary `/50` ring is itself 2.08:1 / 1.83:1, under the 3:1 non-text
threshold, app-wide. That is the part this entry is about.

### Switch: unchecked track is ~1.2:1 in light mode (design decision)

Sibling of the focus-ring entry above, same shape: a measured, accepted 1.4.11
shortfall parked for a design pass rather than fixed in a component branch.

`components/ui/cubby-ui/switch/switch.tsx` sets the light unchecked track to
`--switch-track: oklch(0 0 0 / 8%)`. Over a white surface (light `--surface-3`
through `--surface-8` are all `oklch(1 0 0)`) that composites to roughly
`rgb(235,235,235)` — about **1.2:1** against the surface, and the white thumb
sits at about **1.2:1** against the track. WCAG 2.2 SC 1.4.11 asks 3:1 for the
parts of a control needed to identify its state; both the boundary and the state
indicator are under it. Dark mode is fine (20% white overlay, thumb/track ≈ 8:1),
so this is light-only. Reachable at `save-bundle-dialog.tsx` (Public toggle, on a
Dialog) and `catalog-controls.tsx`'s mobile filter sheet.

**Not a regression** — the predecessor component used `bg-input-elevated`, and
light `--input-elevated` is the identical `oklch(0 0 0 / 8%)`. Inherited, not
introduced. The thumb's drop shadow, which is the only remaining separation cue,
was thinned in a registry refresh and has been restored to
`0 1px 2px 0 oklch(0.18 0 0 / 0.15)`.

The fix is raising light `--switch-track` toward `oklch(0 0 0 / 22%)` (≈3:1
against white), or giving the track a 1px border to carry the boundary. Deferred
because it repaints every switch in the app in light mode — a visual-identity
call, like the focus rings, not a side effect of a component update.

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
skill would unbind. When done, it's a one-line edit in `matchesSkillId`.

Scope note (Jul 2026): this is now **discovery-only**. The GitHub-only add moved
off this function to `matchesSkillIdExactly`, because it invents a permanent slug
rather than finding the file behind one skills.sh already assigned. The old
warning about never tightening one caller without the others no longer applies to
that caller. What still holds is the direction rule: the preview may be stricter
than discovery, never looser.

What that does and does not change about the value here. It no longer guards a
row's **identity**, which is what made this urgent: a bad match can no longer
write a permanent, unrepairable slug. It still guards a row's **content** —
discovery calls `updateSkillMdUrls` on a match (`skills.ts`), so a wrong guess
binds the wrong file and the content pipeline serves that body. Repairable
(tighten, re-run discovery, the row rebinds) but a live, visible bug. So: still
worth doing, no longer urgent-shaped. Don't read the demotion as "harmless".

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

### Match repo: cold-load delay before repo suggestions appear

The issue (noticed Jul 2026, dev + will persist smaller in prod): on a cold
reload of `/?mode=repo` as a connected Pro user, the repo suggestions take
several seconds to exist — clicking the input early opens nothing (the
popup markup isn't rendered until `repos.length > 0`), and the empty state
visibly steps through "(nothing)" → "Loading your repositories…" →
"GitHub connected — N repos". Root cause is a serial startup chain: Clerk
boot → Convex JWT handshake → plan query → only then `listMyRepos`, which
is itself slow (Clerk Backend API for the token + GitHub `/user/repos`,
~1–2s). A reload wipes TanStack Query's in-memory cache, so every cold
load pays the whole chain again.

Patched (Jul 2026, `hooks/use-my-repos.ts`): the query no longer waits for
the plan round trip — it fires as soon as Convex auth is ready + the
connection looks usable client-side, mirroring analyzeRepo's optimistic
`canFetch` ("server is the authoritative gate"); a free user's
`PRO_REQUIRED` rejection is filtered out of `reposError`. This removes one
serialized round trip but NOT the Clerk-boot or action latency.

Better solution to actually build: **persist the repo list across
reloads** — TanStack Query's persister (`@tanstack/query-persist-client` +
localStorage/IDB) scoped to the `["github","myRepos",userId]` key, so a
reload renders last session's list instantly (popup usable immediately)
while the fetch revalidates in the background. Repo lists change rarely;
minutes-stale is fine. Alternatives considered: server-side caching of the
repo list in Convex was rejected in the feature design (no persistence of
GitHub-derived per-user data beyond the analysis caches); shaving the
action itself (parallelize Clerk+GitHub calls) doesn't help because the
token IS the input to the GitHub call.

### Match repo: watch the two-press Esc in repo mode

With repo suggestions (Jul 2026), Esc in repo mode is staged: first press
closes the suggestion popup (Base UI), second press on an empty input exits
to search mode. Implemented via `suggestionsOpenRef` + `onOpenChange` in
`components/skill-composer.tsx` (a `defaultPrevented` check can't observe
Base UI's document-level dismissal). This is the standard combobox-in-
container idiom (VS Code quick-open etc.) — keep unless real usage shows the
two-press flow surprising people. If Esc-to-exit is ever dropped, delete the
whole apparatus with it: the mode-exit branch, the ref, and the
`onOpenChange` prop (Base UI closes its own popup without us).

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

## Local cubby-ui divergences (re-apply after `shadcn add @cubby-ui/all`)

`components/ui/cubby-ui/**` is vendored, so a registry add overwrites local
edits silently. Keep this list to exactly what is still local — everything that
gets upstreamed should be deleted from it, or the list becomes a to-do nobody
trusts.

**Currently one entry.** An earlier round of this list had nine; the other eight
were fixed upstream in cubby-ui and came back in the next `shadcn add`, which is
the outcome to aim for. That round is worth copying: the Switch's `squash`
variant, CopyButton's `display: contents` wrapper and the `sr-only` removal from
Button all landed upstream in better shape than the local patch had them.

- **`button.tsx` — two default values.** `DEFAULT_LOADING_INDICATOR` and
  `DEFAULT_LOADING_LAYOUT`, both at the top of the file, both one line. The
  props they feed (`loadingIndicator`, `loadingLayout`) are implemented here and
  are meant to go upstream verbatim — see the proposal below. Once they land,
  re-applying this after a `shadcn add` is changing two literals rather than
  restructuring the component, and if cubby-ui ever grows a defaults provider it
  stops being a patch at all.

### Proposal for cubby-ui: consumer-owned loading visual and layout

Implemented locally in `components/ui/cubby-ui/button.tsx`; copy it up. Two
hardcoded decisions currently force a consumer to patch the vendored file, which
the next `shadcn add` reverts.

**1. `loadingIndicator?: React.ReactNode`.** Upstream hardcodes a spinning
HugeIcon. That is the correct default — a registry component cannot import a
consumer's component — but an app with its own loading idiom then shows two
different busy visuals depending on whether the busy thing is a button or a
field, and the only fix is editing the file.

Render it in the existing slot, inside the existing `aria-hidden` wrapper. **That
wrapper becomes part of the contract once this is a prop and should be
documented on it.** Loading indicators commonly ship their own `role="status"
aria-live`; inside a `<button>` such a region is pruned as presentational
anyway, so hiding it costs nothing and stops a consumer from unknowingly
creating a live region that never fires. `aria-busy` stays the announcement.

**2. `loadingLayout?: "overlay" | "inline"`, defaulting to `overlay`.** Today's
behaviour is `overlay`: content at `opacity-0`, indicator centred over it. Its
comment names the real benefit — the button never changes width. The cost is
that a consumer swapping in a pending label is writing text nobody can see; that
regressed five call sites in this app silently. The labels still reach screen
readers, since `opacity: 0` stays in the accessibility tree, which is exactly
why it is easy to ship without noticing.

`inline` gives the indicator an icon slot and leaves the label visible. It
replaces `leadingIcon` when there is one (no width change), otherwise sits after
the label and the button grows by the indicator's width — the honest trade for
keeping the label. Two details the implementation here already handles:
`iconLeft`/`iconRight` must be computed from the *resolved* slots so the optical
padding follows the indicator, and icon-only sizes have no label to keep, so
there `inline` lets the indicator stand in for the children.

**Open question worth deciding alongside it.** A per-call-site prop still means
repeating `loadingIndicator={…}` at every button in an app with one house
indicator — this app has about ten. A `ButtonDefaults` provider, or an exported
defaults object the vendored file reads, would let an app set it once and retire
the patch entirely. Less conventional for a copy-in registry, so it may be worth
shipping the props first and seeing whether the repetition actually bites.

### Proposal for cubby-ui: one `MenuSwitchIndicator` instead of four copies

`dropdown-menu.tsx`, `context-menu.tsx`, `menubar.tsx` and `base-drawer.tsx` each
render a `SwitchVisual` inside their checkbox item when `indicator="switch"`. The
three menu implementations are identical except for the Base UI namespace they
pull the indicator from (`BaseMenu` vs `BaseContextMenu`) — same grid column,
same `keepMounted`, same four props, same comment.

They had already drifted once: `dropdown-menu.tsx` carried
`[--switch-press-squash:0px]` and the other two did not. That is now fixed
upstream and fixed *well* — `squash` is a real variant on `switchVariants`, and
`SwitchVisual` defaults it to `false`, which is correct for every host where the
row owns the press. So the specific bug is gone; the duplication that produced it
is not.

The remaining cost is the prop surface. Each of the four flattens
`SwitchVisualProps` into `switchColor` / `switchShape` / `switchSize` /
`switchMotion`, so every future Switch variant is four edits in four files, and
`base-drawer.tsx` has already picked a different default (`switchSize = "sm"` vs
`"xs"`).

Proposed: one `MenuSwitchIndicator` exported from `switch/switch.tsx` or a
sibling, taking the switch options plus a `render` prop for the host's
`CheckboxItemIndicator`. Each menu file renders it and passes its own indicator
through `render`. Collapse the four flattened props into one
`switchProps?: Pick<SwitchVisualProps, "color" | "shape" | "size" | "motion">`.

Deferred locally rather than patched: these are vendored files, so the refactor
would be reverted by the next `shadcn add` while also making that update
conflict. This round proved the point — the local `[--switch-press-squash:0px]`
patches were wiped by the re-install, while the upstreamed `squash` variant came
back.

## Parked decisions (context lives elsewhere)

- **Re-slugging a mis-slugged GitHub-only row** — no repair tool, deliberately. Full
  context in `convex/githubOnlyAudit.ts`'s header (why there is a find button and no fix
  button) and `docs/skill-lifecycle.md`. Both paths that could write such a row are closed
  (`alias_unverifiable`, and `matchesSkillIdExactly` for partial names), and production
  audited clean Jul 2026 at zero. Only revisit if the audit card ever reports a mismatch.

- **Fast-delete for dead-but-installable skills ("Fix 2")** — deferred. Full context in
  `docs/skill-lifecycle.md` ("Dead-but-installable skills & the Fix 2 decision") and the
  `/dev` "Dead but installable" stat card. Only revisit if that count climbs.
