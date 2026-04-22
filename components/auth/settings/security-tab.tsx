"use client";

import * as React from "react";
import { useUser } from "@clerk/nextjs";
import { Separator } from "@/components/ui/cubby-ui/separator";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { SettingsSection } from "./settings-section";
import { PasswordSection } from "./password-section";
import { SessionsTab, SessionsSkeleton, type BackendSession } from "./sessions-tab";
import { DangerZone } from "./danger-zone";

export type { BackendSession };

function SecuritySkeleton() {
  return (
    <div className="flex flex-col gap-10">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-10">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Skeleton className="h-9 w-36" />
        </div>
      </div>
      <Separator />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-10">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex flex-col gap-3 lg:col-span-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex flex-col gap-1">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SecurityTab({
  sessionsPromise,
}: {
  sessionsPromise: Promise<BackendSession[]>;
}) {
  const { isLoaded, user } = useUser();

  if (!isLoaded || !user) return <SecuritySkeleton />;

  const hasPassword = user.passwordEnabled;

  return (
    <div className="flex flex-col gap-10">
      <SettingsSection
        title="Password"
        description={
          hasPassword
            ? "Change your account password"
            : "Set a password for email-based sign in"
        }
      >
        <PasswordSection hasPassword={hasPassword} />
      </SettingsSection>

      <Separator />

      <SettingsSection
        title="Active sessions"
        description="Manage your active sessions across devices"
      >
        <React.Suspense fallback={<SessionsSkeleton />}>
          <SessionsTab sessionsPromise={sessionsPromise} />
        </React.Suspense>
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
