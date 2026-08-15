/**
 * The Convex half of the skills.sh credential state machine.
 *
 * The client and the relay route are covered elsewhere; this covers the part
 * whose failures are all SILENT. Every branch here decides whether the sync
 * runs on the documented OIDC token or quietly reverts to the legacy
 * `sk_live_` key, and none of them throws when it gets that wrong — a stale
 * error banner, or worse, an empty-string credential handed to `request()`,
 * both look like a healthy system from the outside.
 */
import { test, expect } from "vitest";
import { internal } from "../convex/_generated/api";
import { makeTest } from "./_setup";
import { EXPIRY_MARGIN_MS, isTokenUsable } from "../convex/lib/skillsAuth";

const HOUR = 60 * 60 * 1000;

test("a successful refresh clears the previous failure", async () => {
  const t = makeTest();

  await t.mutation(internal.skillsAuth.recordRefreshError, {
    message: "relay 503: oidc_unavailable",
  });
  await t.mutation(internal.skillsAuth.storeToken, {
    token: "tok-1",
    expiresAt: Date.now() + 2 * HOUR,
  });

  await t.run(async (ctx) => {
    const row = await ctx.db.query("skillsAuthToken").first();
    // Otherwise /dev shows a scary error from three days ago forever.
    expect(row!.lastRefreshError).toBeUndefined();
    expect(row!.lastRefreshErrorAt).toBeUndefined();
    expect(row!.token).toBe("tok-1");
  });
});

test("a refresh failure with no prior row leaves no usable credential", async () => {
  const t = makeTest();

  await t.mutation(internal.skillsAuth.recordRefreshError, {
    message: "SKILLS_TOKEN_URL / SKILLS_TOKEN_SECRET not configured",
  });

  // The row exists only to carry the failure. getToken must not present it as
  // a credential — an empty-string token would go out as `Bearer `.
  const cached = await t.query(internal.skillsAuth.getToken, {});
  expect(cached).toBeNull();

  await t.run(async (ctx) => {
    const row = await ctx.db.query("skillsAuthToken").first();
    expect(row!.lastRefreshError).toContain("not configured");
  });
});

test("an OIDC rejection is recorded without disturbing the cached token", async () => {
  const t = makeTest();
  const expiresAt = Date.now() + 2 * HOUR;

  await t.mutation(internal.skillsAuth.storeToken, {
    token: "tok-1",
    expiresAt,
  });
  await t.mutation(internal.skillsAuth.recordOidcRejected, { status: 401 });

  await t.run(async (ctx) => {
    const row = await ctx.db.query("skillsAuthToken").first();
    expect(row!.lastOidcRejectedStatus).toBe(401);
    expect(row!.lastOidcRejectedAt).toBeGreaterThan(0);
    // The token is still perfectly fresh — which is exactly why expiry alone
    // can't reveal this failure, and why the rejection has to be its own field.
    expect(row!.token).toBe("tok-1");
    expect(isTokenUsable({ expiresAt: row!.expiresAt! })).toBe(true);
  });
});

test("a later refresh outranks an earlier rejection", async () => {
  const t = makeTest();

  await t.mutation(internal.skillsAuth.recordOidcRejected, { status: 403 });
  await t.mutation(internal.skillsAuth.storeToken, {
    token: "tok-2",
    expiresAt: Date.now() + 2 * HOUR,
  });

  await t.run(async (ctx) => {
    const row = await ctx.db.query("skillsAuthToken").first();
    // storeToken deliberately does NOT clear the rejection: /dev decides by
    // comparing the two timestamps, so a new token gets a fresh chance while
    // the evidence that the last one was refused survives.
    expect(row!.lastOidcRejectedAt).toBeLessThanOrEqual(row!.refreshedAt!);
    expect(row!.lastOidcRejectedStatus).toBe(403);
  });
});

test("getToken hands back only a real credential", async () => {
  const t = makeTest();

  expect(await t.query(internal.skillsAuth.getToken, {})).toBeNull();

  const expiresAt = Date.now() + 2 * HOUR;
  await t.mutation(internal.skillsAuth.storeToken, {
    token: "tok-1",
    expiresAt,
  });

  expect(await t.query(internal.skillsAuth.getToken, {})).toEqual({
    token: "tok-1",
    expiresAt,
  });
});

test("isTokenUsable holds the margin, so a token expiring mid-action is refused", () => {
  const now = Date.now();

  expect(isTokenUsable(null, now)).toBe(false);
  expect(isTokenUsable({ expiresAt: now + 2 * HOUR }, now)).toBe(true);
  // Inside the margin: still unexpired, but an action running for minutes
  // could outlive it, so it must not be handed out.
  expect(isTokenUsable({ expiresAt: now + EXPIRY_MARGIN_MS - 1 }, now)).toBe(
    false,
  );
  expect(isTokenUsable({ expiresAt: now + EXPIRY_MARGIN_MS + 1 }, now)).toBe(
    true,
  );
  expect(isTokenUsable({ expiresAt: now - 1 }, now)).toBe(false);
});
