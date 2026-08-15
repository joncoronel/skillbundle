# Plan 001: Generate bundle share tokens and URL IDs with a CSPRNG

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a0cea73..HEAD -- convex/bundles.ts tests/bundles.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `a0cea73`, 2026-07-18

## Why this matters

The share token is the _only_ access gate for a private bundle: anyone holding
a valid `?share=` token can read the full contents of a private bundle without
authentication. Today that token is built from `Math.random()`, a
non-cryptographic PRNG whose internal state is recoverable from observed
outputs — so the confidentiality of every private bundle rests on a guessable
value. The public `urlId` uses the same PRNG (lower severity, but same fix).
Swapping both to `crypto.getRandomValues` (available in the Convex runtime)
closes this with a few lines and zero schema changes.

## Current state

- `convex/bundles.ts` — all bundle mutations/queries. Three relevant spots:

`convex/bundles.ts:23-29` — public URL id generator:

```ts
function generateUrlId(length = 10): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
}
```

`convex/bundles.ts:326-343` — share token generator (owner-gated mutation,
the auth check above it is correct and must not change):

```ts
const token = Array.from({ length: 4 }, () =>
  Math.random().toString(36).slice(2),
).join("");

await ctx.db.patch(bundleId, { shareToken: token });
return token;
```

`convex/bundles.ts:427-433` — where the token gates access inside `getByUrlId`:

```ts
if (!bundle.isPublic) {
  const hasValidToken =
    shareToken !== undefined &&
    bundle.shareToken !== undefined &&
    shareToken === bundle.shareToken;

  if (!isOwner && !hasValidToken) return null;
}
```

- Repo conventions: Convex functions validate args with `v` from
  `convex/values`; errors are thrown as `ConvexError`. Tests for this module
  live in `tests/bundles.test.ts` (vitest + `convex-test` via
  `tests/_setup.ts` `makeTest()`); auth is simulated with
  `t.withIdentity({ subject: externalId })` against a seeded `users` row (see
  the `seedUser` helper at the top of `tests/bundles.test.ts` — match it).
- The Convex runtime is a V8 isolate with the Web Crypto API:
  `crypto.getRandomValues(new Uint8Array(n))` works in mutations. Do NOT
  import `node:crypto`.

## Commands you will need

| Purpose   | Command            | Expected on success |
| --------- | ------------------ | ------------------- |
| Install   | `pnpm install`     | exit 0              |
| Typecheck | `npx tsc --noEmit` | exit 0, no output   |
| Tests     | `pnpm test`        | all pass            |
| Lint      | `pnpm lint`        | exit 0              |

## Scope

**In scope** (the only files you should modify):

- `convex/bundles.ts`
- `tests/bundles.test.ts`

**Out of scope** (do NOT touch, even though they look related):

- `convex/schema.ts` — `shareToken`/`urlId` stay `v.string()`; no schema change.
- Any UI component that displays or copies share links.
- Existing stored tokens/urlIds — they keep working; do not write a migration.

## Git workflow

- Branch: `advisor/001-share-token-csprng`
- Conventional commits, e.g. `fix: generate share tokens with a CSPRNG`
  (repo style: `feat:`/`fix:`/`docs:` — see `git log --oneline`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a crypto-random string helper

In `convex/bundles.ts`, replace the body of `generateUrlId` with a
rejection-sampling-free CSPRNG implementation and add a token generator.
Target shape:

```ts
const ID_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// 62 doesn't divide 256, so use % with a slight bias — acceptable here —
// or draw from a 32-char subset for zero bias. Either is fine; keep it simple:
function randomId(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join("");
}

function generateUrlId(length = 10): string {
  return randomId(length);
}
```

**Verify**: `npx tsc --noEmit` → exit 0

### Step 2: Use the helper for share tokens

In `generateShareToken` (`convex/bundles.ts:326-343`), replace the
`Math.random().toString(36)` construction with `randomId(32)` (32 chars of
base-62 ≈ 190 bits — more than enough). Leave the auth check, the `patch`,
and the return value's shape unchanged.

Also confirm no other `Math.random()` remains in the file:

**Verify**: `grep -n "Math.random" convex/bundles.ts` → no matches

### Step 3: Make the share-token comparison constant-time

In `getByUrlId` (`convex/bundles.ts:427-433`), replace the `===` token check
with a constant-time comparison. Add a small helper near the generators:

```ts
function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
```

and use `timingSafeEqualStr(shareToken, bundle.shareToken)` in place of
`shareToken === bundle.shareToken` (keep the two `!== undefined` guards).

**Verify**: `npx tsc --noEmit` → exit 0

### Step 4: Tests

Add to `tests/bundles.test.ts` (reuse its existing `seedUser` helper and
`t.withIdentity` pattern):

1. `generateShareToken` returns a 32-char `[A-Za-z0-9]` token, and two
   consecutive calls return different tokens.
2. `getByUrlId` on a private bundle: returns `null` with no/wrong token,
   returns the bundle with the exact token returned by `generateShareToken`.
3. `createBundle` still produces a 10-char `[A-Za-z0-9]` `urlId` (assert via
   the returned/queried bundle).

**Verify**: `pnpm test` → all pass, including the 3 new tests

## Test plan

Covered in Step 4 — model the new tests on the existing
`createBundle`/`updateBundleSkills` tests in `tests/bundles.test.ts`
(seed user → `t.withIdentity` → call `api.bundles.*` → assert via `t.run`
db reads).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx tsc --noEmit` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm test` exits 0; the 3 new tests exist and pass
- [ ] `grep -n "Math.random" convex/bundles.ts` returns no matches
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the cited lines doesn't match the excerpts above.
- `crypto.getRandomValues` is unavailable in the Convex test runtime
  (`convex-test` uses Node ≥ 20 where `globalThis.crypto` exists — if a test
  fails on `crypto is not defined`, report rather than polyfilling).
- Fixing the comparison appears to require changing `getByUrlId`'s public
  return shape or its arg validators.

## Maintenance notes

- Existing share tokens were generated with the weak PRNG and remain valid.
  Recommend (in the PR description) that users of private bundles hit
  "regenerate link" once; do not force-rotate in code.
- If a "share link with expiry" feature is ever added, keep the token
  generation in this one helper so entropy policy stays in one place.
- Reviewer: check that the auth checks in `generateShareToken` /
  `revokeShareToken` were not altered.
