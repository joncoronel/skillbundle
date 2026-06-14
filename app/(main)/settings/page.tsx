import type { Metadata } from "next";
import { Suspense } from "react";
import {
  CustomSettingsPage,
  CustomSettingsPageView,
} from "@/components/auth/settings/custom-settings-page";

// The page is static — auth is enforced by the middleware (proxy.ts) and all
// tab content is client-rendered (Clerk hooks, Convex queries, and the
// sessions server action fetched from the Security tab). CustomSettingsPage
// reads the tab search param (nuqs), which suspends during prerendering — the
// fallback renders the identical default state (Profile tab, whose content
// shows its own skeleton until Clerk loads) so the route stays prefetchable
// and navigation is instant.

export const metadata: Metadata = {
  title: "Account Settings",
};

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 pt-12 pb-20">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-medium tracking-tight">
          Account Settings
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage your profile, security, and sessions
        </p>
      </div>

      <Suspense fallback={<CustomSettingsPageView activeTab="profile" />}>
        <CustomSettingsPage />
      </Suspense>
    </main>
  );
}
