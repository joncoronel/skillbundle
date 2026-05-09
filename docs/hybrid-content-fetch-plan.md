# Hybrid content-fetch plan (deferred)

Written 2026-05-07 as a fallback option in case skills.sh doesn't ship `hash`
on the listing endpoint. Don't act on this unless the criteria below are met.

## Context

After migrating from the GitHub-scraping pipeline to the v1 API, we kept the
v1 detail endpoint (`/api/v1/skills/{source}/{slug}`) for both first-time
fetches and any future content refresh. That endpoint returns the entire
skill folder (`files[]` with every example, reference, script, etc.) when we
only use SKILL.md. Two costs:

- ~1MB+ per fetch (vs ~30KB if we only got SKILL.md)
- ~3-4x parse-peak memory pushed us past Convex's 64MB per-action heap; we had
  to drop to sequential (concurrency=1) processing as a band-aid

We sent skills.sh a feature request asking for `hash` on the listing
response. If they ship it, we can detect content changes during the daily
listing sweep and only call detail when something actually changed. That
solves the problem.

This plan is what to do if they don't.

## Decision criteria — when to actually implement

Implement the hybrid only if **all** of these are true:

1. ~3+ weeks have passed since the email and skills.sh hasn't shipped
   `hash` on listing or a metadata-only endpoint.
