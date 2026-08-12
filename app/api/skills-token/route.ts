import { NextResponse } from "next/server";
import { getVercelOidcToken } from "@vercel/oidc";
import { secretsMatch } from "@/lib/shared-secret";

// Mints a Vercel OIDC token for the Convex backend.
//
// Why this exists: skills.sh's documented auth is a Vercel OIDC token, which
// Vercel only mints inside a Vercel request context. Every skills.sh call we
// make runs on Convex crons, which have no such context — so Convex asks this
// route for a token, caches it, and sends it upstream itself. Verified Aug 2026
// that skills.sh accepts a relayed token: it checks the JWT (issuer, audience,
// `owner:...:project:...:environment:...` subject) and does NOT require the
// request to originate from Vercel infrastructure.
//
// The alternative — proxying every skills.sh call through this app — was
// rejected: the sync is thousands of staggered per-skill actions carrying
// multi-MB files[] payloads, so it would convert one Convex cron chain into
// thousands of Vercel invocations. This costs 24 invocations a day and keeps
// all sync bandwidth on Convex. See TODO.md.
//
// POST, not GET, so a stray browser navigation or prefetch can never reach it.
// Not a Clerk-private route (see proxy.ts), so the shared secret is the only
// gate — same arrangement as /api/revalidate.
//
// This hands a bearer credential carrying our team/project identity to Convex.
// It is scoped to us and attributed to us either way, but treat it as a secret:
// never log the token, never return it from a public Convex query.
export async function POST(request: Request) {
  const expected = process.env.SKILLS_TOKEN_SECRET;
  const provided = request.headers.get("x-skills-token-secret");
  if (!expected || !provided || !secretsMatch(provided, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let token: string;
  try {
    // Must be called per-request, not hoisted to module scope: the token is
    // request-scoped. Measured lifetime on a real deployment is 2h, minted
    // fresh per request. That is NOT the ~12h the Vercel docs describe, which
    // matches the token `vercel env pull` writes locally. Convex's refresh
    // cadence is sized off the 2h figure; see convex/crons.ts.
    //
    // Use the async variant, NOT getVercelOidcTokenSync(): the sync one is
    // marked @deprecated in @vercel/oidc@3.8.4 in favour of this.
    //
    // The catch: this function reads the token synchronously first, then
    // unconditionally dynamic-imports its local-dev refresh path
    // (`token-util.js` / `token.js`, which pull node:fs and the Vercel CLI
    // packages), and rethrows if those imports fail EVEN WHEN it already has a
    // valid token. Bundled into a serverless function, an untraced import there
    // would 503 this route with a good token in hand and silently drop Convex
    // onto the legacy key — the exact outcome this route exists to prevent.
    //
    // `serverExternalPackages: ["@vercel/oidc"]` in next.config.ts is what
    // makes that safe: the package stays out of the bundle and is loaded with
    // native require at runtime, so its own dynamic imports resolve normally.
    // Keep the two in step — dropping that config line re-arms this.
    token = await getVercelOidcToken();
  } catch (e) {
    // Most likely cause: OIDC Federation turned off for the project, or a
    // deployment old enough to predate it being enabled.
    console.error("skills-token: could not mint OIDC token:", e);
    return NextResponse.json({ error: "oidc_unavailable" }, { status: 503 });
  }

  const expiresAt = decodeExpiry(token);
  if (expiresAt === null) {
    // A token whose expiry we can't read is a token we can't cache safely —
    // Convex would either use it forever or never. Fail loudly instead.
    console.error("skills-token: minted token has no readable exp claim");
    return NextResponse.json({ error: "malformed_token" }, { status: 503 });
  }

  return NextResponse.json(
    { token, expiresAt },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * Read the `exp` claim (ms since epoch) out of a JWT without verifying it.
 * Verification is skills.sh's job; we only need to know when to stop using it,
 * and trusting Vercel's own freshly-minted token for that is fine. Returns null
 * if the token isn't a JWT or carries no numeric `exp`.
 */
function decodeExpiry(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}
