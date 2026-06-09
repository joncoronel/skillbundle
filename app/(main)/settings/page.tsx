import type { Metadata } from "next";
import type { SearchParams } from "nuqs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { verifySession } from "@/lib/auth";
import { loadSettingsSearchParams } from "@/lib/search-params.server";
import {
  CustomSettingsPage,
  type BackendSession,
} from "@/components/auth/settings/custom-settings-page";

export const metadata: Metadata = {
  title: "Account Settings",
};

async function getSessions(): Promise<BackendSession[]> {
  const { userId } = await verifySession();

  try {
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
  } catch (err) {
    console.error("Failed to fetch sessions:", err);
    return [];
  }
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await loadSettingsSearchParams(searchParams);
  const sessionsPromise = getSessions();

  return (
    <main className="mx-auto max-w-4xl px-4 pt-12 pb-20">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Account Settings
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage your profile, security, and sessions
        </p>
      </div>

      <CustomSettingsPage sessionsPromise={sessionsPromise} />
    </main>
  );
}