2. We need to refresh content periodically (the current "fetch once, never
   refresh" stance is causing visible drift in skill descriptions/content).
3. The pure-v1 rolling refresh (~12GB/week of action-side bandwidth) is
   actually causing problems (Convex usage warnings, perf complaints, etc).

Otherwise, leave it alone. The simplification we gained from removing the
old GitHub pipeline isn't worth the maintenance burden of two fetch paths
unless we're being forced into it.

## Architecture

Three fetch paths, each with a clear job:

| Path | When | Endpoint | Cost |
|---|---|---|---|
| A | Daily discovery | `GET /api/v1/skills?view=all-time` | Cheap (~17 calls) |
| B | First content fetch | `GET /api/v1/skills/{source}/{slug}` | Heavy but rare |
| C | Periodic content refresh | `GET https://raw.githubusercontent.com/{source}/{branch}/{path}` | Light (~30KB) |

For well-known sources (`mintlify.com`, `bun.sh`, etc.), path C doesn't
exist — they have no GitHub URL. For those, path B is the only option for
both first fetch AND refresh. We just live with the cost; there are only
~165 well-known skills total.

## Implementation plan

### Schema changes

Add to `skills` and `skillSummaries`:

```ts
skillMdPath: v.optional(v.string()),  // e.g. "skills/foo/SKILL.md"
defaultBranch: v.optional(v.string()), // e.g. "main"
```

Both populated on the first v1 detail fetch. Used by path C to build the
raw URL on subsequent refreshes.

### `convex/lib/skillsApi.ts` (modify)

Update `getSkillSyncData` to also return the `path` of the SKILL.md file
inside `files[]`:

```ts
export async function getSkillSyncData(source, slug): Promise<{
  hash: string | null;
  skillMdContents: string | null;
  skillMdPath: string | null;
}>
```

### `convex/lib/githubRaw.ts` (new, ~50 lines)

```ts
export async function fetchSkillMdRaw(
  source: string,
  branch: string,
  path: string,
): Promise<{ contents: string | null; status: number }>
```

- Fetches `https://raw.githubusercontent.com/{source}/{branch}/{path}`
- Uses `GITHUB_TOKEN` env var if present (5000/hr authenticated)
- Returns null contents on 404 (signals path moved/file deleted)
- Returns null with status -1 on network error

### `convex/skills.ts` (modify `fetchSkillDetailBatch`)

Branching logic per skill:

```
if existing skillMdPath AND skill is GitHub source:
  fetch via raw URL (path C)
  if 404: clear skillMdPath, fall through to path B
  if 200: compute SHA-256(contents), compare to stored syncHash
    if match: skip parse/embed/write, just touch contentFetchedAt
    if differ: parse, write, queue re-embed, update syncHash to new SHA-256
else:
  fetch via v1 detail (path B)
  store skillMdPath + defaultBranch on success
```

Note: when going through path C, we compute and store our own SHA-256 of
SKILL.md contents (not skills.sh's bundle hash). This is fine because we
only use SKILL.md anyway. Going forward, path C and path B both write a
hash but they're different schemes; distinguish by prefix or just trust
that whichever path we used last wins.

### Resolving `defaultBranch`

The v1 detail response doesn't expose the repo's default branch. Three options:

1. One-time GitHub API call per repo: `GET /repos/{owner}/{repo}` → `default_branch`. Cache per repo for 30 days in a small table or memoize per source. Costs ~17 calls per refresh wave (one per distinct repo, not per skill).
2. Try `main` first, fall back to `master` if 404. Wrong for repos using other branch names but they're rare.
3. Skip — always re-fetch via v1 detail to get the latest path.

Option 1 is cleanest. Option 2 is fine if we want to skip the GitHub API
entirely — just slightly more 404 traffic.

### Refresh schedule

Weekly cron (`convex/crons.ts`):

```ts
crons.weekly(
  "refresh stale skill content",
  { dayOfWeek: "sunday", hourUTC: 7, minuteUTC: 0 },
  internal.skills.refreshStaleContent,
);
```

`refreshStaleContent` would:
- Walk `skillSummaries` where `contentFetchedAt` is >7 days old AND not delisted
- Set `needsContentFetch: true` for each
- Schedule `fetchSkillDetailBatch` (which now uses the hybrid path logic above)

Bandwidth math:
- 12k active skills × ~30KB raw = ~360MB/week
- ~165 well-known × ~1MB = ~165MB/week
- Total: ~525MB/week ≈ 2GB/month action-side
- vs pure v1 weekly: ~12GB/week ≈ 50GB/month
- 25x reduction

### Edge cases

**SKILL.md moved within repo:**
- Path C fetch returns 404
- We clear `skillMdPath` and fall through to path B
- Path B succeeds (skills.sh's snapshot finds the new location)
- We learn the new path, store it, future refreshes use new path

**Repo deleted entirely:**
- Path C fetch returns 404
- Falls through to path B
- v1 detail returns 404 too (skill is gone from the API)
- Marked as `hasContentFetchError`
- Eventually drops out of the listing → 30-day delist logic catches it

**Default branch renamed:**
- Cached `defaultBranch` becomes wrong → 404 on path C
- Falls through to path B (re-fetches via skills.sh)
- Re-resolve default branch on next access

**Rate-limited by GitHub (5000/hr authenticated):**
- Unlikely with sequential or low-concurrency refresh
- If it happens, fall back to path B (slower but no GitHub limit)

## What we'd add back from the old pipeline

About 150 lines total:
- `lib/githubRaw.ts` — direct raw fetch (~50 lines)
- Path-aware logic in `fetchSkillDetailBatch` (~50 lines)
- Default branch resolution + caching (~30 lines, only if option 1)
- Refresh cron action (~20 lines, just calls existing flag-and-schedule)

Code we explicitly would NOT bring back:
- `discoverSkillMdUrls` — v1 detail already tells us the path on first fetch
- `backfillDiscoverUrls` — scaffolding for the old discovery state machine
- `markStaleContentBatch` (old version) — superseded by simpler refresh cron
- The 7-day re-discovery interval logic — we don't have a discovery phase anymore

## Things to remember when implementing

- **Compute hash on raw response, not v1 detail.** When path C succeeds, the
  response is just SKILL.md text, not a JSON wrapper. SHA-256 over the raw
  text. Compare to stored `syncHash`.
- **Don't write `syncHash` from path C and path B interchangeably without
  thought.** They're hashing different things. If we go path B → store
  bundle hash. Path C → store SKILL.md-only hash. Decide once and stick
  with it (probably "always SKILL.md-only" since that's what we use).
- **Mind the existing `hasContentFetchError` semantics.** Don't double-flag
  rows that are in the error bucket. The retry logic should be: error →
  next refresh wave attempts again → if path C 404 falls through to path B
  → if both fail, stays errored.
