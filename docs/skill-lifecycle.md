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
| `reconcileUnseenSkills` | daily 07:00 | Keep alive + refresh **healthy off-board** skills via the detail endpoint (installs + snapshot + stamp). Skips broke + dead aliases. |
| `markDelistedSkills` | (chained off syncSkills) | Delist skills unseen for 30 days. |
| `markStaleContent` | (chained off syncSkills) | Re-flag content >7 days old for re-fetch; drives the discovery/content/audit pipeline. |
| `resolveRepoIdentities` | weekly Sun 08:00 | Stamp `githubRepoId` + `repoLiveName` (rename detection) onto **never-resolved** summaries, cached per repo. |
| `refreshCuratedSkills` | weekly Sun 09:00 | Detail-refresh **curated-only** skills (never on the leaderboard) so their count + chart aren't frozen. |
| `reresolveStaleRepoIdentities` | weekly Sun 10:00 | Re-check **already-resolved** repos past their TTL against GitHub; re-stamp summaries when a repo renamed after it was first stamped. |

## "Seen" and delisting

`lastSeenInApi` = the last time any sync touched a skill. It's stamped by
**`syncSkills`, `syncCurated`, `reconcileUnseenSkills`, and `refreshCuratedSkills`**
(and on manual add/relist).

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
   discoveryFailCount < 3`) **and not a dead alias** (`repoLiveName === source`).
3. Detail-refresh each (installs + snapshot + stamp), batched (`RECONCILE_BATCH`),
   self-scheduling. Broke/dead-alias skills are left unstamped → they delist.
4. Safety cap: if the stale set exceeds `MAX_RECONCILE` (3000), bail (a sign
   `syncSkills` itself failed) rather than mass-hit the API.

**Why 23h (must be < 24h):** the reconcile both refreshes its skills *and* runs
every 24h. If the freshness window were ≥ 24h, a skill it stamped yesterday would
read as "fresh" the next day and get skipped — refreshing only every *other* day
and leaving chart gaps. 23h leaves buffer for cron jitter while staying under 24h.

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
  `resolveRepoIdentities` only stamps **never-resolved** rows, so
  `reresolveStaleRepoIdentities` re-checks aged repos (TTL `RERESOLVE_TTL_MS`) to
  catch a repo that renames *after* it was first stamped (see edge cases).
- **Forks** (different repos, same content): same `syncHash` across different
  `githubRepoId`.

`copyCount` (aliases + forks) is denormalized onto each summary for the list
"N copies" marker. It's maintained incrementally (delist decrement) with a
conditional `computeCopyCounts` full-scan backstop — see the `copyCount`
maintenance edge case below.
`getSkillCopies(source, skillId)` returns `{ renamedTo, aliases, forks, copyCount }`
at request time via two indexed lookups (`by_repo_skill`, `by_syncHash`).

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
- **`copyCount` maintenance**: `copyCount` is a denormalized counter, kept fresh
  two ways: (1) `delistSkillsBatch` decrements a delisted row's peers immediately
  (bounded by `COPYCOUNT_DECREMENT_BUDGET` / `COPYCOUNT_PEER_CAP`), so the common
  drift (a peer delists) heals at once; (2) `resolveRepoIdentities` chains a full
  `computeCopyCounts` pass **unconditionally** at the end of its weekly run — the
  guaranteed backstop that corrects any residual drift within ~7 days (a relist
  rejoining a group, capped-budget overflow on a large fork-group delist, a
  syncHash change on content re-fetch). `reresolveStaleRepoIdentities` chains the
  recompute only on an actual repo-id *transition* (a plain rename doesn't move
  group membership), so a normal re-resolve adds **no second full scan** — that
  was the only duplicate-work concern. The detail page is independent of the
  counter entirely — `getSkillCopies` filters delisted rows at request time, so
  it's always correct; only the cached list chip relies on `copyCount`.
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
| `RECONCILE_FRESHNESS_MS` | 23h (must be < 24h cron interval) | `skills.ts` |
| `MAX_RECONCILE` | 3000 (bail = likely broken sync) | `skills.ts` |
| `RECONCILE_BATCH` | 150 | `skills.ts` |
| `DELIST_THRESHOLD_MS` | 30 days | `skills.ts` |
| `MAX_DISCOVERY_FAILURES` | 3 | `devStats.ts` |
| `RERESOLVE_TTL_MS` | 14 days (re-check a resolved repo's identity at most this often) | `duplicates.ts` |
| `RESTAMP_CAP` | 200 (max summaries re-stamped per repo) | `duplicates.ts` |
| `COPYCOUNT_PEER_CAP` | 64 (max peers decremented per delisted row) | `skills.ts` |
| `COPYCOUNT_DECREMENT_BUDGET` | 1500 (max peer copyCount writes per delist batch) | `skills.ts` |

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
