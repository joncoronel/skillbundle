"use server";

import { headers } from "next/headers";
import { checkBotId } from "botid/server";
import { fetchAction } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { AnalyzeRepoResult } from "@/convex/recommendations";
import {
  BOT_REFUSED,
  extractRepoSlug,
  SIGNED_OUT_CODES,
  SIGNED_OUT_UNAVAILABLE,
  type SignedOutCode,
} from "@/lib/repo-match";
import { clientIp, visitorKey } from "@/lib/visitor-key";

/** Server action errors are masked in production, so refusals are returned. */
export type SignedOutRepoMatch =
  | { ok: true; result: AnalyzeRepoResult }
  | { ok: false; code: SignedOutCode; message: string };

const UNAVAILABLE: SignedOutRepoMatch = {
  ok: false,
  code: SIGNED_OUT_UNAVAILABLE,
  message:
    "Repo matching isn't available signed out right now. Sign in to use it.",
};

/**
 * Signed-out repo matching. It goes through the site because the allowance is
 * per IP, and Convex can't see the IP. Checks BotID, hashes the IP into a
 * visitor key, and calls `analyzeRepoAnonymous` with REPO_MATCH_SECRET.
 * Invoked from the home page, which is why instrumentation-client.ts protects
 * `POST /`.
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
    // It throws off Vercel (no OIDC token, e.g. the e2e `next start`), so only
    // a throw on Vercel refuses.
    if (process.env.VERCEL) {
      console.error("analyzeRepoSignedOut: checkBotId failed", e);
      return UNAVAILABLE;
    }
    isBot = false;
  }
  if (isBot) {
    return {
      ok: false,
      code: BOT_REFUSED,
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
      const raw = typeof data === "object" ? data?.code : undefined;
      const message =
        typeof data === "object" && typeof data?.message === "string"
          ? data.message
          : "Something went wrong analyzing this repository. Please try again.";
      if (raw === "unauthorized") {
        // Secret mismatch between Vercel and Convex: config, not the visitor.
        console.error("analyzeRepoSignedOut: REPO_MATCH_SECRET mismatch");
        return UNAVAILABLE;
      }
      const code = SIGNED_OUT_CODES.find((c) => c === raw) ?? "failed";
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
