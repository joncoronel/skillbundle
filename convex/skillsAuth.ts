/**
 * Convex functions backing the skills.sh OIDC token cache.
 *
 * The why, the env vars, and the fallback policy all live in
 * `convex/lib/skillsAuth.ts` — read that first.
 */

import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { fetchRelayToken } from "./lib/skillsAuth";

/**
 * The cached token, for actions about to call skills.sh.
 *
 * internalQuery, never a public one: the return value is a bearer credential
 * carrying our Vercel team and project identity.
 *
 * Returns null unless a real token is present, so a row that exists only to
 * hold failure history can never be mistaken for a credential.
 */
export const getToken = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ token: v.string(), expiresAt: v.number() }),
  ),
  handler: async (ctx) => {
    const row = await ctx.db.query("skillsAuthToken").first();
    if (!row?.token || row.expiresAt === undefined) return null;
    return { token: row.token, expiresAt: row.expiresAt };
  },
});

/**
 * Patch the singleton row, creating it if this is the first write. Shared by
 * every mutation here so the upsert exists once rather than per caller.
 */
async function upsertAuthRow(
  ctx: MutationCtx,
  fields: Partial<{
    token: string | undefined;
    expiresAt: number | undefined;
    refreshedAt: number | undefined;
    lastRefreshError: string | undefined;
    lastRefreshErrorAt: number | undefined;
    lastOidcRejectedAt: number | undefined;
    lastOidcRejectedStatus: number | undefined;
  }>,
): Promise<void> {
  const row = await ctx.db.query("skillsAuthToken").first();
  if (row) {
    await ctx.db.patch(row._id, fields);
  } else {
    await ctx.db.insert("skillsAuthToken", fields);
  }
}

export const storeToken = internalMutation({
  args: { token: v.string(), expiresAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { token, expiresAt }) => {
    await upsertAuthRow(ctx, {
      token,
      expiresAt,
      refreshedAt: Date.now(),
      // A success clears the last refresh failure, so /dev shows the CURRENT
      // state rather than a scary error from three days ago.
      //
      // `lastOidcRejected*` is deliberately NOT cleared: whether this new token
      // is accepted is unknown until something uses it, and /dev decides by
      // comparing the rejection against `refreshedAt`. Clearing it here would
      // throw away the only evidence that the previous one was refused.
      lastRefreshError: undefined,
      lastRefreshErrorAt: undefined,
    });
    return null;
  },
});

export const recordRefreshError = internalMutation({
  args: { message: v.string() },
  returns: v.null(),
  handler: async (ctx, { message }) => {
    await upsertAuthRow(ctx, {
      lastRefreshError: message.slice(0, 500),
      lastRefreshErrorAt: Date.now(),
    });
    return null;
  },
});

/**
 * Stamp the fact that skills.sh rejected the OIDC token we sent.
 *
 * This is the failure the expiry timestamp cannot show: the relay keeps
 * producing perfectly fresh tokens and skills.sh keeps refusing them, so
 * `refreshToken` succeeds, no error is recorded, and every call quietly runs on
 * the legacy key. Called at most once per action (see `loadSkillsAuth`).
 */
export const recordOidcRejected = internalMutation({
  args: { status: v.number() },
  returns: v.null(),
  handler: async (ctx, { status }) => {
    await upsertAuthRow(ctx, {
      lastOidcRejectedAt: Date.now(),
      lastOidcRejectedStatus: status,
    });
    return null;
  },
});

/**
 * Pull a fresh OIDC token from the site relay and cache it.
 *
 * Runs on its own hourly cron (see crons.ts, which explains why hourly and not
 * the docs' 12h lifetime). Best-effort by design: a failure is recorded and
 * logged, not thrown, because the calls it serves fall back to the legacy API
 * key. Throwing would take out the sync chain over what is currently a
 * redundancy.
 */
export const refreshToken = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    try {
      const { token, expiresAt } = await fetchRelayToken();
      await ctx.runMutation(internal.skillsAuth.storeToken, {
        token,
        expiresAt,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Never log the token itself; fetchRelayToken's errors carry only status
      // codes and response bodies from our own relay.
      console.error(`skills.sh OIDC refresh failed: ${message}`);
      await ctx.runMutation(internal.skillsAuth.recordRefreshError, {
        message,
      });
    }
    return null;
  },
});

// The /dev health readout lives in devStats.ts (`getSkillsAuthStatus`) with the
// rest of the admin queries. It deliberately returns no token material.
