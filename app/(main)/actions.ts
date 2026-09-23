"use server";

import { headers } from "next/headers";
import { checkBotId } from "botid/server";
import { fetchAction } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { AnalyzeRepoResult } from "@/convex/recommendations";
import { extractRepoSlug } from "@/lib/repo-match";
import { clientIp, visitorKey } from "@/lib/visitor-key";

/**
 * A server action's thrown errors reach the client masked in production, so
 * this returns its refusals instead. `code` is the ConvexError code where
 * there is one (ANON_LIMIT, "rate_limited"), which the client turns back into
 * a thrown error so TanStack Query stores it as an error, never as data.
 */
export type SignedOutRepoMatch =
  | { ok: true; result: AnalyzeRepoResult }
  | { ok: false; code: string; message: string };

const UNAVAILABLE: SignedOutRepoMatch = {
  ok: false,
  code: "unavailable",
  message:
    "Repo matching isn't available signed out right now. Sign in to use it.",
};

/**
 * Repo matching for signed-out visitors, from the home page's repo mode (the
 * only mount of the repo input, which is why `instrumentation-client.ts`
 * protects `POST /`). Signed-in and demo runs call Convex directly; this path
 * exists because the signed-out allowance is per IP, and only the site can
 * see the IP (the browser talks to Convex over a websocket).
 *
 * Checks BotID, turns the IP into an opaque visitor key, and calls
 * `recommendations.analyzeRepoAnonymous` with the shared REPO_MATCH_SECRET.
 * Adds no render work: nothing here revalidates or sets cookies, so the
 * response carries only the return value and the page stays static.
 */
export async function analyzeRepoSignedOut(
  repoUrl: string,
): Promise<SignedOutRepoMatch> {
  // Server actions are public POST endpoints; the argument is untrusted.
  if (
    typeof repoUrl !== "string" ||
    repoUrl.length > 500 ||
    !extractRepoSlug(repoUrl)
  ) {
    return { ok: false, code: "invalid_url", message: "Invalid GitHub URL" };
  }

  const secret = process.env.REPO_MATCH_SECRET;
  if (!secret) {
    console.error("analyzeRepoSignedOut: REPO_MATCH_SECRET is not set");
    return UNAVAILABLE;
  }

  let isBot: boolean;
  try {
    ({ isBot } = await checkBotId());
  } catch (e) {
    // checkBotId needs Vercel's OIDC token to ask Vercel for a verdict. Off
    // Vercel (a local `next start`, which is what the e2e suite runs) there is
    // none and it throws; `next dev` never gets here, it answers "human". So a
    // throw on Vercel is a real failure and refuses; anywhere else it's the
    // expected absence of the platform.
    if (process.env.VERCEL) {
      console.error("analyzeRepoSignedOut: checkBotId failed", e);
      return UNAVAILABLE;
    }
    isBot = false;
  }
  if (isBot) {
    return {
      ok: false,
      code: "bot",
      message: "This request looked automated. Sign in to match repos.",
    };
  }

  try {
    const result = await fetchAction(api.recommendations.analyzeRepoAnonymous, {
      repoUrl,
      visitorKey: visitorKey(clientIp(await headers()), secret),
      secret,
    });
    return { ok: true, result };
  } catch (e) {
    if (e instanceof ConvexError) {
      const data = e.data as { code?: unknown; message?: unknown } | string;
      const code =
        typeof data === "object" && typeof data?.code === "string"
          ? data.code
          : "failed";
      const message =
        typeof data === "object" && typeof data?.message === "string"
          ? data.message
          : "Something went wrong analyzing this repository. Please try again.";
      if (code === "unauthorized") {
        // The two deployments disagree about the secret: a config error, not
        // something the visitor can fix.
        console.error("analyzeRepoSignedOut: REPO_MATCH_SECRET mismatch");
        return UNAVAILABLE;
      }
      return { ok: false, code, message };
    }
    console.error("analyzeRepoSignedOut failed", e);
    return {
      ok: false,
      code: "failed",
      message:
        "Something went wrong analyzing this repository. Please try again.",
    };
  }
}
