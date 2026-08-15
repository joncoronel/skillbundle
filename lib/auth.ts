import "server-only";

import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { ClerkOfflineError } from "@clerk/nextjs/errors";
import { redirect, notFound } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

/**
 * Cached wrapper around Clerk's auth().
 * Dedupes multiple auth() calls within the same request/render pass.
 */
export const getAuth = cache(() => auth());

export async function getAuthToken() {
  try {
    return (
      (await (await getAuth()).getToken({ template: "convex" })) ?? undefined
    );
  } catch (error) {
    if (error instanceof ClerkOfflineError) return undefined;
    throw error;
  }
}

/**
 * Verifies the current user session server-side.
 * Redirects to /sign-in if not authenticated.
 * Cached per request to avoid duplicate auth checks in the same render pass.
 */
export const verifySession = cache(async () => {
  const { userId } = await getAuth();

  if (!userId) {
    redirect("/sign-in");
  }

  return { userId };
});

/**
 * Server-side admin gate for routes under /dev. Verifies the session, then
 * checks the user's email against ADMIN_EMAILS via Convex (single source of
 * truth). Non-admins get a 404 — the route doesn't even acknowledge it
 * exists to them. Cached per request so multiple calls in the same render
 * pass don't fan out into multiple Convex roundtrips.
 */
export const verifyAdmin = cache(async () => {
  const { userId } = await verifySession();
  const token = await getAuthToken();
  const isAdmin = await fetchQuery(api.devStats.isAdmin, {}, { token });
  if (!isAdmin) {
    notFound();
  }
  return { userId };
});
