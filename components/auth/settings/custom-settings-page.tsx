"use client";

import { useQueryState } from "nuqs";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  UserIcon,
  SecurityLockIcon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsPanels,
  TabsContent,
} from "@/components/ui/cubby-ui/tabs";
import { settingsTabParser, type SettingsTabValue } from "@/lib/search-params";
import { cn } from "@/lib/utils";
import { ReverificationProvider } from "@/components/auth/reverification-provider";
import { ProfileTab } from "./profile-tab";
import { SecurityTab, type BackendSession } from "./security-tab";
import { BillingTab } from "./billing-tab";

export type { BackendSession };

/**
 * Replaces the component's default panel transition (`disableAnimation` turns
 * that off) with an opacity-only crossfade.
 *
 * The default fades, blurs and slides for 350ms while the container animates
 * its height for another 400ms — four things at once on a full-width panel,
 * with the incoming content blurred over the whole window the reader is trying
 * to use it. Switching a settings tab is navigation, not a reveal; the skill
 * page's tab strip cut the equivalent fade outright (see `skill-tabs.tsx`).
 *
 * What survives is the smallest thing that still says "this changed": opacity
 * at 180ms, finishing before the container height settles at 300ms so the swap
 * reads as one movement rather than two. Same `ease-out-expo` as the height for
 * the same reason.
 *
 * `contain-[size]` on the exiting panel is load-bearing, not styling. Both
 * panels share one grid area, so without it the outgoing panel keeps
 * contributing to the measured height and the container animates toward the
 * taller of the two instead of the incoming one.
 */
const PANEL_MOTION = cn(
  "ease-out-expo transition-opacity duration-180",
  "data-starting-style:opacity-0",
  "data-ending-style:opacity-0 data-ending-style:contain-[size]",
  "motion-reduce:transition-none",
);

export function CustomSettingsPage() {
  const [activeTab, setActiveTab] = useQueryState("tab", settingsTabParser);

  function handleTabChange(value: string | number | null) {
    if (typeof value !== "string") return;
    setActiveTab(value === "profile" ? null : (value as typeof activeTab));
  }

  return (
    <CustomSettingsPageView
      activeTab={activeTab}
      onTabChange={handleTabChange}
    />
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
        <TabsPanels
          className={cn(
            // The height animation is the only part of a tab swap that earns
            // its keep: the tabs differ by hundreds of pixels (Profile and
            // Security carry three sections, Billing carries one), so an
            // instant resize teleports everything below the panel. Shortened
            // from the component default of 400ms, and gated for reduced
            // motion — the default is not, so the container would keep sliding
            // while `PANEL_MOTION` below correctly stopped.
            "has-[>_*_>_[data-ending-style]]:duration-300",
            // `!` is load-bearing. The rule this overrides is
            // `has-[…]:transition-[height]`, whose `:has()` outranks a plain
            // class, so an unmarked `motion-reduce:transition-none` computes to
            // `transition-property: height` anyway. Measured: with reduced
            // motion emulated, the panel correctly reported `none` while this
            // container still reported `height`.
            "motion-reduce:transition-none!",
          )}
        >
          <TabsContent
            value="profile"
            className={PANEL_MOTION}
            disableAnimation
          >
            <ProfileTab />
          </TabsContent>
          <TabsContent
            value="security"
            className={PANEL_MOTION}
            disableAnimation
          >
            <SecurityTab />
          </TabsContent>
          <TabsContent
            value="billing"
            className={PANEL_MOTION}
            disableAnimation
          >
            <BillingTab />
          </TabsContent>
        </TabsPanels>
      </Tabs>
    </ReverificationProvider>
  );
}
