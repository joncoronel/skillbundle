"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { verifySession } from "@/lib/auth";
import type { BackendSession } from "@/components/auth/settings/sessions-tab";

// Fetched client-side (React Query) from the Security tab so the /settings
// page itself stays static — and so the Clerk API call only happens when the
// user actually opens that tab. Errors propagate (no catch-to-[]): an empty
// array is indistinguishable from "no sessions", so failures must surface as
// React Query's isError, which the tab renders as an error state with retry.
export async function getSessions(): Promise<BackendSession[]> {
  const { userId } = await verifySession();

  const client = await clerkClient();
  const response = await client.sessions.getSessionList({
    userId,
    status: "active",
    limit: 50,
  });

  return response.data.map((session) => ({
    id: session.id,
    status: session.status,
    lastActiveAt: session.lastActiveAt,
    createdAt: session.createdAt,
    latestActivity: session.latestActivity
      ? {
          deviceType: session.latestActivity.deviceType,
          browserName: session.latestActivity.browserName,
          browserVersion: session.latestActivity.browserVersion,
          ipAddress: session.latestActivity.ipAddress,
          city: session.latestActivity.city,
          country: session.latestActivity.country,
          isMobile: session.latestActivity.isMobile,
        }
      : null,
  }));
}

export async function revokeSession(sessionId: string) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  const client = await clerkClient();
  const session = await client.sessions.getSession(sessionId);
  if (session.userId !== userId) {
    throw new Error("Not authorized to revoke this session");
  }

  await client.sessions.revokeSession(sessionId);
}
