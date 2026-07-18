# Plan 003: Record content-fetch failures when the fetch throws, not only on HTTP errors

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a0cea73..HEAD -- convex/skills.ts tests/`
> If `convex/skills.ts` changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `a0cea73`, 2026-07-18

## Why this matters

`fetchSkillContent` records a failure in the database when the SKILL.md URL
returns an HTTP error (`!res.ok` → `markContentFetchFailed`), but when
`fetch` *throws* (DNS failure, connection refused, TLS error, timeout) it
retries 3 times, logs to console, and writes **nothing**. The skill's
`needsContentFetch` stays `true` forever, so a permanently unreachable host
is re-fetched every daily sync cycle; the user-facing "install may fail"
badge (driven by `hasContentFetchError`) never shows; and the
2-consecutive-failures rediscovery path never triggers. A host returning a
500 and a host that doesn't resolve should follow the same failure path —
today they diverge. This is a one-branch fix plus a test.

## Current state

- `convex/skills.ts` — the skill sync pipeline (3,389 lines). Only the
  `fetchSkillContent` action changes.

`convex/skills.ts:1109-1162` — the action as it exists today. Note the
`!res.ok` branch records the failure and returns, while the final `catch`
branch only logs:

```ts
export const fetchSkillContent = internalAction({
  args: {
    skillId: v.id("skills"),
    skillMdUrl: v.string(),
    skillName: v.optional(v.string()),
  },
  handler: async (ctx, { skillId, skillMdUrl, skillName }) => {
    const label = skillName ?? skillId;
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(skillMdUrl);
        if (!res.ok) {
          console.error(
            `Failed to fetch content for ${label}: ${res.status}`,
          );
          await ctx.runMutation(internal.skills.markContentFetchFailed, {
            skillId,
          });
          return;
        }
        // ... success path: updateDescription / markContentFetched ...
        return;
      } catch (e) {
        if (attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        } else {
          console.error(
            `Error fetching content for ${label} after ${MAX_RETRIES} attempts:`,
            e,
          );
        }
      }
    }
  },
});
```

`convex/skills.ts:1334-1385` — `markContentFetchFailed`, the mutation the
fix must call. Its behavior (do not change it): first failure sets
`contentFetchFailCount: 1`, `hasContentFetchError: true`,
`needsContentFetch: false`; at `failCount >= 2` it clears the URL and sets
`needsDiscovery: true` (the "maybe SKILL.md moved" rediscovery path). It
mirrors both fields onto the `skillSummaries` row.

- Repo test conventions: backend tests live in top-level `tests/` (NOT under
  `convex/` — Convex's bundler would try to compile them). They use
  `makeTest()` from `tests/_setup.ts` (a `convexTest(schema, modules)`
  wrapper) and vitest. `tests/skills-chain.test.ts` is the exemplar for
  testing sync-chain segments in isolation; its header comment explains the
  segment-testing philosophy — follow it.

## Commands you will need

| Purpose   | Command            | Expected on success |
|-----------|--------------------|---------------------|
| Typecheck | `npx tsc --noEmit` | exit 0              |
| Tests     | `pnpm test`        | all pass            |
| One file  | `pnpm test tests/content-fetch-failure.test.ts` | passes |
| Lint      | `pnpm lint`        | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `convex/skills.ts` — ONLY the `fetchSkillContent` handler's final catch
  branch.
- `tests/content-fetch-failure.test.ts` (create)

**Out of scope** (do NOT touch):
- `markContentFetchFailed` / `markContentFetched` / `updateDescription` —
  their semantics are load-bearing for the whole pipeline.
- The retry count, backoff timing, or the `!res.ok` early-return behavior.
- `convex/lib/skillHealth.ts`, `convex/reconcile.ts` — related lifecycle
  code, no changes.

## Git workflow

- Branch: `advisor/003-content-fetch-failure-recording`
- Conventional commit, e.g.
  `fix: record content-fetch failure when fetch throws`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Record the failure in the exhausted-exception branch

In the final `else` of the catch block (the `console.error(... after ${MAX_RETRIES} attempts ...)`
branch), add the same mutation call the HTTP-error branch makes:

```ts
        } else {
          console.error(
            `Error fetching content for ${label} after ${MAX_RETRIES} attempts:`,
            e,
          );
          await ctx.runMutation(internal.skills.markContentFetchFailed, {
            skillId,
          });
        }
