/**
 * Convex functions backing the skills.sh OIDC token cache.
 *
 * The why, the env vars, and the fallback policy all live in
 * `convex/lib/skillsAuth.ts` — read that first.
 */

import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { fetchRelayToken } from "./lib/skillsAuth";

/**
 * The cached token, for actions about to call skills.sh.
 *
 * internalQuery, never a public one: the return value is a bearer credential
 * carrying our Vercel team and project identity.
 */
export const getToken = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ token: v.string(), expiresAt: v.number() }),
  ),
  handler: async (ctx) => {
    const row = await ctx.db.query("skillsAuthToken").first();
    if (!row) return null;
    return { token: row.token, expiresAt: row.expiresAt };
  },
});

export const storeToken = internalMutation({
  args: { token: v.string(), expiresAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { token, expiresAt }) => {
    const row = await ctx.db.query("skillsAuthToken").first();
    const fields = {
      token,
      expiresAt,
      refreshedAt: Date.now(),
      // A success clears the last failure, so /dev shows the CURRENT state
      // rather than a scary error from three days ago.
      lastRefreshError: undefined,
      lastRefreshErrorAt: undefined,
    };
    if (row) {
      await ctx.db.patch(row._id, fields);
    } else {
      await ctx.db.insert("skillsAuthToken", fields);
    }
    return null;
  },
});

export const recordRefreshError = internalMutation({
  args: { message: v.string() },
  returns: v.null(),
  handler: async (ctx, { message }) => {
    const row = await ctx.db.query("skillsAuthToken").first();
    const stamp = {
      lastRefreshError: message.slice(0, 500),
      lastRefreshErrorAt: Date.now(),
    };
    if (row) {
      await ctx.db.patch(row._id, stamp);
    } else {
      // No token has ever been stored. Insert a placeholder row purely so the
      // failure is visible on /dev — an expiresAt of 0 is always stale, so
      // `loadSkillsAuth` treats it as "no token" and uses the API key.
      await ctx.db.insert("skillsAuthToken", {
        token: "",
        expiresAt: 0,
        refreshedAt: 0,
        ...stamp,
      });
    }
    return null;
  },
});

/**
 * Pull a fresh OIDC token from the site relay and cache it.
 *
 * Runs on its own hourly cron (see crons.ts, which explains why hourly and not
 * the docs' 12h lifetime). Best-effort by design: a failure is recorded and
 * logged, not
 * thrown, because the calls it serves fall back to the legacy API key. Throwing
 * would take out the sync chain over what is currently a redundancy.
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
