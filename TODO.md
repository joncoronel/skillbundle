# TODO

A running list of things to build, ideas, and parked decisions — so they don't get
lost in chat. Not a committed roadmap; a scratchpad. Move items to a "Done" note or
delete them when shipped. Newest thinking near the top.

## Under consideration

### Google Sans Code is preloaded on every route, used on few — Sep 2026

Measured during the Open Runde swap, not caused by it. `next/font` emits a
`<link rel="preload" as="font">` for every declared face, so the mono woff2
downloads on every route regardless of use. On `/official`: **34 KB fetched, 0
mono text nodes, 0 mono pseudo-elements, and `document.fonts` never activates
the face.** Reproduce with `performance.getEntriesByType("resource")` filtered
to woff2 against a production build.

For scale, the four sans faces are 106 KB, so the unused mono is a further 32%
on top of that for the catalog and list routes.

Not obviously fixable, which is why this is a note rather than a task. The mono
is genuinely load-bearing where it appears — install commands, code blocks, the
shiki diff, `owner/repo` strings — and those are spread widely enough that
moving `Google_Sans_Code` out of the root layout would mean re-declaring it per
route and fragmenting one font instance into several (the docs' "font
definitions file" pattern helps with sharing, not with preload scope). Worth
weighing:

- `preload: false` on the mono loader alone. It stops the eager fetch on every
  route; the cost is that pages which DO use mono fall back until the CSS
  triggers the download, so install commands would reflow. `fallback` already
  carries a monospace stack (see the note in `app/layout.tsx` about `iiiii` vs
  `MMMMM` measuring 55.0px either way), so the reflow would be modest.
- Leave it. 34 KB on a warm cache is one request that 304s.

Do not "fix" this by dropping the mono `fallback` array or `adjustFontFallback:
false` — both are load-bearing for different reasons documented in
`app/layout.tsx`.

### Public bundle pages in the sitemap — Aug 2026

Parked while shipping `app/sitemap.ts` (PR #68), which covers the catalog
(skills, orgs, repos, well-known sources) but lists no `/bundle/[id]`. Public
bundles are real indexable pages with real titles, so this is a genuine gap
rather than a decision — it just wants its own thinking:

- The set is user-generated and grows without bound, unlike the catalog, so it
  needs a size story before it needs code. `generateSitemaps` chunking (see the
  note in `app/sitemap.ts`) is the escape hatch if the two together approach
  50k URLs.
- `bundles.isPublic` can flip, and `app/(main)/bundle/[id]/page.tsx` already
  emits `robots: { index: false }` when it is false. A sitemap that lags that
  flip advertises a noindex page. Note the loader is now UNTAGGED and runs on
  `cacheLife("days")` alone (PR #75 — the header in `app/sitemap.ts` argues
  why), so "the entry's cache tag" is no longer a thing to tune: the real
  choice is between accepting up to a day of lag on a flip, adding the
  sitemap-specific tag that file describes as the escape hatch and pinging it
  from exactly one place, or deciding the churn makes bundles not worth listing
  at all.
- `lastmod` is easy here in a way it isn't for skills: `bundles.updatedAt`
  (optional, falling back to the required `createdAt`) is exactly the timestamp
  the field means, with no coalescing argument to make.

### Server-render the version diffs (`@pierre/diffs/ssr`) — Aug 2026

**Prize:** delete ~420 KB of client JS from the skill detail route entirely, and
make expanding a history row instant instead of a load.

The 420 KB is currently code-split and only downloads when someone expands a
row (`loadDiffModule` in `components/skill-history-row.tsx`). Measured against a
production build, it is absent from the skill page's initial load — so this is
about making the _interaction_ free, not fixing a regression.

**Why it's a project, not a tweak.** Three things have to move together:

1. **We use `CodeView`; the preloaders don't cover it.** `@pierre/diffs/ssr`
   exposes `preloadFile`, `preloadFileDiff`, `preloadMultiFileDiff`,
   `preloadPatchDiff`, `preloadPatchFile` — each spreads into the matching
   `File` / `FileDiff` / `MultiFileDiff` / `PatchDiff` component. There is no
   `preloadCodeView`. `components/skill-history-diff.tsx` documents why it uses
   `CodeView` ("the library's own advice" — `FileDiff` conflicted over the
   rendering surface and logged a console error), so this needs that decision
   revisited first.
2. **Content lives in Convex storage blobs.** `versionEntry.contentUrl` is a
   storage URL fetched at view time; SSR means fetching both sides on the
   server. That's fine inside the page's `'use cache'` scope (paid once per
   cache period, not per reader) but it is new server work.
3. **The range selector is combinatorial.** The newest row can compare against
   any older version, up to the 50-version query limit. Prerendering every pair
   is O(N²) for content behind a collapsed disclosure. Realistically only the
   default pair per row (N-1 diffs) could be prerendered, with the rest still
   loaded on demand — so the client renderer probably cannot be dropped
   entirely unless the range selector also changes.

**Encouraging fact:** `node_modules/@pierre/diffs/dist/react/` contains **no
shiki reference at all**. The whole 420 KB comes from the main `@pierre/diffs`
entry, which we import only for `parseDiffFromFile`. Move parsing to the server
and the client could plausibly need nothing heavier than `/react`.

Order of work if picked up: (a) confirm `FileDiff` can be styled to match what
`CodeView` gives today, (b) prerender the default pair per row inside the
existing cached loader, (c) measure the HTML weight added to every skill page
before committing, since most readers never expand a row.

### CodeView renders late, so the diff panel can't be animated (Aug 2026)

`components/skill-history-row.tsx` opens its diff panel with `duration-0`. That
is a deliberate workaround, not an oversight — the animation cannot be made
correct while `CodeView` behaves the way it does.

**What happens.** `@pierre/diffs`' `CodeView` populates its shadow root
_asynchronously after mount_. Measured on a real ~11 KB SKILL.md:

```text
+  0ms  rows=0    ← panel opens; Base UI measures here, writes var=352
+ 45ms  rows=10   ← content appears, +72px
+236ms  panel=424 ← transition ends, height reverts to auto, snaps
```

Base UI's Collapsible reads the panel height **once** on open and never
re-reads. So it animated toward a number that was already 72px stale by 45ms,
then jumped when the transition finished. Not fonts — `document.fonts.status`
was `loaded` for the whole capture, with `document.fonts.ready` awaited first.

**Why it looked fine locally.** Purely content size. A ~600-byte seeded fixture
renders inside one frame; a real SKILL.md takes 45–77ms. Every local skill had
tiny seeded history, so this only ever reproduced on production data.

**What does NOT work** (tried, measured, reverted): `CodeView` exposes a ref
handle with `getInstance()`, and the instance has `render(immediate?: boolean)`.
Calling `render(true)` from a `useLayoutEffect` — which runs before the parent
Panel measures, since child layout effects run first — changed nothing; the
shadow root still held zero rows at open. There is also no post-render hook:
`onPostRender` exists on `UnresolvedFile` only, not `CodeView`.

**If revisited**, roughly in order of preference:

1. Report upstream — a way to render synchronously, or a mounted/ready callback
   on `CodeView`, fixes this properly.
2. Retarget the panel: `ResizeObserver` on the content rewriting
   `--collapsible-panel-height` so an in-flight transition follows. Verified to
   work, but it is a workaround, and it belongs next to `CodeView` rather than
   in the shared `cubby-ui/collapsible.tsx` — the collapsible is not at fault.
3. Leave `duration-0`.

**To reproduce locally** you need real content, since seeded fixtures are too
small. Read a skill's versions off production (public query, read-only):

```bash
npx convex run --prod skillVersions:listForSkill '{"source":"pbakaus/impeccable","skillId":"impeccable"}'
```

then seed those `contentUrl`s into dev. `devSeed.ts` has no importer for that
today — it was written and removed once. `seedVersions`' shape is the model:
an `internalAction` that fetches each URL, `ctx.storage.store`s the blob, and
calls `insertSeededVersion` oldest→newest to keep the `previousSyncHash` chain
intact. Note it overwrites the target skill's history, so seed onto a throwaway
skill rather than one you rely on for the History UI.

### Parked from the 16.3 adoption pass (Aug 2026)

**TypeScript 7 — wait for 7.1.** `pnpm add -D typescript@^7` installs cleanly and
`tsc --noEmit` passes on this codebase (326 unit tests green too), but
`pnpm lint` dies with
`TypeError: Cannot read properties of undefined (reading 'Cjs')` from
`@typescript-eslint/typescript-estree`. Not a version-pin problem: even the
latest `typescript-eslint@8.66.0` declares `typescript: ">=4.8.4 <6.1.0"` and
there is no v9 line. Reverted to `^5`.

This is a known, reported issue and the fix is expected in **TypeScript 7.1** —
migrate once that ships. The bump is one line, and
`experimental.useTypeScriptCli` already defaults to `true`, so `next build` picks
up the native `tsc` automatically. Do **not** work around it with
`useTypeScriptCli: false` — with TS7 installed that makes `next build` exit.

**Enable the /dev admin e2e.** `e2e/authenticated/dev.spec.ts` covers the
admin _gate_ today (a signed-in non-admin gets notFound, not a redirect or an
empty dashboard) and that runs on every CI job. The admin-view half is behind
`E2E_ADMIN=1` because it needs the e2e user in Convex's `ADMIN_EMAILS`, which is
a deployment config change rather than a code one. To turn it on:
`npx convex env set ADMIN_EMAILS "joncorone@gmail.com,e2e+clerk_test@skillbundle.dev"`
on the dev deployment, then set `E2E_ADMIN=1` in the workflow env. Left off by
default so a test identity is not silently granted admin.

**Instant Insights: works — beware stale dev servers.** An earlier note here
claimed the validator was broken upstream. That was wrong, and the correction is
worth keeping: a `next dev` process that has been running a long time across many
HMR cycles starts throwing
`InvariantError: Cannot access "moduleLoading" without a work store`
from `app-render/instant-validation/` on nearly every route, static and dynamic
alike. It looks exactly like a framework bug. It isn't — restart `next dev` and
every route validates clean, including non-prerendered dynamic params.

If Instant Insights reports that invariant, restart the dev server before
believing it or filing anything.

`experimental.instantInsights.validationLevel` is still pinned to `'warning'` in
`next.config.ts`, because the docs warn the framework default may change to a
build-gating level without that counting as breaking.

**Not adopted, with reasons** (so they don't get re-proposed): `supportsImmutableAssets`
(an opt-_out_ for adapters that already enabled it; the docs warn setting it
against an unsupporting adapter breaks deployments — it's Vercel's call, not
ours), `'use cache: private'` for the bundle auth read (owner-vs-viewer state
going up to 5 minutes stale on a page with a visibility toggle is a correctness
hazard), `next/root-params` (N/A — every dynamic segment lives under `(main)`, a
route _group_; nothing exists above the root layout), and the Rust React
Compiler (declined for now). `typedRoutes` would type-check the hand-built
`skillHref`/`ownerHref`/`compareHref` strings and is worth a look later.

**Runtime prefetching — declined, not missed.** The params-into-Suspense split
on the catalog routes is the prerequisite the guide names, not the finish line:
a default link warms only the shared App Shell, so every client navigation into
`/[org]`, `/[org]/[repo]` and `/site/[source]` commits a real breadcrumb whose
URL-dependent crumbs are Skeletons, plus a skeleton `h1`, and resolves the org
name a beat later — even though it was in the href that was clicked. Resolving it ahead of the click means
`<Link prefetch={true}>` plus caching behind the URL-data read
(`node_modules/next/dist/docs/01-app/02-guides/runtime-prefetching.md`).

Declined because each per-link runtime prefetch is a **server invocation per
prefetchable link**. A listing page renders ~100 rows, so viewport prefetching
would turn one shell fetch into a hundred function calls — precisely the load
this app pushes onto the CDN and Convex instead (see the Vercel-plan note in
docs/architecture.md). If it's revisited, hover-triggered prefetch on the
highest-intent links is the version worth measuring, not the viewport default.

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
- Unread state: `lastViewedAt` and `markBundleViewed`. (`listUnreadCounts` and
  `changedSinceViewed` were also built and have since been DELETED — nothing
  read them, and they defined "changed" as a bare `contentUpdatedAt >
baseline`, which ignores audit regressions and delisting. That is a different
  answer from `resolveSkillChange`, which drives both surfaces users see.)
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
- Edit mode is the same register, not a separate card grid — and since the panel
  review, the same register INSTANCE. The page renders one `<BundleRegister>`
  and hands it the staged groups plus row handlers when editing; staging lives
  in `hooks/use-bundle-edit-session.ts` so both modes can reach it, and
  `BundleEditChrome` holds only the picker, the save bar and the discard dialog.
  Two instances used to mean React unmounted one and mounted the other, so your
  section folds and your scroll position reset on every save. Rows keep their
  consequence ordering and condition text while you stage adds and removes, so
  the skill you came to remove is the first row and still says why.
- One-link model: `isPublic` plus a separate `shareToken` URL collapsed to one
  link and one switch. Bundles are created closed and the Pro gate on privacy is
  gone. `listChangesForBundle` and the dashboard feed share one
  `resolveSkillChange` so their ranking cannot drift.
- Pricing rebuilt as a comparison plate (`app/(main)/pricing/pricing-plate.tsx`)
  with the tiers re-cut: free covers 25 watched skills, Pro is $5/mo for
  unlimited watching + repo matching + unlimited GitHub-only adds. The 3-bundle
  cap is gone (it metered organisation, not dependence) and `maxBundles` is
  replaced by `maxWatchedSkills`, counted distinct across bundles. Security
  regressions are free on every plan, permanently.
  Sept 2026: the plate was replaced by two cards
  (`app/(main)/pricing/pricing-cards.tsx`, Pro as "Everything in Free, plus");
  brief in `.impeccable/surfaces/app-main-pricing-page-tsx.md`.
- Dashboard change panel (`app/(main)/dashboard/change-feed.tsx`). The feed
  query now carries audit regressions as first-class rows, ranks by consequence
  ahead of recency, drops baselines (no previous content = no diff to show), and
  trips a mass-change breaker. `markAllBundlesViewed` clears it in bulk and is
  currently the ONLY thing that clears it. `devSeedFeed.ts` populates it
  locally.

**Deployed Aug 8 2026.** The archive and the sweep are both live in production.

**Closed Aug 9 2026: the sweep verified clean.** The initial production run hit
two bugs (an infinite chain loop, and over-flagging every first-seen skill),
both fixed in `6b1aea3`. A clean reading was taken on Aug 9:

    reposSweptInLast25h  1623 / 1624 tracked
    skillsFlagged        0        (skillsFlaggedCapped false)
    skillsWithNoVersions 0        (of a 300-row tail sample)
    versionsBaseline     12,625   (versionsCapped false)

Re-check with `npx convex run freshness:sweepHealth --prod`. `skillsFlagged` in
the thousands means over-flagging has returned and the sweep has become a daily
full-catalog re-download — that is the number to look at first. A
`reposSweptInLast25h` far below `reposTracked` means the chain did not finish;
see the silent-chain note below before assuming a code fault.

Note `versionsBaseline` is 12,625 rather than ≈ 0. An earlier draft of this
section expected ≈ 0 "now that bootstrapping is done"; that was written before
the one-time baseline backfill, which deliberately wrote a row for every skill.
It falls back toward 0 once those age past the 24h window.

Why a dedicated check rather than reading a row count: "the counter stopped
going up" is what a stalled chain looks like AND what a finished one looks like.
That ambiguity is exactly how the loop bug survived being watched.

**Remaining work:**

- **The dashboard feed checks at most 500 watched skills per load, and the
  unchecked tail never rotates.** `MAX_FEED_CANDIDATES` in `skillVersions.ts`
  bounds the fan-out — `resolveSkillChange` costs 2-3 indexed reads per skill,
  and unbounded it eventually exceeds Convex's per-query read ceiling, which
  fails the dashboard outright rather than degrading. So the cap has to exist.

  What is wrong is that it is not eventual. Candidates sort by baseline
  ascending (least recently seen first) and `markBundleViewed` sets a bundle's
  `lastViewedAt` to now — which gives its skills the NEWEST baseline and sorts
  them to the BACK. So the tail is the recently-seen tail, and it stays there:
  the same 500 are re-scanned on every load, forever.

  The UI is honest about it (`CoverageNote` in change-feed.tsx states how many
  of how many were checked, and the light goes neutral rather than green), but
  honest is not the same as covered. A skill in the tail could be delisted for
  months and never reported.

  The fix is a persisted per-user scan position — store where the last load
  stopped, resume from there, wrap around — so coverage is eventual rather than
  never. That is real per-user state and did not belong in the review pass that
  found it.

  UNREACHABLE below 501 distinct watched skills, and free caps at 25. This
  needs a heavy Pro account to matter at all, which is why it is parked rather
  than scheduled. Revisit if anyone gets near it.

- **Re-measure the mass-change threshold.** `MASS_CHANGE_THRESHOLD` in
  `skillVersions.ts` is 750, which is ~5x an ESTIMATE (~16.0k live skills at
  the measured 27.5%/month is ~150 changes/day), not a measurement. Under ~3x a
  busy day it fires on ordinary Tuesdays; far over it never fires at all.

      npx convex run skillVersions:changeRateHealth --prod

  Read `realChanges` per day — IGNORE `baselines`, which is the one-time
  backfill and says nothing about the change rate. Take several days: the rate
  is lumpy, and one reading times thirty is how the previous estimate went
  wrong. Then set the constant to ~5x a busy day.

  **From roughly 2026-08-16, not September.** An earlier version of this entry
  said mid-September, reasoning that the archive was slowly backfilling itself
  at ~459/day. That model was wrong — the archive only ever wrote on a CHANGE,
  so it was never going to fill on its own. The one-time backfill (2026-08-09)
  gave every skill a baseline, so real change data has been accruing since
  then, and a week of it is enough.

- **Nothing prunes the version archive.** `skillSnapshots` has a retention
  cron (06:45 UTC, 180 days, `pruneSnapshots`). `skillVersions` has no
  equivalent — the only code that deletes a version row is `devSeed`'s
  teardown, which is gated against production. The two `ctx.storage.delete`
  calls in `recordSkillVersion` release the INCOMING blob on a no-op write
  (dead skill row, or a duplicate hash from a retry); they never touch stored
  rows. `MAX_VERSION_LIMIT = 200` is a read cap, not retention.

  Rows are cheap; the blobs are not. Every version stores the full raw
  SKILL.md in file storage, and the 2026-08-09 backfill wrote ~12,600 of them
  in one pass — already the bulk of what is there. Growth from here is one
  blob per real change, which is the same number
  `skillVersions:changeRateHealth` reports, so the threshold re-measurement
  above sizes this too. Do that first; there is no point designing retention
  against a guess.

  One asymmetry worth knowing when you do: `markDelistedSkills` explicitly
  deletes a delisted skill's `skillEmbeddings` row to save storage, but leaves
  its version rows and blobs. A skill can leave the catalog for good and keep
  its full archive.

  NOT scheduled, because the shape is a product decision and not a cleanup. A
  monitoring product deleting its own history is a feature change. The
  plausible options — cap versions per skill, drop the blob but keep the row
  and its description diff, or age out on a window — differ in what a user
  loses, so pick deliberately rather than reaching for the snapshot cron's
  pattern because it exists.

**Loose ends worth knowing about:**

- **The daily sweep stopped after 146 of 1,624 repos on 2026-08-09, and we do
  not know why.** Re-running it by hand completed the full walk (1,623/1,624),
  so the code is not simply broken. Two candidates, neither confirmed:

  1. A Convex deploy landed mid-chain. An interrupted action just stops — no
     error, no log, no retry — which matches a partial run with no abort line.
  2. It was the first production run after the sweep changes in this branch,
     notably `touchSweepState`, which fires a mutation on every 304 where the
     old code wrote nothing. That turns a near-write-free walk into ~1,600
     round-trips, and one throw anywhere kills the chain. Weakened by the
     manual re-run succeeding, but "intermittent under load at 04:00 UTC" and
     "fine by hand at midday" are compatible.

  The evidence is gone: Convex evicted the logs (the baseline backfill flooded
  them), and the manual re-run overwrote the per-repo `sweptAt` timestamps that
  would have shown which 146. Suggesting that re-run before dumping the table
  was a mistake.

  **Instrumented rather than guessed at.** The `sweepRuns` table now records one
  row per walk, with progress written on every chain link and `finishedAt` set
  only on a real ending. `sweepHealth` surfaces `lastRunFinished`,
  `lastRunOutcome` and `lastRunReposSwept`, so a chain that dies is stated
  outright instead of inferred from a low repo count. Verified on dev: a run
  reads `finished: false` with a climbing count while in flight, then closes
  `complete`.

  **The open question resolves itself on the next few 04:00 UTC runs** (9pm
  Pacific). Completing means 2026-08-09 was a one-off. Dying again means
  candidate 2, and the row will say where it stopped.

- ~~`skillVersions.suppressed` is declared and nothing sets it.~~ Dropped
  Aug 2026. The mass-change breaker got built at READ time instead
  (`isCatalogWideChangeEvent` in `skillVersions.ts`), because at write time you
  cannot know you are the 3rd of 3,000, so the per-row flag never had a writer.
  Worth noting for the two-deploy rule below: this one came out in a _single_
  deploy, because no row ever carried it. The dance is only needed when the
  field has been written.
- ~~The dashboard feed hides a change whose only archived version is a
  baseline... do not read an empty feed as proof that nothing changed until
  roughly Sep 2026.~~ **Closed 2026-08-09 by backfilling every baseline.**

  The reasoning behind that caveat was wrong, not just its date. It assumed the
  archive was slowly filling itself in. It was not: the archive only writes on a
  CHANGE (`archiveSkillVersion` is gated on `outcome.changed`), so a skill that
  never changed would never get a first row — not in a month, not ever. Coverage
  would have crept up only as skills happened to change, and each skill's FIRST
  change would still be swallowed as its baseline, leaving the user told nothing
  until the second.

  `skills:backfillArchiveBaselines` closed it in one pass: 12,625 baselines, all
  300 of the tail sample covered, verified with `sweepHealth`. Every skill now
  has a comparison point, so the NEXT change to any skill is reportable. An
  empty feed can be read as an empty feed.

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

### skills.sh API auth: migrated to Vercel OIDC, key kept as fallback (Aug 2026)

Built. What is left is deployment config, listed at the bottom.

**What the API does now**, measured Aug 11 2026:

    GET /api/v1/skills             401 authentication_required   (no credential)
    GET /api/v1/skills             200                           (sk_live_ key)
    GET /api/v1/skills             200                           (relayed OIDC token)
    GET /api/v1/skills/audit/...   200                           (no credential)

The audit endpoint answering unauthenticated is an enforcement gap, not a
promise. Don't plan around it.

**The awkward part:** the OIDC token is minted per-request inside a Vercel
runtime, and our whole sync runs on Convex crons, which have no Vercel request
context. So "use the documented credential" is not a header swap, it is a relay.

**What was built:**

1. `app/api/skills-token/route.ts` mints a token via `getVercelOidcToken()`,
   gated by `SKILLS_TOKEN_SECRET` (same arrangement as `/api/revalidate`).
2. `convex/skillsAuth.ts` caches it in the single-row `skillsAuthToken` table,
   refreshed hourly by cron. **Hourly because the runtime token lives 2h, not
   the ~12h the Vercel docs claim** — see the measurement below.
3. `loadSkillsAuth(ctx)` in `convex/lib/skillsAuth.ts` is called once per action
   and threaded through, so a sync that fans out thousands of upstream calls
   still costs one query. It never refreshes, deliberately: refresh is a
   scheduled job so parallel actions can't stampede our own relay.
4. `convex/lib/skillsApi.ts` sends the OIDC token, and retries once with
   `SKILLS_SH_API_KEY` on 401/403 only. Not on 429 (the limit is per team and
   project, so a second credential just spends both) and not on 5xx (that is
   `withTransientRetry`'s job).

**OIDC is primary and the key is the fallback, not the reverse.** An earlier
draft of this entry had it backwards, on the reasoning that preferring the key
changes nothing day to day. That is exactly the problem: a fallback that never
executes is a fallback that is broken on the day it is needed. Running OIDC on
every sync means a breakage shows up as a bad day, and the day the key is
retired is a non-event.

**The fallback is silent by design** (the catalog keeps syncing either way),
which is why `/dev` has a "skills.sh API auth" panel. Without it, a broken relay
would go unnoticed until the key itself died, which defeats the point of
migrating. `getSkillsAuthStatus` mirrors `loadSkillsAuth`'s expiry margin
exactly, so what /dev shows is what the next sync will do.

**Verification that made this safe to build** (Aug 11 2026, from a non-Vercel
machine, which is the case that matters):

- A relayed token authenticates on all five endpoints: listing, search, curated,
  detail, audit. skills.sh verifies the JWT (`iss` `https://oidc.vercel.com/jon-dev`,
  `aud` `https://vercel.com/jon-dev`, subject
  `owner:jon-dev:project:skillbundle:environment:development`) and does NOT
  require the request to originate from Vercel infrastructure.
- OIDC Federation is available on our plan (we are on Vercel Pro now).
- A token minted by a real deployment (preview, PR #64) authenticates against
  skills.sh too, so environment scoping is not a gate: subject
  `owner:jon-dev:project:skillbundle:environment:preview` works the same.

**Three documented things that turned out not to be true**, all worth knowing
before building on them:

- **The runtime OIDC token lives 2h, not ~12h.** Measured Aug 12 2026 against a
  real deployment: `exp - iat` is exactly 7200s, and the token is minted fresh
  per request. The docs' "rotated roughly every 12 hours" does describe the
  token `vercel env pull` writes for local dev, which is almost certainly where
  the number comes from. Do not size a refresh interval off a locally pulled
  token: this was built as a 6h cron on the 12h figure and would have spent two
  hours in every six on the fallback key while looking migrated. Caught only
  because the preview deployment was tested before merge.

- **No `X-RateLimit-*` headers on any response**, on either credential, despite
  the docs promising them on every authenticated request. So there is no free
  signal for which credential served a request, and no way to see how close to
  600/min we are. Our own bookkeeping is the only source.
- **The key is not an orphaned legacy path.** A garbage bearer token returns
  `Expected a Vercel OIDC token (JWT) or an sk_live_... API key`, so their auth
  layer still names it. It is undocumented, not abandoned. That is why this was
  worth doing deliberately rather than urgently.

Rejected alternative, still rejected: proxying every skills.sh call through a
Vercel route. The sync is thousands of staggered per-skill actions carrying
multi-MB `files[]` payloads, so that converts one cron chain into thousands of
function invocations. The relay costs ~24 invocations a day and keeps all sync
bandwidth on Convex.

**Left to do (deployment only).** Until these are set, every call runs on the
key exactly as before, and /dev says so:

    # Vercel (production), same value on both sides
    SKILLS_TOKEN_SECRET=<secret>

    npx convex env set SKILLS_TOKEN_URL https://skillbundle.dev/api/skills-token --prod
    npx convex env set SKILLS_TOKEN_SECRET <secret> --prod
    npx convex run skillsAuth:refreshToken --prod   # don't wait up to an hour for the first cron

Keep `SKILLS_SH_API_KEY` set. It is the fallback now, and removing it would turn
a relay outage into a sync outage.

Strategic note, not just an ops note: skills.sh is Vercel, and OIDC auth scopes
every consumer to a Vercel team and project with `owner_id` / `project_id` /
`environment` logged per request. Our entire catalog is downstream of an API
that a competitor controls, meters, and can identify us on. Migrating to their
documented credential does not change that, it just stops us depending on an
undocumented path as well. That is the backdrop for any decision about what this
app should be.

**If we ever host somewhere other than Vercel (Railway, Fly, a VPS).** Nothing
here has to be reverted. The whole chain degrades to the pre-migration behavior
on its own: `getVercelOidcToken()` throws with no Vercel request context, the
route returns 503 `oidc_unavailable`, `refreshToken` records that and stores no
token, `loadSkillsAuth` finds nothing usable, and every call goes out on
`SKILLS_SH_API_KEY`. That is not a prediction: it is exactly what happened
testing the route on localhost, which hits the same root cause a non-Vercel host
would. `/dev` reads "Legacy API key" with the relay error underneath, so it is
visible rather than mysterious.

One cleanup if that day comes: the hourly cron would keep logging a failed
refresh forever. Unsetting `SKILLS_TOKEN_URL` does not silence it (the message
just becomes "not configured"), so drop the cron entry in `crons.ts` instead.

The real constraint is not this code, it is that skills.sh's only documented
credential is a Vercel OIDC token. Hosting elsewhere means depending entirely on
the undocumented `sk_live_` key with no supported path when they retire it,
which was equally true before this migration.

But the relay shape gives us an out a direct integration would not. Because what
MINTS the token is decoupled from what USES it, the app could live on Railway
while one minimal Vercel project keeps serving `/api/skills-token` alone. Convex
calls it hourly, so 24 invocations a day, trivially inside a free plan. Worth
recording because it inverts the obvious read: this migration lowers the cost of
leaving Vercel rather than raising it. Without it, "authenticate the documented
way" and "host on Vercel" would be the same decision.

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
~16k skills; instead query each skill's own vector against the existing
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
dark. Full alpha under the same dimming gives 2.44:1 and 2.16:1, i.e. slightly _more_
visible than an ordinary focus ring, which is the right way round for the one state
where you most need to find focus. `data-disabled:focus-visible:outline-ring` (no
`/50`) is therefore deliberate, not a typo — do not "normalise" it. Residual and not
from this: the ordinary `/50` ring is itself 2.08:1 / 1.83:1, under the 3:1 non-text
threshold, app-wide. That is the part this entry is about.

**Add the header pill's `--chrome` surface to that table when the branch runs
(Aug 2026).** The table above measures `--surface-1`…`-5`; the pill introduced a
sixth backdrop that none of those numbers cover. Measured on it: `outline-ring/60`
is **2.2:1 light / 1.9:1 dark** — the same shortfall, on the one surface where the
ring sits against a near-black fill instead of the page. A pill-scoped fix was
built and measured at **17.07:1 light / 11.73:1 dark** (`--chrome-ring:
var(--chrome-foreground)`, i.e. a near-white ring) and then reverted on the user's
call, because a ring that only looks right inside the pill is a worse end state
than one wrong ring everywhere. Those two numbers are the point of this note: the
app-wide fix has to work on the chrome surface too, and the near-white value is
known to clear it.

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

### Scope toggle: Official's on/off cue is hue-only in dark (design decision)

Third sibling of the two entries above, same shape: a measured 1.4.11 shortfall
parked rather than fixed in a feature branch.

The home search composer's two scope toggles are icon-only on a fine pointer
(`components/skill-composer.tsx`, `SCOPE_OPTIONS`). Official's pressed state is
carried by the icon colour plus the toggle's pressed plate. Measured Aug 2026,
on vs off:

    icon, light  --primary vs --muted-foreground          1.55:1
    icon, dark   --info-foreground vs --muted-foreground  1.04:1
    pressed plate, dark  --surface-selected over --muted  1.36:1

Light is a visible step. Dark is not: the icon pair is effectively the same
brightness, so state there rests on the 1.36:1 plate alone, and DESIGN.md §8 says
state is never colour alone. The Descriptions cell is fine, it swaps to
`--foreground` (2:1 in dark).

**No blue can fix the dark case.** Blue contributes 0.0722 of relative luminance,
so any saturated blue lands near a mid grey no matter which token is chosen. The
lever is the pressed plate, not the icon colour: `--tgl-bg-selected` would need to
reach roughly `oklch(0.42)` in dark for 3:1 against the `--muted` track, against
about `oklch(0.31)` today.

A stroke-weight cue (pressed icons at `strokeWidth` 3) was built and measured to
survive greyscale, then reverted on the user's call (Aug 2026) because of how it
looked. Deferred because raising the selected plate repaints every attached
ToggleGroup in the app, which is the same visual-identity call as the two entries
above, not a side effect of one composer branch.

### Parked from the skill-page-redesign review (Aug 2026)

One call made deliberately during that branch's review rounds, declined for a
reason about scope rather than merit. Recorded here because the review file
itself is under `reviews/`, which is git-ignored — the reasoning would disappear
at merge otherwise. (The other two shipped: `format:check` is wired into
`pnpm check` as of #73, and the skip link landed after it.)

### Parked from the skip-link / landmark review (Aug 2026)

Three findings from that branch's panel review, deferred with reasons. The rest
were fixed in the branch.

- **Eighteen near-identical page width wrappers.** `mx-auto max-w-{2,4,6,7}xl px-4
pt-{12,16,20,24} pb-{20,24}`, copy-pasted across every route, with drift
  already in it — the padding varies by no stated rule. Now that
  `(main)/layout.tsx` owns the landmark, the only per-page concern left is
  essentially the width, so a `PageContainer` taking a width token would express
  it. Deferred because it touches every route in the app for zero user-visible
  change, and the branch that surfaced it was about landmarks; the two shouldn't
  ride together. The genuine exceptions to preserve: home has no vertical
  padding, `not-found` uses `pt-24`.

- **`(auth)` still uses the per-page landmark arrangement that `(main)` just
  abandoned.** `AuthFrame` supplies `<main>` for the pages and
  `(auth)/error.tsx` supplies its own when the boundary replaces it — exactly
  the "a route can be missed" shape the `(main)` consolidation was argued
  against. A new `(auth)` route that doesn't use `AuthFrame` reproduces the
  `/[org]` bug. The fix is hoisting the landmark into `(auth)/layout.tsx`, but
  it has to absorb `AuthFrame`'s `min-h-screen flex-col` column too, since its
  `<main className="flex flex-1 …">` depends on being a flex child of it. That
  is a restructure of the sign-in surface, which wants its own change and real
  browser testing of a flow CI doesn't cover. `e2e/landmarks.spec.ts` asserts
  one visible `<main>` on `/sign-in` in the meantime, so a regression is caught
  even though the arrangement is unchanged.

- **Deeply unmatched URLs get no app chrome at all.** Measured: `/a/b/c/d`
  returns 404 with Next's built-in page — no header, no `<main>`, no skip link,
  no route back into the app. `app/(main)/not-found.tsx` only covers URLs that
  match a `(main)` route and then call `notFound()` (e.g. `/nope-not-an-org`,
  which renders correctly inside the layout). Per
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md`,
  a **root** `app/not-found.tsx` or `app/global-not-found.tsx` is what handles
  unmatched URLs app-wide. Pre-existing, not caused by the landmark work — but
  that work is what makes "exactly one `<main>`, everywhere" a stated invariant,
  so the exception is newly worth naming. Fixing it means deciding what a global
  404 should look like and how much of the header to duplicate outside
  `(main)/layout.tsx`, which is a product call.

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

### Per-skill cache tags, then gate the content-chain ping

**Sequence, decided Aug 2026 — read this before the argument below.**

1. **Per-skill tags** (`cacheTag("skill:" + source + "/" + skillId)`), plus
   batch-tag support in `/api/revalidate`.
2. **A "publish owed" retry** for a ping that fails, or the confidence that a
   per-skill ping is cheap enough to just retry. See "A second dependent".
3. **The gate** — ping only when content actually changed.

The gate is last because it banks nothing before step 1, for the reason set out
under "Why the obvious gate isn't worth building": a catalog-wide gate only
suppresses the ping on a day when NOT ONE skill in ~16k changed.

This ordering is recorded here because the entry used to state it twice and
disagree with itself — "per-skill tags are the prerequisite … which is why they
lead this entry now" against "sequence it after the gate, not before", both
written in the same commit (`8faa192`, PR #65), so neither superseded the other.
The prerequisite argument is the one the entry actually supports, so it wins and
the title now matches it. If you come to disagree, change this block rather than
adding a third opinion further down.

Updated Aug 2026, after the cadence split (PR #65). The tags are now
`skill-sync` (install counts, ranks, snapshots, versions, copies) and
`skill-content` (the skill row) — see `lib/skill-cache.ts`. Both are still
all-or-nothing across the catalog: every skill's entry carries the same two
strings, so one ping invalidates all ~16k. There is no way to refresh a single
skill.

**The concrete problem left.** `markStaleContent` chains into
`backfillDiscoverUrls` unconditionally, and both content terminals
(`backfillFetchContent`, `fetchSkillDetailBatch`) schedule
`internal.skills.publishSkillUpdate` with no "did we actually write content"
gate. So `skill-content` is pinged ~4 times every morning even on a day when no
SKILL.md changed, which is exactly what the split was supposed to stop. Until
this is gated, `loadSkill`'s `cacheLife("weeks")` is doing the real work and the
content tag is contributing little on the daily path.

**Why the obvious gate isn't worth building.** Detecting the change is not the
problem: `updateDescription` already returns a transactional `changed` flag,
`skillVersions` carries a `by_changedAt` index (schema.ts:507), and
`skillSummaries.contentUpdatedAt` mirrors "last time the file actually moved".
Any of those answers "did content change since X" in one indexed lookup.

The problem is that the tag is catalog-wide. A global gate suppresses the ping
only on a day when NOT ONE skill in ~16k changed its SKILL.md — and this app's
headline feature is a change feed of exactly those events, so such days are
close to nonexistent. Building it would be ~20 lines that fire anyway. Per-skill
tags are the prerequisite that makes any freshness check meaningful — which is
the whole reason for the sequence at the top.

Note the sync path already does the gated thing where it can: `upsertSkillsBatch`
returns a `contentFieldChanges` count and `syncSkills` pings `skill-content` only when
it's non-zero. The content chain is harder only because of the scheduling shape.

**A second dependent, added Aug 2026.** The add path now publishes a user-added
row's first content from inside the write's own transaction
(`skills.publishFirstUserAddedContent`), so a dropped publish can no longer come
from the action dying between the commit and the schedule. What it can still
come from is the ping itself failing — `revalidateSiteTag` swallows errors and
never retries. Today the ungated daily ping quietly covers that within 24h. Gate
it and the recovery window becomes `loadSkill`'s `cacheLife("weeks")`, i.e. a
freshly added skill can show an install count over an empty body for up to 7
days with nothing recording that a publish was owed. So this entry now needs a
per-row "publish owed" retry (or a per-skill tag to ping cheaply) BEFORE the
gate, not merely alongside it.

**Already tried and reverted (Aug 2026): a third `skill-audit` tag.** The idea
was to move `loadAudits` off its 24h timer onto a weekly life plus a tag pinged
by the audit chain. It banks nothing, for the reason above applied one level
down: the chain's publish gate is a single OR over the whole day's drain
(~1.3k skills), and `auditsChanged` counts a provider re-stamping `auditedAt`
under an identical verdict — so the gate fires most days and the entry gets
expired daily anyway, exactly as the timer did. It also traded a guaranteed 24h
self-heal for a best-effort ping whose only signal lived in scheduler args, and
moved `expire` from 7 to 30 days on a security surface. The full reasoning is at
the loader in components/skill-detail-page.tsx. Do not retry it before per-skill
tags exist — the same global-gate arithmetic sinks any per-tag variant.

Per-skill tags (`cacheTag("skill:" + source + "/" + skillId)`) are the fuller fix
and would let the content step ping only what it touched. One caveat that does NOT
change the sequence at the top, but does bound what step 1 buys: they do not help
the daily `skill-sync` ping, because `syncSkills` walks the entire leaderboard and
legitimately moves nearly every install count, so "only the skills that changed"
is "all of them". (Batch-tag support in `/api/revalidate` is step 1's own scope,
not a bound on it — see the sequence above.)

Fine meanwhile: invalidation only _marks_ entries stale, so a page rebuilds when
someone visits it. Cost is bounded by traffic, not by the catalog.

Context: this came out of fixing the content-publish ordering (Jul 2026). The content
pipeline previously never pinged the tag itself; publishing relied on `reconcile`'s
07:00 ping, which is gated on `refreshed > 0` and fires at a fixed hour rather than
when content is ready. `backfillFetchContent` and `fetchSkillDetailBatch` now ping
`internal.skills.publishSkillUpdate` at their terminals.

### Forgot password: no reset flow exists (Sep 2026)

Password sign-in has no recovery path. A user who forgets their password
cannot get back in, and the only other route is an OAuth provider they may
never have connected. Noticed during the sign-in/sign-up redesign, where the
reference design carried a "Forgot password?" link and we deliberately shipped
without one rather than add a dead link.

The API is on the same `useSignIn()` actions surface the forms already use, so
this is UI work rather than an integration (verified against
`@clerk/shared@4.27.1`, `dist/types/signInFuture.d.ts:379-470`):

1. `signIn.create({ identifier })` with the email.
2. `signIn.resetPasswordEmailCode.sendCode()`.
3. `signIn.resetPasswordEmailCode.verifyCode({ code })` — moves
   `signIn.status` to `'needs_new_password'`.
4. `signIn.resetPasswordEmailCode.submitPassword({ password })` — moves it to
   `'complete'`, then the existing `finalize({ navigate })` path.

Nearly every piece already exists: `AuthFrame` for the shell, `AuthCodeGroup`
for step 3, `AuthPasswordField` for step 4, `AuthFooterPrompt` /
`AuthCrossLink` for the way back, `useResendTimer` for the cooldown, and
`resolveClerkErrorMessage` for the errors. What has to be decided is the shape:
a fourth step inside `components/auth/sign-in-form.tsx` (which already carries
password + second-factor branches and would grow a third), or its own
`/sign-in/reset` route reusing the same pieces. The route is probably right —
the form is already the largest file in `components/auth/`.

Two things not to miss. `signIn.resetPasswordMfa` exists
(`signInFuture.d.ts:470`) because an account with a second factor still has to
clear it after the reset, and this app's Client Trust setup produces exactly
that second factor on a new device. And the link belongs beside the password
field's label in the card, not in the tray footer, which already holds the
sign-up cross-link.

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
fetch + Voyage embedding), and it only pays off if the free demo _isn't_
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

**Currently three entries.** An earlier round of this list had nine; the other eight
were fixed upstream in cubby-ui and came back in the next `shadcn add`, which is
the outcome to aim for. That round is worth copying: the Switch's `squash`
variant, CopyButton's `display: contents` wrapper and the `sr-only` removal from
Button all landed upstream in better shape than the local patch had them.

- **`drawer/drawer.css` — the horizontal-drawer scroll rules are deleted.**
  Upstream anchors them on the document root with
  `html:has([data-slot="drawer-viewport"][data-direction="left"|"right"])`. An
  `:has()` on `html` makes the engine re-check the root on every DOM mutation
  anywhere in the document, so it is charged to every page that imports the
  drawer whether or not one is open — and the rules are never unloaded, so one
  visit to a route with a drawer taxes every later route in the tab. Measured
  against the install chart: handler p90 4.5ms to 5.3ms, frame p90 12.6ms to
  16.6ms, with no drawer open. **Re-apply by deleting the two `html:has(...)`
  blocks.** Nothing replaces them: `drawer.tsx` already puts
  `overscroll-x-none` and `overflow-y-hidden` on that same viewport for
  horizontal directions, so a rescoped rule would only have added
  `overscroll-behavior-y: none` to an axis that cannot scroll. What goes with
  them is hiding the PAGE scrollbar while a horizontal drawer is open; nothing
  here uses `direction="left"|"right"`. Worth upstreaming: the intent is to stop
  scroll chaining out of the drawer, which the component already does on the
  scrolling element.

- **`transition-panel.tsx` — `@starting-style` is gated on `hasActivated`, not
  on a mount effect.** Upstream holds a separate `mounted` flag, flipped in a
  `useEffect` deferred through one `requestAnimationFrame`. That defers around
  the problem rather than removing it: React flushes pending passive effects
  synchronously when another update arrives first, so the `starting:` classes
  can be added before the browser has resolved style for the just-committed
  subtree, and `@starting-style` still applies — a panel that mounts
  mid-session (behind Suspense, or gated on data) plays its entrance once.
  `hasActivated` is already computed two lines up, already documented as "the
  first swap flips it permanently", and is the exact condition the starting
  styles exist for: a view only goes `display: none` to displayed when
  `activeKey` moves. Deriving it during render puts the flag in the same commit
  as the `display` change, so there is no paint timing to schedule around.
  **Re-apply by deleting the `mounted` state and its effect, and passing
  `hasActivated` through the context in its place** (the context field and the
  two `TransitionPanelView` call sites are renamed to match). Verified only
  indirectly: nothing in this app renders `TransitionPanel`, so the measurement
  behind it is from `components/ui/cubby-ui/crossfade.tsx` (ours, not vendored
  — it just lives in that folder), which had the same bug in
  the same shape — `transitionstart` for `opacity`, `filter` and `translate`
  fired ~430ms into a `/settings` load, on both tabs, until the same change
  landed. Worth upstreaming; if it does, this entry goes away.

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
`iconLeft`/`iconRight` must be computed from the _resolved_ slots so the optical
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
upstream and fixed _well_ — `squash` is a real variant on `switchVariants`, and
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

- **Baseline archive repairs — run and retired, Aug 2026.** The `isBaseline`
  write path produced two kinds of wrong row, both fixed at the source
  (`5f4d427` for baseline labels, `dcb61f5` for description claims), and both
  repaired by hand — the label half by an earlier inline one-shot (`6e12f16`),
  the description half by `convex/skillVersionsRepair.ts`, since deleted.
  Recorded here because the tooling that could re-answer these questions is
  gone:

  - `auditBaselineLabels`: 0 mislabeled of 13,247 baseline rows, `complete:
true` — that half had already been repaired by the earlier one-shot, so
    `repairBaselineLabels` patched nothing.
  - `auditBaselineDescriptionClaims`: 794 found of the same 13,247,
    `scanComplete: true`, newest offending row 2026-08-12 21:52 UTC.
    The fix reached master with `b8ddb90` at 2026-08-13 03:32 UTC and was
    deployed shortly after, so that row predates the fix by ~5h40m and the
    pre-flight's "is this still happening" check passed. Note the margin is
    thin and the window was quiet — the 06:00 UTC sync did not run inside it —
    so read it as "nothing wrote one after the fix landed", not as a long clean
    run. `repairBaselineDescriptionClaims` cleared them.
  - Verified against production AFTER the deletion, by an inline read-only
    query over the same predicates: 13,247 baseline rows, 0 description claims,
    0 mislabeled. That is the number to trust; the two above are what the
    tooling reported at the time.

  If either count is ever non-zero again, the write path has regressed —
  `convex/skillVersions.ts` derives all three fields from one `isBaseline`
  expression precisely so it cannot. Rebuild the audit from that expression
  before assuming the data is at fault.

- **Two refactors from PR #62's panel review (findings 32 and 14)** — both
  considered and declined, Aug 2026. Recorded so a re-run of the review does not
  re-propose them.

  _Collapse `openWithDiff` and `changeRange` in `components/skill-history-row.tsx`
  into one helper._ Fair when written, stale by the time it was weighed. The
  review saw two busy booleans, a cached fast path with its own rules, `warm`,
  `warmSoon`, a debounce timer, and a stale-guard token on only one of the two
  paths. Replacing hover prefetching with a click-time busy floor deleted most of
  that. What remains is ~20 lines each sharing about six lines of shape, differing
  in four ways: only the open path loads the renderer chunk and records failure,
  only the swap path carries the token guard, and they commit different things. A
  shared helper would need three flags to absorb that, which reads worse than the
  two straight-through functions. The related suggestions were declined too:
  deriving `Diff` from the module-scope binding swaps explicit state for an
  implicit dependency on `open` changing in the same tick, and splitting the
  newest row into its own component creates two components sharing most of their
  body to remove one prop's double duty.

  The behaviour is covered either way — `e2e/skill-history.spec.ts`, mutation-
  tested — so this is a taste call with a net under it, not a risk being carried.

  _Extract a shared listing shell across `/[org]`, `/[org]/[repo]` and
  `/site/[source]`._ The two things that could drift silently are already fixed:
  all four copies of the row-corner logic call `rowPositionClassName`, and the
  title scale lives in `lib/listing-styles.ts` so a skeleton cannot fall out of
  step with the `<h1>` it stands in for. What is left is duplication with no known
  defect, across three pages that are deliberately diverging. Weigh any revival
  against why `components/listing-page-loading.tsx` was deleted in that same PR:
  one shared skeleton for three pages produced shells matching none of them, and
  fallback fidelity was the property being fixed. Revisit only if a fourth listing
  page appears.

- **Re-slugging a mis-slugged GitHub-only row** — no repair tool, deliberately. Full
  context in `convex/githubOnlyAudit.ts`'s header (why there is a find button and no fix
  button) and `docs/skill-lifecycle.md`. Both paths that could write such a row are closed
  (`alias_unverifiable`, and `matchesSkillIdExactly` for partial names), and production
  audited clean Jul 2026 at zero. Only revisit if the audit card ever reports a mismatch.

- **Fast-delete for dead-but-installable skills ("Fix 2")** — deferred. Full context in
  `docs/skill-lifecycle.md` ("Dead-but-installable skills & the Fix 2 decision") and the
  `/dev` "Dead but installable" stat card. Only revisit if that count climbs.

- **Wheel zoom on the install chart (`zoomX`)** — built, measured, removed. TanStack
  Charts' `zoomX` works correctly on the chart's time scale (verified: 31 bars → 9 → 72,
  with the tick cadence adapting per zoom level), but it "captures wheel input only while
  the plot control is focused", so the wheel does nothing until you click the chart first.
  `ZoomXOptions` exposes no way to change that, and focusing its control on `pointerenter`
  does not work — the control (`rect[tabindex="-1"]`) is not in the DOM at hover time.
  It also cost interaction smoothness: with `zoomX` mounted, the tooltip and the bars'
  hover dim both went visibly laggy under real pointer input. Do not trust a synthetic
  probe to check this — one was written, sampled tooltip opacity across 25 moves spaced
  28ms apart, and reported no difference at all, because that input rate never provoked
  the per-event cost that a real mouse at 60-125Hz does. Verify by hand.

  Revisit if the library adds an option to capture the wheel on hover, and re-check the
  interaction cost by hand if so. The alternative, if it never does, is a custom wheel
  handler: the range is already two day indices, so widening and narrowing it is
  arithmetic and needs none of `zoomX`'s scale inversion — and it adds no per-event
  listener to the plot.

- **Widen the charts' history window past 90 days** — discussed Aug 2026, not done.
  `INSIGHTS_HISTORY_DAYS` (`convex/skills.ts`) is 90; both the install chart and the
  compare chart read that window. Raising it to 180 needs TWO coordinated changes, not
  a constant bump:

  1. `SNAPSHOT_RETENTION_DAYS` is also 180, and the wider retention exists so the daily
     prune never races the query at the window's edge. Setting the query window to 180
     removes that margin — the prune deletes day `today - 180` while the query asks for
     `>= today - 180`, so the oldest column winks in and out between loads. Raise
     retention above the window (270 restores a 90-day buffer) at roughly +50% snapshot
     rows.
  2. The install chart's bars stop being readable. Bar width is 80% of the smallest gap
     between points, and the plot spans 596 units: measured 6.81 at today's 71 points,
     5.36 at the 90 cap, and 2.66 with 0.67px gaps at 180 — the bars merge into a solid
     block, and `radius: 4` clamps to half-width so each becomes a lozenge. Full range
     would need a different bar treatment (or an area mark) at that density.

  The compare chart is lines only and needs neither change. The range control already
  makes a longer window cheap to look at, which is most of what raising it would buy.

- **OG cards moved to Open Runde. Reversed and done, Sep 2026.** This entry used to
  record the opposite: the cards stayed on Geist Sans, declined on value. Two of the
  three reasons were about SN Pro specifically and expired when the app changed face.

  - "Geist Sans and SN Pro are both geometric sans faces, so the difference at card
    scale is slight" — Open Runde is a rounded face, and the difference is not slight.
  - "Satori wants static ttf/otf/woff, SN Pro is a variable woff2, so this needs
    hand-cut instances somebody has to redo whenever the font moves" — Open Runde ships
    static instances, and `scripts/build-open-runde.py` cuts both the browser and the
    `ImageResponse` sets in one run, so nothing is hand-cut.

  The third reason still stands and the cards still set code in Geist Mono: matching the
  app's Google Sans Code needs a TTF that `next/font/google` never writes to disk. That
  is now the only face the cards do not share with the app, and it is the half nobody
  reads as brand.

  The side-effect check from the original entry held: `lib/og/*` is `server-only` and
  used only by the `opengraph-image` routes, the cards are CDN-cached, and
  `next.config.ts` traces `assets/og/**` as a glob, so the renamed files travel without
  a config change. The reads stay at module scope in `lib/og/fonts.ts` — that is what
  keeps those routes prerendering static.
