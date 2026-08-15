# Plan 006: Bound the public `recordCopy` mutation to public bundles

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a0cea73..HEAD -- convex/bundleEvents.ts components/install-commands.tsx tests/`
> If an in-scope-referenced file changed since this plan was written, compare
> the "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `a0cea73`, 2026-07-18

## Why this matters

`recordCopy` is a public, unauthenticated Convex mutation that increments
any bundle's "N copies" counter and will create a `bundleStats` row for any
bundle id — including private bundles the caller cannot even view. Copy
count is a public trust signal on bundle cards, so anyone can inflate any
bundle's number with a loop, and can force row creation for private bundles
(write amplification + a metrics-integrity hole). Full rate limiting needs
infrastructure this repo doesn't have; the right-sized fix now is to stop
counting copies for private bundles (their count is not a public signal) and
keep the mutation otherwise unchanged. Signed-out copying of _public_
bundles must keep working — it's core free UX.

## Current state

- `convex/bundleEvents.ts` — entire current file:

```ts
import { mutation } from "./_generated/server";
import { v } from "convex/values";

// ... comment block: raw event log was dropped; only copyCount remains ...

export const recordCopy = mutation({
  args: { bundleId: v.id("bundles") },
  handler: async (ctx, { bundleId }) => {
    const bundle = await ctx.db.get(bundleId);
    if (!bundle) return;

    const now = Date.now();
    const existing = await ctx.db
      .query("bundleStats")
      .withIndex("by_bundleId", (q) => q.eq("bundleId", bundleId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        copyCount: existing.copyCount + 1,
        lastEventAt: now,
      });
    } else {
      await ctx.db.insert("bundleStats", {
        bundleId,
        isPublic: bundle.isPublic,
        copyCount: 1,
        forkCount: 0,
        starCount: 0,
        lastEventAt: now,
      });
    }
  },
});
```

- Call sites (fire-and-forget, errors swallowed — good, keep that):
  `components/install-commands.tsx:31` and `:47`
  (`recordCopy({ bundleId }).catch(() => {})`).
- Schema invariant (`convex/schema.ts:437-452` comment): every
  `bundleStats.isPublic` mirrors `bundles.isPublic`; insert paths
  (`recordCopy`, `forkBundle`, `toggleStar`) read it from the bundle at
  insert time. This plan must preserve that invariant.
- Test conventions: `tests/bundles.test.ts` is the exemplar
  (`makeTest()` from `tests/_setup.ts`, `seedUser`, `t.withIdentity`,
  direct db seeding via `t.run`).

## Commands you will need

| Purpose   | Command                                 | Expected on success |
| --------- | --------------------------------------- | ------------------- |
| Typecheck | `npx tsc --noEmit`                      | exit 0              |
| Tests     | `pnpm test`                             | all pass            |
| New file  | `pnpm test tests/bundle-events.test.ts` | passes              |

## Scope

**In scope** (the only files you should modify):

- `convex/bundleEvents.ts`
- `tests/bundle-events.test.ts` (create)

**Out of scope** (do NOT touch):

- `components/install-commands.tsx` — client stays fire-and-forget.
- `convex/bundleStars.ts` / `forkBundle` — same counters, different
  endpoints; their auth posture is separate.
- Any rate-limiter dependency — do not add `@convex-dev/rate-limiter`.

## Git workflow

- Branch: `advisor/006-record-copy-guard`
- Conventional commit, e.g. `fix: only record copies for public bundles`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Guard the mutation

In `recordCopy`, immediately after the `if (!bundle) return;` line, add:

```ts
// Copy count is a public trust signal, and this mutation is deliberately
// callable signed-out (copying a public bundle is core free UX). Private
// bundles' counts are not publicly displayed, so don't count — this also
// stops unauthenticated callers from minting stats rows for bundles they
// can't view.
if (!bundle.isPublic) return;
```

No other behavior changes. The insert branch's `isPublic: bundle.isPublic`
is now always `true` on this path — leave the expression as-is (it keeps the
schema-comment invariant literal and survives future changes to the guard).

**Verify**: `npx tsc --noEmit` → exit 0

### Step 2: Tests

Create `tests/bundle-events.test.ts` (model on `tests/bundles.test.ts` —
reuse its seeding shape; seed bundles directly via `t.run` with the fields
the schema requires: `userId`, `urlId`, `name`, `skills: []`, `isPublic`,
`createdAt`):

1. Public bundle, no stats row: `recordCopy` (no identity) creates a stats
   row with `copyCount: 1`, `isPublic: true`.
2. Public bundle, existing stats row: second call increments to 2 and bumps
   `lastEventAt`.
3. Private bundle (`isPublic: false`), no stats row: `recordCopy` is a
   no-op — assert NO `bundleStats` row exists afterwards.
4. Private bundle WITH an existing stats row (seed one with
   `copyCount: 5, isPublic: false`): `recordCopy` leaves `copyCount` at 5.

**Verify**: `pnpm test tests/bundle-events.test.ts` → 4 tests pass

### Step 3: Full suite

**Verify**: `pnpm test` → all pass

## Test plan

Covered in Step 2; the regression cases are 3 and 4 (private bundles never
counted, never minted a row).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx tsc --noEmit` exits 0
- [ ] `pnpm test` exits 0; `tests/bundle-events.test.ts` exists with 4
      passing tests
- [ ] `grep -n "isPublic" convex/bundleEvents.ts` shows the early-return
      guard
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `convex/bundleEvents.ts` no longer matches the excerpt (drifted).
- You find UI that displays a _private_ bundle's copy count to its owner
  (search `copyCount` in `app/` and `components/`) — the product trade-off
  in "Why this matters" would need the operator's sign-off; report what you
  found.

## Maintenance notes

- Public bundles can still be inflated by a determined caller; that residual
  risk is accepted for now. If it's ever abused, the upgrade path is a
  Convex rate-limiter component keyed on session/user — a new dependency,
  hence its own decision.
- The weekly `bundleStats` heal job (see `docs/skill-lifecycle.md` notes on
  copyCount drift) is unaffected: this plan only narrows who gets counted.
- If bundle visibility toggling ever changes (`updateBundleVisibility`),
  the schema invariant comment at `convex/schema.ts:437-452` still governs —
  nothing here alters it.
