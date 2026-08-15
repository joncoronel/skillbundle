# Plan 007: Bound the `/dev` dashboard queries against Convex read caps

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a0cea73..HEAD -- convex/devStats.ts convex/schema.ts`
> If an in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `a0cea73`, 2026-07-18

## Why this matters

Several admin `/dev` dashboard queries `.collect()` entire index ranges of
`skillSummaries` with no bound. The delisted population is intentionally
retained forever and only grows; the no-URL set can reach thousands. Convex
hard-fails a query that reads too many documents (8k+ rows / 16 MB), so as
these sets grow the dashboard panels stop degrading and start _erroring_.
The module's own `TODO` comment at `convex/devStats.ts:540` flags exactly
this. The repo already has the right pattern in the same file —
`countDeadButInstallable` uses `.take(COUNT_SCAN_CAP)` plus a `truncated`
flag — this plan applies it to the remaining unbounded sites and adds the
compound index the TODO asks for.

## Current state

- `convex/devStats.ts` — admin/dev dashboard stats (all public queries here
  call `assertAdmin(ctx)` first; don't touch that).

- `convex/devStats.ts:336-436` — `listSkillsWithErrors` (admin query): a
  `switch (filter)` with six branches, each shaped like:

```ts
      case "delisted": {
        const results = await ctx.db
          .query("skillSummaries")
          .withIndex("by_isDelisted", (q) => q.eq("isDelisted", true))
          .collect();
        skills = results.filter((s) => s.skillDocId).map(mapSummary);
        break;
      }
```

The `noUrlRetrying` / `noUrlExhausted` branches additionally post-filter
on `(s.discoveryFailCount ?? 0) < / >= MAX_DISCOVERY_FAILURES` after
collecting the whole `by_hasSkillMdUrl = false` range.

- `convex/devStats.ts:538-549` — `retryBatch`'s `noUrlExhausted` branch,
  with the self-diagnosing TODO:

```ts
// TODO: .collect() is unbounded — risks Convex's 16k doc limit if the no-URL set
// grows large. Consider an index on (hasSkillMdUrl, discoveryFailCount) or paginating.
const summaries = await ctx.db
  .query("skillSummaries")
  .withIndex("by_hasSkillMdUrl", (q) => q.eq("hasSkillMdUrl", false))
  .collect();
const exhausted = summaries
  .filter((s) => (s.discoveryFailCount ?? 0) >= MAX_DISCOVERY_FAILURES)
  .slice(0, 200);