```

Do not add a `return` — the loop exits naturally after the last attempt.

**Verify**: `npx tsc --noEmit` → exit 0

### Step 2: Write the regression test

Create `tests/content-fetch-failure.test.ts`. Structure (model imports and
setup on `tests/skills-chain.test.ts`):

1. Seed a `skills` row and its `skillSummaries` row via `t.run` (copy the
   field shape from the seed helpers in `tests/skills-chain.test.ts` /
   `tests/bundles.test.ts` — the schema requires more fields than you'd
   guess; let the schema validators tell you what's missing).
2. Stub the network so fetch always **throws**:
   `vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")))`
   (restore with `vi.unstubAllGlobals()` in `afterEach`).
3. Run `await t.action(internal.skills.fetchSkillContent, { skillId, skillMdUrl: "https://raw.githubusercontent.com/x/y/main/SKILL.md" })`.
4. Assert on the `skills` row: `hasContentFetchError === true`,
   `contentFetchFailCount === 1`, `needsContentFetch === false`; and the
   summary row mirrors `hasContentFetchError: true`.
5. Second test: run the action **twice** (two failure events) and assert the
   rediscovery path: `needsDiscovery === true`, `skillMdUrl === ""`,
   `contentFetchFailCount === 0` (reset by the >= 2 branch).

Note: the retry backoff sleeps 1s + 2s per action run with real timers, so
each run costs ~3s. That is acceptable; do NOT switch to fake timers unless
the test hangs (convex-test and `vi.useFakeTimers` interact poorly — if real
timers make the suite exceed its timeout, raise the per-test timeout via
`test("...", { timeout: 20000 }, ...)` instead).

**Verify**: `pnpm test tests/content-fetch-failure.test.ts` → 2 tests pass

### Step 3: Full suite

**Verify**: `pnpm test` → all pass (no existing test asserts the old
silent behavior; if one fails, see STOP conditions)

## Test plan

Covered in Step 2: (a) throw-failure records exactly like an HTTP failure,
(b) two throw-failures trigger the rediscovery reset. Pattern:
`tests/skills-chain.test.ts`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx tsc --noEmit` exits 0
- [ ] `pnpm test` exits 0; `tests/content-fetch-failure.test.ts` exists with
      2 passing tests
- [ ] In `convex/skills.ts`, the exhausted-exception branch calls
      `internal.skills.markContentFetchFailed`
      (`grep -n "after \${MAX_RETRIES} attempts" convex/skills.ts` and
      confirm the mutation call within the following 5 lines)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `fetchSkillContent` no longer matches the excerpt (drifted).
- An existing test fails after Step 1 — that means something depends on the
  silent behavior; report which test.
- Seeding the skill row fights you for more than ~3 schema-validation
  rounds — report the validator errors instead of inventing field values.

## Maintenance notes

- This makes transient *network* blips count toward the 2-failure
  rediscovery threshold, same as transient 5xx responses already do. That is
  the intended symmetry; rediscovery is cheap and self-healing. If flapping
  ever becomes visible (skills bouncing between fetch and rediscovery),
  the fix is a transient/permanent distinction in BOTH branches, not a
  revert of this one.
- Related but separate (deliberately not in this plan): the *discovery*
  path has an analogous transient-failure conflation
  (`convex/skills.ts:784-826` marking `skillMdUrl: ""` when the GitHub tree
  fetch itself failed). See the audit finding table — larger change, own
  plan if selected.
