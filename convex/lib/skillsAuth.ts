/**
 * Auth for the skills.sh v1 API.
 *
 * skills.sh's documented credential is a Vercel OIDC token, minted per-request
 * inside a Vercel runtime. Our sync runs on Convex crons, which have no Vercel
 * request context, so we can't mint one here. Instead the site exposes a
 * secret-gated relay (`app/api/skills-token/route.ts`) that mints one for us;
 * this module pulls from it, parks the token in `skillsAuthToken`, and hands it
 * to `skillsApi.ts` for the thousands of upstream calls in between.
 *
 * The runtime token lives 2h (measured; the docs' ~12h figure describes the one
 * `vercel env pull` writes locally, not the one a deployment mints). An hourly
 * cron refreshes it — see crons.ts.
 *
 * The legacy `SKILLS_SH_API_KEY` (`sk_live_`) stays wired as the fallback. It
 * still works and skills.sh's own 401 body still names it, but it is absent
 * from their docs and returns none of the documented rate-limit headers, so it
 * is not something to build on. OIDC is deliberately the PRIMARY path: a
 * fallback that never executes is a fallback that is broken on the day it is
 * needed. Running OIDC on every sync means a breakage shows up as a bad day,
 * and the day the key is finally retired is a non-event.
 *
 * Env (PRODUCTION Convex deployment only, so dev syncs don't hammer the relay):
 *   npx convex env set SKILLS_TOKEN_URL https://skillbundle.dev/api/skills-token --prod
 *   npx convex env set SKILLS_TOKEN_SECRET <secret> --prod
 * SKILLS_TOKEN_SECRET must match the value set on Vercel.
 */

import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { SkillsAuth } from "./skillsApi";

/**
 * Refuse to hand out a token this close to its expiry. A sync action can run
 * for minutes across many upstream calls, so a token that is valid at the top
 * of the handler needs to still be valid at the bottom. 15 minutes out of a 2h
 * lifetime; keep it well under the hourly refresh interval or every token
 * spends part of its life unusable.
 */
export const EXPIRY_MARGIN_MS = 15 * 60 * 1000;

/**
 * The single definition of "this cached token is safe to send".
 *
 * Exported because three places need the answer (the loader below, the relay's
 * write-time sanity check, and the /dev readout) and a hand-copied comparison
 * in each is how the dashboard silently stops describing what the sync does.
 */
export function isTokenUsable(
  token: { expiresAt: number } | null | undefined,
  now: number = Date.now(),
): boolean {
  return !!token && token.expiresAt - EXPIRY_MARGIN_MS > now;
}

/**
 * Load the auth an action should use for every skills.sh call it makes.
 *
 * Call this ONCE per action and thread the result through, rather than calling
 * it per request: it costs a query round-trip, and the sync fans out thousands
 * of upstream calls per run.
 *
 * Deliberately read-only on the token — it never refreshes. Refresh is a
 * scheduled job (`skillsAuth.refreshToken`) precisely so that thousands of
 * parallel actions hitting an expired token can't stampede our own relay. A
 * missing or stale token here is not an outage: it degrades to the legacy key.
 */
export async function loadSkillsAuth(ctx: ActionCtx): Promise<SkillsAuth> {
  const cached = await ctx.runQuery(internal.skillsAuth.getToken, {});
  const apiKey = process.env.SKILLS_SH_API_KEY ?? null;

  // Reported at most once per action even though `request()` may call it from
  // any of thousands of concurrent calls — the first rejection is the whole
  // signal, and the rest would be a write storm at the worst possible moment.
  let reported = false;
  const onOidcRejected = async (status: number) => {
    if (reported) return;
    reported = true;
    await ctx.runMutation(internal.skillsAuth.recordOidcRejected, { status });
  };

  if (!isTokenUsable(cached)) {
    // Logged once per action rather than per request, so a broken relay is
    // visible in the Convex logs without drowning them.
    console.warn(
      cached
        ? "skills.sh auth: cached OIDC token expired; falling back to API key"
        : "skills.sh auth: no cached OIDC token; falling back to API key",
    );
    return { oidcToken: null, apiKey, onOidcRejected };
  }
  return { oidcToken: cached!.token, apiKey, onOidcRejected };
}

export type RelayToken = { token: string; expiresAt: number };

/**
 * Ask the site's relay for a fresh OIDC token. Throws with a readable message
 * on any failure — the caller records it so /dev can show why we're on the key.
 */
export async function fetchRelayToken(): Promise<RelayToken> {
  const url = process.env.SKILLS_TOKEN_URL;
  const secret = process.env.SKILLS_TOKEN_SECRET;
  if (!url || !secret) {
    throw new Error("SKILLS_TOKEN_URL / SKILLS_TOKEN_SECRET not configured");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "x-skills-token-secret": secret },
    // Do NOT follow redirects. Per the Fetch spec a cross-origin redirect
    // strips only Authorization / Cookie / Proxy-Authorization, so a custom
    // header like ours rides along to wherever the hop points. This secret
    // gates a credential-minting endpoint, and the request would still
    // succeed, so the leak would be invisible.
    //
    // What a 3xx then looks like is runtime-dependent, so the check below
    // accepts both shapes. MEASURED on the Convex runtime, Aug 2026, by
    // pointing a dev deployment's SKILLS_TOKEN_URL at the www host (which 308s
    // to the apex) and running this action: it reports `relay 308:
    // Redirecting...`, i.e. the real status, NOT the spec's opaque
    // `status: 0`. The hop is genuinely not followed, so the secret does not
    // leak either way. Browser/edge fetch does return the opaque 0 form, which
    // is what `convex/githubOnlyAudit.ts` describes.
    redirect: "manual",
    // Fail fast rather than pinning the action open until Convex's timeout.
    signal: AbortSignal.timeout(10_000),
  });

  // `status === 0` is the opaque-redirect form; a literal 3xx is what the
  // Convex runtime actually returns. Accept both rather than betting on one.
  if (res.status === 0 || (res.status >= 300 && res.status < 400)) {
    throw new Error(
      // Renders verbatim on /dev via lastRefreshError, so it follows the same
      // plain-prose copy convention as the panel itself.
      `relay redirected (${res.status}); SKILLS_TOKEN_URL (${url}) is not the canonical host. ` +
        `The secret is deliberately not forwarded across the hop. Point it at the host that answers directly.`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`relay ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as Partial<RelayToken>;
  if (typeof data.token !== "string" || !data.token) {
    throw new Error("relay returned no token");
  }
  if (typeof data.expiresAt !== "number" || !Number.isFinite(data.expiresAt)) {
    throw new Error("relay returned no usable expiresAt");
  }
  if (!isTokenUsable({ expiresAt: data.expiresAt })) {
    // Already inside the margin: storing it would guarantee an immediate
    // fallback, and the real problem (clock skew, or a relay handing out stale
    // tokens) should surface here rather than as mystery key usage later.
    throw new Error(
      `relay returned a token expiring at ${new Date(data.expiresAt).toISOString()}`,
    );
  }
  return { token: data.token, expiresAt: data.expiresAt };
}
