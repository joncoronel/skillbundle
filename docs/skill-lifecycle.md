# Skill lifecycle & sync state machine

How a skill enters the catalog, how its data (installs, content, relationships)
stays fresh, and when it's hidden. Keep this in sync with `convex/skills.ts`,
`convex/curated.ts`, `convex/duplicates.ts`, and `convex/crons.ts` when behavior
changes.

## Entry points

A skill row enters our DB one of three ways:

1. **All-time leaderboard** — `syncSkills` walks `GET /api/v1/skills?view=all-time`
   and upserts every row (no install floor; see [MIN_INSTALLS](#removed-min_installs)).
2. **Curated/official set** — `syncCurated` walks `GET /api/v1/skills/curated` and
   ensures each curated skill exists (Pass 0) + stamps `curatedOwner`.
3. **Manual add** — `addSkillManually` (admin-only `/dev/add-skill`) verifies a
   skill against the detail endpoint and inserts it (`leaderboard: "manual"`).
4. **GitHub-only add** — `addSkillFromGitHub` (same admin page, offered only
   after the detail endpoint 404s) verifies a SKILL.md directly in the GitHub
   repo and inserts with `installs: 0`, `leaderboard: "github"`, and
   `isGitHubOnly: true`. See [GitHub-only skills](#github-only-skills).

`leaderboard` is an **origin tag set on insert only** (never overwritten) — it
records how the row first appeared, nothing more. Values: `all-time` (leaderboard),
`curated`, `manual`. Note: `reconcileUnseenSkills` passes `leaderboard: "reconcile"`
to `upsertSkillsBatch`, but reconcile only ever patches **existing** rows (its
stale set is existing summaries), and the tag is set-on-insert only — so
`"reconcile"` is never actually persisted as an origin. It's inert; there is no
"reconcile" origin in the data.

## The jobs (production crons gated by `CRONS_ENABLED`)

| Job | Cadence (UTC) | What it does |
|---|---|---|
| `syncSkills` | daily 06:00 | Walk the full leaderboard; upsert installs + rank + daily snapshot; stamp `lastSeenInApi`. Owns leaderboard installs. |
| `syncCurated` | daily 06:30 | Ensure curated skills exist; stamp `curatedOwner`; clear stale `curatedOwner`. **Does not write installs** (`ownsInstalls:false`). |
| `reconcileUnseenSkills` | daily 07:00 | Keep alive + refresh **healthy off-board** skills via the detail endpoint (installs + snapshot + stamp). Skips broke + dead aliases. **Chains `typesense.syncCatalog` on its terminal exit** (see below). |
| `syncCatalog` (Typesense) | chained off reconcile + daily 09:00 backstop | Mirror the non-delisted catalog into the Typesense search index (mark-and-sweep). See below. |
| `markDelistedSkills` | (chained off syncSkills) | Delist skills unseen for 30 days. |
| `markStaleContent` | (chained off syncSkills) | Re-flag content >7 days old for re-fetch; drives the discovery/content/audit pipeline. |
| `resolveRepoIdentities` | weekly Sun 08:00 | Stamp `githubRepoId` + `repoLiveName` (rename detection) onto **never-resolved** summaries, cached per repo. |
| `refreshCuratedSkills` | weekly Sun 09:00 | Detail-refresh **curated-only** skills (never on the leaderboard) so their count + chart aren't frozen. |
| `reresolveStaleRepoIdentities` | weekly Sun 10:00 | Re-check **already-resolved** repos past their TTL against GitHub; re-stamp summaries when a repo renamed after it was first stamped. |

## "Seen" and delisting

`lastSeenInApi` = the last time any sync touched a skill. It's stamped by
**`syncSkills`, `syncCurated`, `reconcileUnseenSkills`, and `refreshCuratedSkills`**
(and on manual add/relist) — plus, for `isGitHubOnly` rows only, by the content
pipeline itself (see [GitHub-only skills](#github-only-skills)).

- **`markDelistedSkills`** sets `isDelisted = true` on any non-delisted skill whose
  `lastSeenInApi` is older than **30 days** (`DELIST_THRESHOLD_MS`).
- So **delisted = "no sync kept it alive for 30 days."** Note: a skill off the
  leaderboard but kept fresh by `reconcile`/`refreshCuratedSkills` (i.e. healthy)
  never delists. The detail endpoint *is* one of the "seen" signals via reconcile.

**What delisting does** (soft-delete, not a DB delete):
- `isDelisted = true`; hidden from all listing/search/recommendation queries (they
  filter `isDelisted = false`).
- Embedding row deleted (drops it from vector search); leaderboard denorm fields
  cleared; pipeline flags cleared.
- **Row is kept** (~200B summary + skills row) for the delisted count and a
  fast relist. If the skill reappears in a feed, `upsertSkillsBatch` relists it
  (`isDelisted = false`, re-fetch content).

## GitHub-only skills

A skill can be wanted in the catalog while being **absent from skills.sh
entirely** — not on the leaderboard feed *and* 404 on the detail endpoint. The
`/dev/add-skill` form offers this path only as a fallback: it tries
`addSkillManually` first, and on a detail 404 calls `previewGitHubSkill`, which
resolves the SKILL.md in the repo and shows the admin the exact file path +
parsed name to confirm before `addSkillFromGitHub` writes anything. The
confirmation step is deliberate — an automatic fallback would let a mistyped
slug silently bind to the wrong SKILL.md.

**Public add path.** The same pipeline is exposed to any signed-in user via
`addSkillManuallyPublic` (Branch 1, skills.ts) → `previewGitHubSkillPublic` /
`addSkillFromGitHubPublic` (Branch 2, githubOnly.ts), fronted by
`components/add-skill/add-skill-flow.tsx` (the `/add` page + the search
empty-state dialog). The public actions share the admin cores — they only swap
`assertAdmin` for auth and add two things:

- **Attribution.** `addedBy` (a `users` id) is stamped on the genuine-insert
  path only (never relist/adoption, preserving the original adder). It threads
  through `upsertSkillsBatch`.
- **Quota.** Free accounts get `maxGitHubOnlyAdds` (3) GitHub-only adds; Pro is
  unlimited (`convex/lib/plans.ts`). **Normal skills.sh adds (Branch 1) are
  never capped** — they're vetted-by-skills.sh and would sync anyway. The count
  is `addedBy == user AND leaderboard == "github"` via the
  `by_addedBy_leaderboard` index; because `leaderboard` is an immutable origin
  tag, adoption (which only clears `isGitHubOnly`) never distorts it — a stable
  lifetime count. Enforcement is atomic inside `upsertSkillsBatch`
  (`enforceGitHubQuotaFor`), so a double-submit can't race past the cap; the
  action also pre-checks via `getGitHubAddQuota` for a clean early error and the
  preview's "N of M used" indicator.

**Slug aliasing (folder name vs frontmatter name).** skills.sh derives a skill's
slug from its SKILL.md frontmatter `name`, but a pasted GitHub deep link only
carries the SKILL.md's **folder** name — and repos that namespace their skills
make the two differ (`vercel-labs/agent-skills` ships
`skills/react-view-transitions/SKILL.md` named `vercel-react-view-transitions`).
So `previewGitHubCore` applies its priority rule twice: once under the typed
slug, then — only when the resolved file's frontmatter name canonicalises to
something else — again under that alias. The rule itself lives in ONE place
(`terminalFor`), so the two passes cannot drift; it mirrors `manualAddCore`'s
ordering, including the exception that a live **GitHub-only** row must not
short-circuit ahead of the listing check (that row is exactly what the adoption
path exists to upgrade). The alias pass can return `already_exists` (naming the
real row so the UI links it) or `on_skills_sh_as_alias`, which the clients use
to re-run Branch 1 under the slug that actually resolves. Without it, a listed
skill reads as "not on skills.sh".

The **confirm** action re-runs the whole probe, so it can return any of those
same statuses (the listing can appear in the seconds between preview and
confirm, which is what the re-check is for). It RETURNS them rather than
throwing, and the client routes them through one dispatch shared with the
preview — so a refusal at confirm time gets the same alias re-add and the same
sentence as the identical refusal a step earlier. Quota rejections and rate
limits still throw: those aren't verdicts about the skill, and the public flow's
at-limit backstop catches them.

Adopting the alias as a row's **stored identity** is gated harder than merely
checking it, because a `skillId` is permanent and is also a single URL path
segment. All four must hold:

- `canonicalSlug` (convex/lib/skillMatch.ts) accepts it — `^[a-z0-9._-]+$`
  **plus at least one alphanumeric**, so `.`, `..` and `---` are rejected too
  (the charset alone admits them, and `encodeURIComponent` leaves `.` intact,
  so `..` would normalise a segment away in the skills.sh request path).
  `kebabCase` is a comparator that only lowercases and collapses whitespace, so
  `/`, `&`, `(` and friends survive it; persisting one writes a row whose
  detail page 404s forever and whose install command is dropped.
- The file was bound by **folder name** (`matchedBy === "dir"`), i.e. the
  caller pointed at this exact skill. A frontmatter match must never name a
  skill on a write. Since the resolver moved to `matchesSkillIdExactly` this
  gate is belt-and-braces for the write (an exact frontmatter match means the
  name already equals the typed slug), but it still governs whether
  `on_skills_sh_as_alias` may fire, and that status re-runs the add with no
  confirmation.
- **Nothing claims the typed slug.** A delisted row there gets RELISTED (free,
  no quota) rather than orphaned beside a fresh alias row.
- Discovery will still bind the previewed file (`aliasBindsSameFile`) — its
  pass 1 is `skillMdByDir.get(skillId)`, so a different SKILL.md in a folder
  named like the alias would win instead, and the card would have vouched for a
  file the pipeline never fetches. False whenever the tree wasn't listed.

Failing the first two gates keeps the typed slug, which is safe because
discovery's folder pass binds it — with one exception since that pass began
verifying: if the folder-matched file's own name is another batch skill's slug,
the bind is refused and the row ends up contentless rather than wrong. See the
discovery section below.

Failing the LAST gate **refuses the add** (`alias_unverifiable`) instead. This
is the one case where we know the right slug and can't store it, and writing the
typed slug anyway would work in the narrow sense — discovery binds it — while
producing a slug skills.sh never emits, so the row could never be adopted and
reconcile would skip it forever. A permanently stuck row repairable only by
hand is worse than an error, especially since the realistic cause (a rate limit
or a GitHub blip) clears on its own. The refusal carries `cause`, naming the
obstruction rather than the remedy: `"conflict"` is a folder we SAW claim the
alias; `"unlisted"` is a file listing we never got, which `fetchRepoTree` cannot
distinguish between a transient rate limit and a permanently too-large tree — so
the copy hedges instead of promising a retry works. A delisted row already on the
typed slug is exempt: relisting it beats both writing a new row and erroring out.

Note the asymmetry with discovery this closes: discovery's own no-tree fallback
probes `skills/<skillId>/SKILL.md` from the STORED slug, so adopting an alias
without a verified folder list would leave discovery probing a path that doesn't
exist and stamping `skillMdUrl: ""` — a contentless row. Keeping the typed slug
is genuinely the only thing that *works* there, which is why the gate refuses
rather than picking the other slug.

**Finding the ones that slipped through.** `githubOnlyAudit.auditGitHubOnlySlugs` (a
read-only admin **action**, behind a "Run audit" button on `/dev/add-skill`)
walks the `by_isGitHubOnly` index on `skillSummaries` and flags rows whose stored
`skillId` differs from `canonicalSlug(frontmatter name)`. It is **paginated,
newest first**: one call audits up to `AUDIT_PAGE_SIZE` (200) rows and returns a
`cursor`, and the card offers "check the next page" until the cursor comes back
null, accumulating into one report. So the whole population is reachable while
each call stays bounded, and what bounds it is the **fetch loop**: every row
costs a GitHub round trip inside an action that has a time limit. The DB read is
the cheap half (`skillSummaries` rows are ~200 B, and `embeddingCoverageStatsBatch`
pages the same table 1000 at a time). The cursor lives on the client rather than
being persisted: an audit answers "is anything wrong right now", so resuming a
run from hours ago would be a stranger contract than continuing the one in front
of you.

Two ways such a row got written, **both now closed at the source**:

- The add took the folder slug outright, before the alias pass existed. The path
  that kept producing these (an unverifiable alias falling back to the folder
  slug) now refuses instead: `alias_unverifiable`, above.
- A **partial** name bound the file through `matchesSkillId`'s prefix arm while
  the typed slug was kept, so typing `owner/repo/panel` for a skill named
  `panel-review` wrote the row as `panel`. The resolver now uses
  `matchesSkillIdExactly`, so a partial name resolves to nothing and the caller
  gets told the slug must be the folder or the exact name from the file.

So the audit is now looking for history plus insurance against a regression,
rather than for a live leak. Production audited clean in Jul 2026 (zero
mismatches).

The prefix arm itself is untouched for **discovery**, where a loose match is the
safety net for skills.sh's non-obvious slug derivation. A wrong guess there is not
free: it binds the wrong file's URL and the content pipeline serves that body. But
it is **repairable** (tighten the rule, re-run discovery, the row rebinds) and it
never touches the row's identity, which is what made the same looseness
unacceptable on the add path. The two callers are deliberately different; see
`matchesSkillIdExactly`'s doc for why stricter-here is safe and looser-here would
not be.

Rows it can't judge (no discovered URL, fetch failed, gone (404), no frontmatter
`name`, a name that isn't sluggable) are reported separately from mismatches —
"we couldn't look" must not read as "we looked and it's wrong". It only reports;
re-slugging is a per-row human decision, and `githubOnlyAudit.ts`'s header
records why there is deliberately no fix button.

**Why it's an action and not a query.** `skills.content` is NOT the SKILL.md —
`extractBodyContent` strips the YAML frontmatter before storing, so `content` is
the markdown body alone and the frontmatter `name` is recorded nowhere in the
database. An audit reading `content` therefore finds no `name` on any row,
files every one as unjudgeable, and still reports zero mismatches: a false
negative shaped exactly like a clean bill of health. (That was the first
implementation; a run against a real deployment is what caught it.) So the audit
re-fetches each row's stored `skillMdUrl` — the URL discovery already bound,
which means it judges the same file the content pipeline fetches, the one whose
name decides the slug.

The feature lives in **`convex/githubOnly.ts`** (resolver + preview + confirm),
with the slug audit in **`convex/githubOnlyAudit.ts`** and the write policy it
shares with the preview in **`convex/lib/slugDecision.ts`** (pure, unit-tested).
SKILL.md-to-slug matching lives in `lib/skillMatch.ts`, but the two callers there
are deliberately different: the preview uses `matchesSkillIdExactly` (it invents a
permanent slug), discovery keeps the loose `matchesSkillId` (it hunts for the file
behind a slug skills.sh already assigned). They still bind the same file, by ORDER rather than by sharing a rule: discovery
tries the folder, then exact names across EVERY candidate, and only then its
loose loop. The global two-phase shape is the invariant — an earlier version ran
both rules inside one per-file loop, so a loose hit on an early file beat an
exact hit on a later one and the two sides could select different files. The lifecycle
consequences of the flag stay where the lifecycle lives: `skills.ts`
(heartbeat + adoption + cap exemption), `reconcile.ts` (skip), `devStats.ts`
(diagnostics exclusions).

Such a row carries **`isGitHubOnly: true`** (on both the skills row and the
summary, since the hot scans read summaries only) and `installs: 0`.

**Liveness: the GitHub heartbeat.** No skills.sh feed will ever stamp these
rows, so `updateDescription` stamps `lastSeenInApi` itself whenever a raw
SKILL.md fetch succeeds — on the unchanged-hash path too, since identical
content still proves the repo is serving the file. `markStaleContent` re-flags
content every 7 days, comfortably inside the 30-day delist window. **This is
why no delist exemption exists:** if the repo dies, fetches fail, the stamps
stop, and `markDelistedSkills` removes the row on the normal 30-day track.
(Discovery never permanently exhausts for these rows — they're exempt from the
`MAX_DISCOVERY_FAILURES` cap and retry on the rediscovery cadence, since no
feed ever resets their counter — but failed fetches produce no heartbeat
regardless, so the dead-repo path is unchanged.) "Seen" keeps meaning
"something proved it alive"; only the prover changes.

**Reconcile skips them** (`reconcile.ts`, alongside the dead-alias skip): the
detail endpoint can only 404, so a call is pure waste, and an unstamped "gone"
row would otherwise sit at the head of the oldest-first scan forever — the
starvation hazard documented at that batch slice.

**Adoption — two routes.** The moment any skills.sh feed reports the skill,
`upsertSkillsBatch` clears `isGitHubOnly` (the `adopting` branch) and ordinary
rules resume: reconcile refreshes it, `syncSkills` owns its installs and writes
snapshots, the 30-day delist applies normally. Adoption is forced through the
"something changed" sub-case so it can't land in the `nothingChanged` fast path,
which patches `lastSeenInApi` alone and would leave the marker (and reconcile's
skip) set permanently. Matching is purely on `(source, skillId)`, so nothing
else is needed — but the manually-entered source/slug must match what skills.sh
eventually publishes, or you get a second row instead of an adoption.

Feeds alone are NOT a guarantee, though: a skill can be listed on skills.sh
(detail 200) yet absent from every feed — the exact coverage gap manual add
exists for. So `addSkillManually` is the **on-demand adoption route**: its
precheck deliberately does NOT short-circuit to `already_exists` for a live
GitHub-only row; it probes the detail endpoint, and on 200 runs the normal
upsert (which fires the `adopting` transition) and reports `status: "adopted"`.
If detail still 404s, it reports `already_exists` — the row stays GitHub-only.
"Re-run the normal add once it's listed" is therefore a real recovery path, not
just advice.

**What's degraded** (none of it errors): `installs` reads 0 and `installRank` is
unset until adoption; the install chart never renders (too few snapshot points);
audits are permanently `"unknown"` because the audit endpoint 404s (handled
by design in `audits.ts`); Typesense indexes the row but it ranks last on
install-weighted sorts. Content, embeddings, `syncHash` fork/alias detection and
the install command all work unchanged — they were never skills.sh-dependent for
GitHub sources.

## Dead-but-installable skills & the "Fix 2" decision

**The case.** A skill can be **gone from skills.sh** (detail endpoint 404s, off the
leaderboard) while its **GitHub repo still serves SKILL.md**. Our content fetch keeps
succeeding, so it stays `isRefreshHealthy = true`, but `reconcile` can never stamp it
(detail 404s). It just ages out and `markDelistedSkills` removes it at **30 days**.

**Decision (2026-06): the 30-day timer handles this; do NOT add a faster delete.**
A read-only diagnostic (`devStats.countDeadButInstallable`) measured the standing
population on prod at **0** (at 3, 7, and 14 days unseen-but-healthy). The idea we
considered ("Fix 2": treat N consecutive detail-404s as a fast-delete signal) would
only ever shorten the grace period — the same removal already happens at 30 days —
so it trades robustness (against skills.sh outages, and against our own reconcile
stalling) for a fresher catalog, to solve a population that doesn't exist. It's
deferred, not rejected.

**Trigger to revisit (surfaced where you actually look — not buried in logs).** The
daily stats recalc counts this population (`syncStats.deadButInstallable`: healthy +
unseen >7 days) and the **`/dev` dashboard shows it as a stat card** that flips to a
warning badge when it climbs (>20). That's the primary signal — it's ~0 in steady
state, so a non-zero card means skills.sh dropped a batch of skills whose repos are
still alive. (Secondary breadcrumb: `reconcile` also `console.warn`s when a run's
`gone` crosses `RECONCILE_GONE_WARN` (50), for anyone streaming logs to alerting.)
The same buildup is also the **head-of-line starvation** risk noted at reconcile's
batch slice (≥150 such rows clog the oldest-first scan and starve live rows behind
them). To quantify on demand, run `devStats.countDeadButInstallable`.

**Pre-decided design IF it ever becomes real** (so this isn't re-litigated):

- A **consecutive-confirmed-404 counter at ~7 days** — NOT lowering `DELIST_THRESHOLD_MS`.
  The counter acts on positive evidence (skills.sh actually returned 404 N times); a
  shorter blanket timer would also fire when *our* pipeline (reconcile) merely stalls.
- **Exempt `leaderboard: "manual"` skills** — they're deliberate admin curation, the one
  place a fast auto-delete is most likely to be wrong.

## Install-count ownership (who writes `installs`)

The install count has exactly one trustworthy owner per skill state:

- **On the leaderboard** → `syncSkills` (the leaderboard count is authoritative;
  it also sets `installRank` + writes the daily snapshot).
- **Off-board but healthy** (coverage-gap or manually-added) → `reconcileUnseenSkills`
  via the **detail endpoint** (reliable for live skills).
- **Curated-only** (never on the leaderboard) → `refreshCuratedSkills` via the
  detail endpoint, **weekly**.
- **Dead renamed aliases** → nobody refreshes them (detail returns a stale,
  inflated count for a renamed repo's old name — see [dead-alias skip](#dead-alias-skip)).

Why not just use the **curated endpoint's** install number daily (cheap)? Because
the curated feed is a **periodic snapshot**, not a live count. Its `generatedAt`
lags weeks (measured **26 days stale** on 2026-06-23). The numbers are the right
*magnitude* — never inflated — but frozen in the past, so they read low by however
much a skill grew since the snapshot (sampled ratios **0.83-0.99** vs the live
detail count, worst ~15% low for fast-growers like `nuxt/ui`). Two consequences:
(1) writing them over `syncSkills`'s live leaderboard count would drag accurate
counts backward and sawtooth the chart — hence `ownsInstalls:false`; (2) reading
them *daily* buys nothing, since the snapshot only changes ~monthly (you'd get the
same frozen number for weeks, then a step). The **detail** endpoint is live and
exact, so curated-only counts come from there, weekly, to bound per-skill cost.
Re-check `generatedAt` periodically: if skills.sh starts regenerating curated
daily, using it directly could become viable.

## How a skill's SKILL.md gets found (`discoverSkillMdUrls`)

A row stores `source` + `skillId` + name. It does **not** store the file's path,
so the location is re-derived from the slug — at insert, whenever a content fetch
404s (which clears `skillMdUrl` and re-flags `needsDiscovery`), and on the
rediscovery cadence. Any reasoning of the form "we resolved the right file once,
so we're safe" is therefore wrong: the lookup runs repeatedly over a row's life.

Two passes over the repo tree, plus a probe fallback when the tree can't be
listed:

1. **Folder name matches the slug**, then the candidate is **opened and checked**.
   It is rejected only if its own `name` is a *different* known skill's slug
   (`claimedByOtherSkill`, lib/skillMatch.ts). A rejection is **recorded as a
   `(path, slug)` pair** that pass 2 must honour — without that, pass 2's prefix
   arm re-bound the very file pass 1 refused (`matchesSkillId("panel-review",
   "panel")` is true), making the guard a no-op in the exact shape it exists for.
2. **Exact frontmatter name across EVERY remaining candidate**, then and only
   then **the loose `matchesSkillId`** over what is left. The two phases are
   global, not per-file: running both rules inside one per-path loop let a loose
   hit on an early file beat an exact hit on a later one, which is how discovery
   and the (exact-only) preview could bind different files. The loose phase costs
   no extra requests — it reuses the bodies the exact phase already read.

The **tree-unavailable fallback** (409 too large, rate limit) probes the
conventional paths and runs the same check: it fetches the body rather than
issuing a HEAD, because the repos whose trees fail to list are the large
monorepos most likely to hold a leftover folder, and a HEAD cannot read a name.

**What a rejection costs.** The file is not bound to that skill. If nothing else
claims the skill, it ends at `skillMdUrl: ""` — `hasContentFetchError`, an
"Install may fail" badge, a counted discovery failure, and a weekly retry. For a
row that was ALREADY mis-bound, the stale `content` from the other skill's file
is left in place (only the URL is cleared), so the detail page keeps serving it
until a successful re-bind. Clearing content on rejection is not yet done; it
needs a decision about skills legitimately renamed upstream.

Pass 1 used to bind on the folder name alone, without opening the file. That is
wrong whenever one skill's FOLDER is named like a DIFFERENT skill's NAME — which a
repo produces by renaming a skill's folder to match its name and leaving the old
folder behind. The row then serves the other skill's content under a real skill's
name, silently. `vercel-labs/agent-skills` is the near miss: slug
`vercel-react-view-transitions` is bound to `skills/react-view-transitions/SKILL.md`
because pass 1 found no folder of that name and pass 2 verified by name. Had such
a folder existed, pass 1 would have taken it blind.

The check is deliberately **one-directional**, and this is the part not to
"simplify". It does not ask "does this file's name match the slug I expect?"
`kebabCase` cannot reproduce every skills.sh slug derivation — that looseness is
why `matchesSkillId` exists — so a name like `Next.js` (kebab `next.js`) against
slug `nextjs` would fail a self-check and unbind a healthy file, catalog-wide. It
reacts only to a positive claim on someone else's slug. Worst case is a missed
collision; the alternative's worst case is content stripped from working skills.

Known narrowing: "someone else" means the slugs in the batch being resolved, so a
collision with a skill discovered in an earlier run isn't caught.

Cost: pass 1 previously fetched nothing (it read only the tree), and now fetches
one raw file per folder-matched skill, in concurrent waves. Those are
CDN-backed, outside the GitHub API rate limit, and the content pipeline downloads
the same files moments later anyway.

## Content states (independent of delisting)

| State | Meaning | In app? | Content |
|---|---|---|---|
| Healthy | working SKILL.md URL, no fetch error, discovery not exhausted | yes | loads |
| Content-error | 1st content-fetch failure (transient) | yes, "install may fail" badge | last-good |
| Exhausted | discovery failed `MAX_DISCOVERY_FAILURES` (3) times → stop retrying | yes (degraded) | stale/none |

These do **not** delist a skill — an exhausted skill stays listed, just degraded.
It only delists if it *also* goes 30 days unseen. Active installs reset
`discoveryFailCount` (a live repo signal), unsticking a previously-exhausted skill.

## Snapshots (the install chart)

One `skillSnapshots` row per `(skillDocId, day)`, where `day` is the LA-timezone
calendar day. Written by whoever owns installs (`syncSkills`, `reconcile`,
`refreshCuratedSkills`) when `ownsInstalls` is true. **Day pinning:** jobs pin the
day once up front to the LA day of ~06:00 UTC (`appDay(now - 1h)` for the 07:00
jobs), so a run that crosses LA midnight, or a rate-limit reschedule, still files
into one consistent bucket.

## Reconcile = keep-alive for off-board skills

`reconcileUnseenSkills` (daily 07:00):
1. Scan stale rows via the `by_isDelisted_lastSeenInApi` index range
   (`eq("isDelisted", false).lt("lastSeenInApi", cutoff)`, cutoff =
   **`RECONCILE_FRESHNESS_MS` (23h)** pinned once per run) — reads only the stale
   set, not the whole catalog. The same index backs `markDelistedSkills`' 30-day
   scan. Both `isDelisted` and `lastSeenInApi` are **required** fields, so the
   range has no `undefined` edge case (see Migration notes).
2. Keep only **healthy** (`hasSkillMdUrl && !hasContentFetchError &&
   discoveryFailCount < 3`), **not a dead alias** (`repoLiveName === source`),
   and **not `isGitHubOnly`** (detail can only 404 for those — see
   [GitHub-only skills](#github-only-skills)).
3. Detail-refresh each (installs + snapshot + stamp), batched (`RECONCILE_BATCH`),
   self-scheduling. Broke/dead-alias skills are left unstamped → they delist.
4. Safety cap: if the stale set exceeds `MAX_RECONCILE` (3000), bail (a sign
   `syncSkills` itself failed) rather than mass-hit the API.

**Why 23h (must be < 24h):** the reconcile both refreshes its skills *and* runs
every 24h. If the freshness window were ≥ 24h, a skill it stamped yesterday would
read as "fresh" the next day and get skipped — refreshing only every *other* day
and leaving chart gaps. 23h leaves buffer for cron jitter while staying under 24h.

## Typesense search mirror (`syncCatalog`)

The home + picker search is served **browser-direct from a self-hosted Typesense**
(Railway), not from Convex. `typesense.syncCatalog` keeps that index a mirror of
the non-delisted catalog. It's the **terminal step of the daily pipeline** — the
detailed engine contract lives in `docs/search-overhaul.md`; what matters for the
lifecycle:

- **Scheduling.** NOT a fixed-time cron primarily: `reconcileUnseenSkills` chains
  it on its terminal exit (`reconcile.ts` `chainTypesenseSync`, gated on
  `CRONS_ENABLED` and skipped on `dryRun`), so it indexes installs/delist flags
  only after they've settled for the day. A **daily 09:00 backstop cron** exists
  because Convex doesn't retry actions — if reconcile throws mid-flight its chain
  link never fires, and the backstop bounds staleness to ~24h.
- **Run lock.** A single-row `typesenseSyncLock` table serializes runs: two
  overlapping mark-and-sweep walks could cross-stamp and delete live docs, so a
  second start is a loud no-op (and the backstop overlapping the chained run is
  therefore free). Released on every terminal exit AND on throw; a stale lock past
  a 1h TTL is stealable.
- **Mark-and-sweep.** Every non-delisted summary is upserted stamped with the run's
  start time; a doc left with an older stamp (delisted / renamed away) is swept.
  The walk uses the **immutable `by_isDelisted` index** (not `by_isDelisted_installs`)
  so a concurrent `installs` write can't reorder it and skip a live row. A doc that
  fails to import keeps its old stamp and is **excluded from the sweep** (by id) so
  it isn't dropped while live; only a mass failure (> `SWEEP_EXCLUDE_CAP`) skips the
  sweep wholesale. **The mirror can strand a stale doc for a run, but never deletes a
  live one.** A schema/validator mismatch is caught loudly at start by
  `assertSchemaMirror`.

## Duplicate / rename detection (Phase 2)

**Two unrelated notions of "duplicate" — don't conflate them:**
- **`isDuplicate`** is skills.sh's *own upstream fork flag*, mirrored onto the row.
  It only default-filters a row out of list/search/recommendations. We don't
  compute it.
- **Phase 2 (`copyCount` / `getSkillCopies`)** is *our* content/rename detection
  below. It powers the "N copies" chip and the detail-page "Also available at".

They're independent: a row can be `isDuplicate: false` yet have `copyCount > 0`
(it has aliases/forks but skills.sh didn't flag it), or vice versa. The rest of
this section is only about the Phase 2 notion.

Two relationships, two signals (install count is **not** used — a dead alias can
have the most installs):

- **Aliases** (same repo, renamed): `resolveRepoIdentities` resolves each GitHub
  source to its stable `githubRepoId` + current `repoLiveName` (a renamed repo
  301-redirects to its live name, same id). Same `repoId` + slug under different
  `source` = aliases; the live one is the `source` matching `repoLiveName`.
  `resolveRepoIdentities` finds its work via the `needsRepoResolution` flag (set
  true on GitHub-row insert, cleared when stamped) + the `by_needsRepoResolution`
  index — the same work-set pattern as `needsDiscovery`/`needsContentFetch`/etc.,
  so it reads only unresolved rows instead of scanning the catalog. It stamps each
  **once**; `reresolveStaleRepoIdentities` re-checks aged repos (TTL
  `RERESOLVE_TTL_MS`) to catch a repo that renames *after* it was first stamped
  (see edge cases).
- **Forks** (different repos, same content): same `syncHash` across different
  `githubRepoId`.

`copyCount` (aliases + forks) is denormalized onto each summary for the list
"N copies" marker. It's maintained solely by the weekly `computeCopyCounts`
full-recompute (chained off `resolveRepoIdentities`) — see the `copyCount`
maintenance edge case below.
`getSkillCopies(source, skillId)` returns `{ renamedTo, aliases, forks }` at
request time via two indexed lookups (`by_repo_skill`, `by_syncHash`).

**UI** (`skill-detail-page.tsx`, `skill-copies.tsx`, `skill-card.tsx`):
- Renamed alias → info banner linking to the live skill.
- "Also available at" section: "Other names for this repo" (aliases) + "Different
  repos, same content" (forks).
- List/search rows → quiet "N copies" chip when `copyCount > 0`.

### Dead-alias skip

`reconcile` and `getSkillCopies`/`copyCount` skip dead aliases
(`repoLiveName` set and ≠ `source`). The detail endpoint serves a stale, inflated
count for a renamed repo's old name (e.g. qu-skills detail = 320k vs real ~12), so
refreshing from it would re-introduce inflation. Dead aliases are duplicates of
the live repo; off-board ones simply delist.

## Edge cases & known non-issues

- **Curated endpoint installs unreliable** → curated-only counts come from detail
  (weekly), not the curated feed. (See ownership above.)
- **Detail unreliable for renamed aliases** → handled by the dead-alias skip.
- **Exhausted-stuck**: a skill that breaks (exhausted) then recovers but gets no
  new installs is never retried (`markStaleContent` only re-flags on activity).
  Rare; not currently fixed. A fix would be a periodic forced retry of exhausted
  skills.
- **`addSkillManually` seeds from detail** → manually adding a *renamed alias*
  would seed an inflated count. Admin-only + you'd add the live skill, so treated
  as a non-scenario (unfixed).
- **Weekly resolution lag**: a newly renamed/forked relationship isn't grouped
  until the weekly `resolveRepoIdentities` runs (it's GitHub-rate-limited; repos
  rarely rename). `copyCount` runs after resolution, so weekly is the right cadence.
  Same lag has a re-inflation edge: a just-renamed repo whose old-name row is
  **off the leaderboard and not yet resolved** has `repoLiveName === undefined`,
  so the reconcile dead-alias skip doesn't fire yet and reconcile can re-fetch
  its inflated detail count for up to a week (exactly the qu-skills inflation the
  skip prevents). Self-corrects at the next resolve; mitigated because an old
  name still *on* the leaderboard is owned by `syncSkills` (never stale), so the
  window only applies to already-off-board renames.
- **`copyCount` maintenance**: `copyCount` is a denormalized counter maintained by
  a single mechanism — `resolveRepoIdentities` chains a full `computeCopyCounts`
  recompute **unconditionally** at the end of its weekly run, which revisits every
  non-delisted row. So any drift heals within ~7 days: a delist or relist changing
  a peer's group, a syncHash change on content re-fetch, etc. (There is no
  incremental delist decrement — it was removed in favor of this one recompute.)
  `reresolveStaleRepoIdentities` chains the recompute only on an actual repo-id
  *transition* (a plain rename doesn't move group membership), so a normal
  re-resolve adds **no second full scan**. The full pass covers up to
  `FULL_SCAN_MAX_ROWS`; it `console.warn`s (never logs "done") if the catalog
  outgrows that, so truncation is never silent. The detail page is independent of
  the counter — `getSkillCopies` filters delisted rows at request time, so it's
  always correct; only the cached list chip relies on `copyCount`, and it can read
  one high for up to a week after a delist until the recompute heals it.
- **Rename after stamping** (handled by `reresolveStaleRepoIdentities`): a repo
  renamed *after* we first resolved it would otherwise keep a stale
  `repoLiveName == source` forever — never recognized as a dead alias, so its
  off-board old-name row would never delist (reconcile keeps it alive) and could
  be re-inflated from the detail endpoint. The weekly re-resolution re-checks
  aged repos and re-stamps their summaries; once the old name's `repoLiveName`
  flips to the live name, reconcile skips it and it delists on the 30-day track.
  Detection cadence is ~2-3 weeks (TTL paired with the weekly cron), acceptable
  for a rare event whose only symptom is a single dead-alias page.

## Tuning constants

| Constant | Value | Where |
|---|---|---|
| install floor | **removed** (was `MIN_INSTALLS = 50`) | `syncSkills` ingests the full leaderboard |
| `RECONCILE_FRESHNESS_MS` | 23h (must be < 24h cron interval) | `reconcile.ts` |
| `MAX_RECONCILE` | 3000 (bail = likely broken sync) | `reconcile.ts` |
| `RECONCILE_BATCH` | 150 | `reconcile.ts` |
| `DELIST_THRESHOLD_MS` | 30 days | `skills.ts` |
| `MAX_DISCOVERY_FAILURES` | 3 | `devStats.ts` |
| `RERESOLVE_TTL_MS` | 14 days (re-check a resolved repo's identity at most this often) | `duplicates.ts` |
| `RESTAMP_CAP` | 200 (max summaries re-stamped per repo) | `duplicates.ts` |
| `FULL_SCAN_MAX_ROWS` | 60000 (catalog headroom; sizes the computeCopyCounts continuation cap; warns if exceeded) | `duplicates.ts` |

## Migration notes

**`lastSeenInApi` + `isDelisted` are required** (not optional) on `skillSummaries`,
and `by_isDelisted_lastSeenInApi` indexes them together. This lets the staleness
scans read only the stale set (`eq("isDelisted", false).lt("lastSeenInApi", cutoff)`)
instead of scanning the whole catalog and filtering in memory — and removes the
`undefined` edge cases that made an indexed range risky (an `undefined` would
otherwise be missed by `eq(false)` or wrongly swept in by an open `lt`).

Tightening an optional field to required is a **two-phase** migration, because
Convex validates the whole dataset on the deploy that tightens the schema:
1. **Backfill first** (schema still optional): `backfillLastSeenInApi` and the
   pre-existing `backfillIsDelistedFalse` (which covers both skills and summaries).
   Idempotent; both reported 0 on prod — every row already had a value, since the
   sole insert path sets them.
2. **Then tighten** the schema + add the index + switch the scans, in the next
   deploy. The required types now force every future insert to provide the
   fields, so the invariant can't regress (there's one insert path:
   `upsertSkillSummary`, which defaults `lastSeenInApi` to now and `isDelisted`
   to false). Re-run order matters: never tighten before the backfill has run.

When adding the next required field, follow the same backfill-then-tighten order.

<a id="removed-min_installs"></a>
### Removed: MIN_INSTALLS

`syncSkills` used to drop leaderboard rows under 50 installs. Removed because (a)
it barely filtered anything (~99% of leaderboard rows are 500+), and (b) it
stranded existing rows that dropped below it (e.g. a renamed repo collapsing to
~12 installs would freeze at its old inflated count). The sync now ingests the
full leaderboard.