```

- The in-file exemplar pattern (`convex/devStats.ts:300-325`,
  `countDeadButInstallable`): `.take(COUNT_SCAN_CAP)` and returns
  `truncated: stale.length === COUNT_SCAN_CAP`.

- `convex/schema.ts:227-245` — `skillSummaries` index list; it has
  `.index("by_hasSkillMdUrl", ["hasSkillMdUrl"])` but no compound
  `(hasSkillMdUrl, discoveryFailCount)` index.

- The dashboard UI (`app/(main)/dev/dev-dashboard-content.tsx`) renders
  whatever list it receives — a capped list renders fine. Do not modify it
  in this plan (an optional "showing first N" note is a follow-up).

- Caveat for the compound index: `discoveryFailCount` is an **optional**
  field. Convex orders missing values before all numbers in an index, and
  a range like `.gte("discoveryFailCount", MAX_DISCOVERY_FAILURES)` will
  simply exclude rows where the field is unset — which matches the current
  post-filter semantics (`(s.discoveryFailCount ?? 0) >= 3` is false when
  unset). Verify this equivalence in the test step.

## Commands you will need

| Purpose   | Command            | Expected on success |
| --------- | ------------------ | ------------------- |
| Typecheck | `npx tsc --noEmit` | exit 0              |
| Tests     | `pnpm test`        | all pass            |
| Lint      | `pnpm lint`        | exit 0              |

## Scope

**In scope** (the only files you should modify):

- `convex/devStats.ts`
- `convex/schema.ts` (one added index on `skillSummaries` only)
- `tests/devstats-bounds.test.ts` (create)

**Out of scope** (do NOT touch):

- `convex/skills.ts` — `listUnembeddable`'s full-table filter scan is a
  related but separate issue (see Maintenance notes).
- `app/(main)/dev/**` — UI unchanged.
- Any non-`skillSummaries` schema table.
- The other `retryBatch` branches and `retryContentFetch`/`retryDiscovery`
  (they operate on single rows or already-bounded sets).

## Git workflow

- Branch: `advisor/007-devstats-bounded-reads`
- Conventional commit, e.g. `fix: bound /dev dashboard scans and index exhausted discovery`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the compound index

In `convex/schema.ts`, on the `skillSummaries` table, directly after the
existing `.index("by_hasSkillMdUrl", ["hasSkillMdUrl"])` line, add:

```ts
    .index("by_hasSkillMdUrl_discoveryFailCount", [
      "hasSkillMdUrl",
      "discoveryFailCount",
    ])
```

**Verify**: `npx tsc --noEmit` → exit 0

### Step 2: Cap the panel query

In `listSkillsWithErrors`, define `const LIST_CAP = 1000;` near the handler
and change every branch's `.collect()` to `.take(LIST_CAP)`. For the
`noUrlRetrying` / `noUrlExhausted` branches, switch to the new compound
index so the fail-count condition is index-level instead of post-filter:

```ts
      case "noUrlExhausted": {
        const results = await ctx.db
          .query("skillSummaries")
          .withIndex("by_hasSkillMdUrl_discoveryFailCount", (q) =>
            q.eq("hasSkillMdUrl", false).gte("discoveryFailCount", MAX_DISCOVERY_FAILURES),
          )
          .take(LIST_CAP);
        skills = results.filter((s) => s.skillDocId).map(mapSummary);
        break;
      }
```

(`noUrlRetrying` uses `.lt(...)` — note this now EXCLUDES rows with
`discoveryFailCount` unset, which the old `?? 0` post-filter INCLUDED. To
preserve behavior, `noUrlRetrying` must keep reading the plain
`by_hasSkillMdUrl` index with the post-filter, just `.take(LIST_CAP)`d.
Only `noUrlExhausted` moves to the compound index.)

**Verify**: `npx tsc --noEmit` → exit 0

### Step 3: Fix `retryBatch`'s exhausted branch

Replace the collect-then-filter-then-slice with the compound index:

```ts
const exhausted = await ctx.db
  .query("skillSummaries")
  .withIndex("by_hasSkillMdUrl_discoveryFailCount", (q) =>
    q
      .eq("hasSkillMdUrl", false)
      .gte("discoveryFailCount", MAX_DISCOVERY_FAILURES),
  )
  .take(200);
```

Delete the now-obsolete TODO comment. Keep the per-row patch loop unchanged.

**Verify**: `npx tsc --noEmit` → exit 0; `pnpm lint` → exit 0

### Step 4: Tests

Create `tests/devstats-bounds.test.ts` with `makeTest()` from
`tests/_setup.ts`. Seed (via `t.run`) a handful of `skillSummaries` rows
covering: `hasSkillMdUrl: false` with `discoveryFailCount` 0, 2, 3, 5, and
one with the field **unset**; plus a matching `skills` row each so
`skillDocId` is set (copy field shapes from seeds in
`tests/staleness-scan.test.ts` or `tests/skills-chain.test.ts`).

Then call `t.mutation(internal.devStats.retryBatch, { filter: "noUrlExhausted" })`
and assert: rows with failCount 3 and 5 were reset
(`needsDiscovery: true`, `discoveryFailCount: 0`), rows with 0/2/unset were
untouched, and the returned `count` is 2.

Admin note: `retryBatch` is an `internalMutation` — callable directly via
`t.mutation(internal....)` without admin identity. Do NOT test
`listSkillsWithErrors` (it needs `assertAdmin` + `ADMIN_EMAILS` env
plumbing — out of scope; the semantics-preserving change there is covered
by typecheck + the equivalence reasoning in Step 2).

**Verify**: `pnpm test tests/devstats-bounds.test.ts` → passes

### Step 5: Full suite

**Verify**: `pnpm test` → all pass

## Test plan

Covered in Step 4: index-range equivalence with the old `?? 0` post-filter
for the exhausted branch (the unset-field row is the tricky case).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx tsc --noEmit` exits 0; `pnpm lint` exits 0
- [ ] `pnpm test` exits 0; `tests/devstats-bounds.test.ts` exists and passes
- [ ] `grep -c "\.collect()" convex/devStats.ts` is lower than before the
      change, and `grep -n "collect()" convex/devStats.ts` shows none inside
      `listSkillsWithErrors` or `retryBatch`
- [ ] `grep -n "by_hasSkillMdUrl_discoveryFailCount" convex/schema.ts` → 1 match
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The cited code has drifted from the excerpts.
- The Step 4 test shows the compound-index range does NOT match the old
  post-filter semantics for the unset-field row — report the discrepancy;
  do not silently change which rows get reset.
- Adding the index causes convex-test schema validation failures you can't
  resolve by matching existing index declaration syntax.

## Maintenance notes

- Deploying a schema index change makes Convex backfill the index on deploy
  — instant at this table size, but the deployer should know why the deploy
  mentions an index build.
- Deferred, related: `convex/skills.ts:2187-2193` `listUnembeddable` does a
  full-table `.filter().collect()` (no index on `embeddingSkipReason`).
  Result-capping it doesn't bound the scan; a real fix needs an index or a
  denormalized flag — small separate plan if the embedding-skip population
  grows.
- If a panel ever legitimately needs more than `LIST_CAP` rows, the right
  move is cursor pagination (`.paginate()`), not raising the cap.
