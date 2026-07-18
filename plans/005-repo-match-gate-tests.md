# Plan 005: Test the repo-match Pro gate and its shared predicate

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a0cea73..HEAD -- convex/recommendations.ts lib/repo-match.ts convex/lib/plans.ts tests/`
> If an in-scope-referenced file changed since this plan was written, compare
> the "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `a0cea73`, 2026-07-18

## Why this matters

Repo match ("analyze my GitHub repo → recommended skills") is the flagship
Pro-gated feature, shipped July 2026. The server-side gate in
`convex/recommendations.ts` — including its free demo-repo bypass and a
case-normalization subtlety the code comments call "the security-relevant
spot" — has **zero automated coverage**, as does the canonical URL parser
and the shared `isRepoMatchAllowed` predicate in `lib/repo-match.ts`. A
regression here either free-runs the paid feature or paywalls paying users,
and nothing would catch it before production. These are cheap tests: the
predicate/parser are pure functions, and the gate throws before any external
call.

## Current state

- `lib/repo-match.ts` — pure, shared by client and Convex backend. Key
  exports: `extractRepoSlug(input)` (THE canonical GitHub URL/slug parser —
  its comments document the tricky cases: strip query/fragment *before*
  `.git`, reject `github.com`-looking non-matches rather than salvaging
  them, reject `.`/`..` segments), `matchesDemoRepo(owner, repo)`
  (case-insensitive check against `DEMO_REPO_SLUGS`, currently just
  `shadcn-ui/ui`), `isRepoMatchAllowed(limits, owner, repo)`
  (`matchesDemoRepo(...) || limits.canAutoDetect`), and the
  `PRO_REQUIRED = "pro_required"` error code.

- `convex/recommendations.ts:271-313` — the gate inside the `analyzeRepo`
  action:

```ts
export const analyzeRepo = action({
  args: { repoUrl: v.string() },
  handler: async (ctx, { repoUrl }): Promise<AnalyzeRepoResult> => {
    const parsed = extractRepoSlug(repoUrl);
    if (!parsed) {
      return { error: "Invalid GitHub URL", repoName: "", fingerprint: null, recommendations: [] };
    }
    const owner = parsed.owner.toLowerCase();
    const repo = parsed.repo.toLowerCase();
    // ...
    if (!matchesDemoRepo(owner, repo)) {
      const { limits } = await ctx.runQuery(internal.plans.internalCurrentPlan, {});
      if (!isRepoMatchAllowed(limits, owner, repo)) {
        throw new ConvexError({ code: PRO_REQUIRED });
      }
    }
    // ... then GitHub tree fetch, embeddings, vector search ...
```

- Plan resolution: `convex/lib/plans.ts` `getUserPlan` returns `"free"` when
  there is no authed user, and — important for tests — its
  `polar.getCurrentSubscription` call is wrapped in `try/catch { return "free" }`.
  Under `convex-test` the Polar *component* is not registered, so the call
  throws and every authed user resolves as `"free"`. Consequence: **the Pro
  pass-through cannot be exercised end-to-end in convex-test**; it is
  covered at the predicate level instead (`isRepoMatchAllowed` with
  `canAutoDetect: true`). `FEATURE_GATING_ENABLED` is `true`
  (`convex/lib/plans.ts:39`); if it were `false`, `getPlanLimits` returns
  pro limits for everyone and the gate tests below would fail — that's a
  STOP condition.

- Test conventions: `tests/_setup.ts` `makeTest()` wraps
  `convexTest(schema, modules)` with an `import.meta.glob` module map.
  Pure-lib exemplar: `tests/parse-skill-input.test.ts`. Convex exemplar with
  auth: `tests/bundles.test.ts` (`seedUser` + `t.withIdentity({ subject })`).
  Network stubbing exemplar: `tests/skills-chain.test.ts` (vi.mock of
  `convex/lib/skillsApi`).

## Commands you will need

| Purpose   | Command            | Expected on success |
|-----------|--------------------|---------------------|
| Typecheck | `npx tsc --noEmit` | exit 0              |
| Tests     | `pnpm test`        | all pass            |
| New files | `pnpm test tests/repo-match.test.ts tests/recommendations-gate.test.ts` | pass |

## Scope

**In scope** (the only files you should modify):
- `tests/repo-match.test.ts` (create)
- `tests/recommendations-gate.test.ts` (create)

**Out of scope** (do NOT touch):
- `convex/recommendations.ts`, `lib/repo-match.ts`, `convex/lib/plans.ts` —
  this plan adds tests ONLY. If a test reveals a real bug, STOP and report;
  do not fix source.
- Anything Polar/subscription-related.

## Git workflow

- Branch: `advisor/005-repo-match-gate-tests`
- Conventional commit, e.g. `test: cover repo-match Pro gate and slug parser`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Pure tests for `lib/repo-match.ts`

Create `tests/repo-match.test.ts` (plain vitest, model on
`tests/parse-skill-input.test.ts`). Cover `extractRepoSlug`:

- `https://github.com/owner/repo` → `{owner:"owner", repo:"repo"}`
- `http://www.github.com/owner/repo/tree/main` → parses (extra path ignored)
- `github.com/owner/repo` (no protocol) and bare `owner/repo` → parse
- trailing slashes and `.git` stripped: `https://github.com/o/r.git` → `r`
- the documented ordering bug-guard: `https://github.com/shadcn-ui/ui.git#readme`
  → repo `ui` (NOT `ui.git`)
- query param stripped: `...?tab=readme` → parses
- `https://github.com/owner` (missing repo) → null
- `github.com/broken` and other github.com-looking non-matches → null (not
  salvaged as a bare slug)
- `mygithub.com/a/b` → null (look-alike host)
- `owner/..` and `./repo` → null (path-unsafe segments)
- prose containing a URL (`check out https://github.com/a/b`) → null
  (anchored)

Cover `matchesDemoRepo`: `("shadcn-ui","ui")` true; `("ShAdCn-Ui","Ui")`
true; `("shadcn-ui","uix")` false.

Cover `isRepoMatchAllowed`: `{canAutoDetect:false}` + demo repo → true;
`{canAutoDetect:false}` + other repo → false; `{canAutoDetect:true}` + other
repo → true.

**Verify**: `pnpm test tests/repo-match.test.ts` → all pass

### Step 2: Gate tests for `analyzeRepo`

Create `tests/recommendations-gate.test.ts` using `makeTest()`. In
`beforeEach`, stub the network so any escape past the gate fails fast and
offline: `vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network disabled in test")))`;
`vi.unstubAllGlobals()` in `afterEach`.

Helper: `expectProRequired(promise)` — assert it rejects with a
`ConvexError` whose `data.code === "pro_required"` (import `PRO_REQUIRED`
from `../lib/repo-match` and `ConvexError` from `convex/values`).

Tests:

1. **Signed-out + non-demo repo → PRO_REQUIRED**:
   `t.action(api.recommendations.analyzeRepo, { repoUrl: "https://github.com/vercel/next.js" })`
   rejects with `PRO_REQUIRED`.
2. **Authed free user + non-demo repo → PRO_REQUIRED**: seed a user (copy
   `seedUser` from `tests/bundles.test.ts`), call via
   `t.withIdentity({ subject: externalId })` — still rejects with
   `PRO_REQUIRED` (no Polar subscription resolvable → free plan).
3. **Demo repo bypasses the gate (signed out)**:
   `analyzeRepo({ repoUrl: "https://github.com/shadcn-ui/ui" })` must NOT
   reject with `PRO_REQUIRED`. It WILL fail later (network stubbed) — assert
   the rejection/return is anything other than a `PRO_REQUIRED` ConvexError,
   or a returned object with an `error` field. The assertion is "got past
   the gate", not "succeeded".
4. **Demo repo, hostile casing**: same as 3 with
   `https://github.com/ShAdCn-Ui/Ui` — must NOT reject with `PRO_REQUIRED`
   (this is the case-normalization regression guard the code comment at
   `convex/recommendations.ts:284-289` describes).
5. **Invalid URL short-circuits**: `analyzeRepo({ repoUrl: "not a repo" })`
   resolves (no throw) with `error: "Invalid GitHub URL"` and empty
   `recommendations`.

**Verify**: `pnpm test tests/recommendations-gate.test.ts` → 5 tests pass

### Step 3: Full suite

**Verify**: `pnpm test` → all pass

## Test plan

This plan IS the test plan (Steps 1–2). Structural patterns:
`tests/parse-skill-input.test.ts` (pure), `tests/bundles.test.ts`
(identity/seed), `tests/skills-chain.test.ts` (stubbing philosophy).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx tsc --noEmit` exits 0
- [ ] `pnpm test` exits 0; both new files exist;
      `tests/repo-match.test.ts` ≥ 15 assertions,
      `tests/recommendations-gate.test.ts` has the 5 named tests
- [ ] No source files modified — `git status` shows only the two new test
      files (plus the plans index row)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any Step 1 case FAILS against the current parser — that's a live bug in
  `extractRepoSlug`; report the failing input and expected/actual.
- Test 3 or 4 rejects with `PRO_REQUIRED` — the demo bypass or case
  normalization is broken in source; report, don't patch source.
- `FEATURE_GATING_ENABLED` in `convex/lib/plans.ts` is no longer `true`
  (gate tests would be vacuous).
- convex-test cannot load the module graph (e.g. a new import in
  `convex/recommendations.ts` that breaks under the test bundler).

## Maintenance notes

- When the deferred **phase-2 free-run quota** ships (see TODO.md "Match
  repo: free-run quota"), `isRepoMatchAllowed` gains quota logic — extend
  the Step 1 predicate tests then; the gate tests here remain valid.
- If a Polar-component test harness is ever added, add the missing
  end-to-end case: authed **Pro** user + non-demo repo passes the gate.
- If a new repo is added to `DEMO_REPO_SLUGS`, tests 3–4 don't need
  changing, but add a matching `matchesDemoRepo` case.
