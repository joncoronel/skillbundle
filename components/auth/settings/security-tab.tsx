"use client";

import { useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { getSessions } from "@/app/(main)/settings/actions";
import { Separator } from "@/components/ui/cubby-ui/separator";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { SettingsSection } from "./settings-section";
import { PasswordSection } from "./password-section";
import { SessionsTab, SessionsSkeleton, type BackendSession } from "./sessions-tab";
import { DangerZone } from "./danger-zone";

export type { BackendSession };

// The section chrome (titles, descriptions, separators) is static text, so it
// renders immediately and never shifts. Only the two data-dependent slots show
// skeletons — the password area (Clerk user) and the sessions list (server
// action) — and each fills in independently as its data arrives, instead of
// swapping the whole tab layout twice. DangerZone gates itself internally.
export function SecurityTab() {
  const { isLoaded, user } = useUser();

  // Fetched on demand when this tab mounts — the /settings page is static, so
  // sessions come from the server action instead of a server-render fetch.
  // One-shot per visit, matching the old server-passed promise.
  const { data: sessions } = useQuery({
    queryKey: ["clerk-sessions"],
    queryFn: () => getSessions(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const userReady = isLoaded && !!user;
  const hasPassword = !!user?.passwordEnabled;

  return (
    <div className="flex flex-col gap-10">
      <SettingsSection
        title="Password"
        description={
          !userReady
            ? "Manage your account password"
            : hasPassword
              ? "Change your account password"
              : "Set a password for email-based sign in"
        }
      >
        {userReady ? (
          <PasswordSection hasPassword={hasPassword} />
        ) : (
          <Skeleton className="h-9 w-36" />
        )}
      </SettingsSection>

      <Separator />

      <SettingsSection
        title="Active sessions"
        description="Manage your active sessions across devices"
      >
        {sessions === undefined ? (
          <SessionsSkeleton />
        ) : (
          <SessionsTab initialSessions={sessions} />
        )}
      </SettingsSection>

      <Separator />

      <SettingsSection
        title="Danger zone"
        description="Permanently delete your account and all associated data"
      >
        <DangerZone />
      </SettingsSection>
    </div>
  );
}
