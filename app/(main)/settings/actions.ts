"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";

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
