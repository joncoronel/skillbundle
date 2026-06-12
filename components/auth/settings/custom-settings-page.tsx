"use client";

import { useQueryState } from "nuqs";
import { HugeiconsIcon } from "@hugeicons/react";
import { UserIcon, SecurityLockIcon, Tag01Icon } from "@hugeicons/core-free-icons";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsPanels,
  TabsContent,
} from "@/components/ui/cubby-ui/tabs";
import {
  settingsTabParser,
  type SettingsTabValue,
} from "@/lib/search-params";
import { ReverificationProvider } from "./reverification-provider";
import { ProfileTab } from "./profile-tab";
import { SecurityTab, type BackendSession } from "./security-tab";
import { BillingTab } from "./billing-tab";

export type { BackendSession };

export function CustomSettingsPage() {
  const [activeTab, setActiveTab] = useQueryState("tab", settingsTabParser);

  function handleTabChange(value: string | number | null) {
    if (typeof value !== "string") return;
    setActiveTab(value === "profile" ? null : (value as typeof activeTab));
  }

  return (
    <CustomSettingsPageView activeTab={activeTab} onTabChange={handleTabChange} />
  );
}

/**
 * Presentational settings tabs with the active tab controlled via props — no
 * URL state. Rendered by `CustomSettingsPage` (nuqs-backed) and by the
 * settings page's Suspense fallback, which must not touch useSearchParams so
 * the default state can statically prerender.
 */
export function CustomSettingsPageView({
  activeTab,
  onTabChange,
}: {
  activeTab: SettingsTabValue;
  onTabChange?: (value: string | number | null) => void;
}) {
  return (
    <ReverificationProvider>
      <Tabs value={activeTab} onValueChange={onTabChange} className="gap-8">
        <TabsList variant="underline">
          <TabsTrigger value="profile">
            <HugeiconsIcon icon={UserIcon} data-icon="inline-start" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="security">
            <HugeiconsIcon icon={SecurityLockIcon} data-icon="inline-start" />
            Security
          </TabsTrigger>
          <TabsTrigger value="billing">
            <HugeiconsIcon icon={Tag01Icon} data-icon="inline-start" />
            Billing
          </TabsTrigger>
        </TabsList>
        <TabsPanels>
          <TabsContent value="profile">
            <ProfileTab />
          </TabsContent>
          <TabsContent value="security">
            <SecurityTab />
          </TabsContent>
          <TabsContent value="billing">
            <BillingTab />
          </TabsContent>
        </TabsPanels>
      </Tabs>
    </ReverificationProvider>
  );
}
