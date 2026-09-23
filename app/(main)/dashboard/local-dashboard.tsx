"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete01Icon, EyeIcon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/cubby-ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogClose,
  AlertDialogTrigger,
  createAlertDialogHandle,
} from "@/components/ui/cubby-ui/alert-dialog";
import { signInUrl } from "@/components/auth/shared";
import { FREE_WATCHED_SKILLS } from "@/lib/bundle-limits";
import { isFault } from "@/lib/monitoring/conditions";
import {
  useLocalBundleActions,
  useLocalBundles,
  type LocalBundle,
} from "@/lib/local-bundles";
import { localBundleHref, localFeedTargets } from "@/lib/local-bundles-core";
import { ChangeFeed } from "./change-feed";
import { DashboardStats } from "./dashboard-stats";
import { DashboardEmpty } from "./dashboard-empty";
import { DashboardSkeleton } from "./dashboard-skeleton";
import { BundleGrid } from "./bundle-grid";

const deleteLocalBundleHandle = createAlertDialogHandle<{
  id: string;
  name: string;
}>();

/** The signed-out dashboard: bundles saved in this browser, same status panel. */
export function LocalDashboard() {
  const bundles = useLocalBundles();
  const { markAllViewed } = useLocalBundleActions();
  const targets = useMemo(
    () => (bundles ? localFeedTargets(bundles) : []),
    [bundles],
  );
  const feedQuery = useQuery({
    ...convexQuery(api.skillVersions.listRecentChangesForSkills, {
      skills: targets,
    }),
    enabled: bundles !== undefined && bundles.length > 0,
    placeholderData: keepPreviousData,
  });
  // "Mark all read" changes the query's arguments, so hide the old answer's
  // changes (not its faults) until the new one lands.
  const [clearedPending, setClearedPending] = useState(false);
  if (clearedPending && !feedQuery.isPlaceholderData) {
    setClearedPending(false);
  }
  const feed =
    clearedPending && feedQuery.isPlaceholderData && feedQuery.data
      ? {
          ...feedQuery.data,
          items: feedQuery.data.items.filter((i) => isFault(i.condition)),
          suppressed: false,
        }
      : feedQuery.data;

  if (bundles === undefined) return <DashboardSkeleton />;
  if (bundles.length === 0) return <DashboardEmpty signedOut />;

  return (
    <div className="space-y-10">
      <ChangeFeed
        feed={feed}
        onMarkAllRead={() => {
          setClearedPending(true);
          markAllViewed();
        }}
      />

      <div className="space-y-3">
        <DashboardStats
          bundles={bundles}
          plan="free"
          limits={{ maxWatchedSkills: FREE_WATCHED_SKILLS }}
        />
        <p className="max-w-prose text-sm text-muted-foreground">
          Saved in this browser.{" "}
          <Link
            href={signInUrl("/dashboard")}
            className="font-medium text-foreground underline decoration-muted-foreground/50 underline-offset-2 transition-colors hover:decoration-foreground"
          >
            Sign in
          </Link>{" "}
          to share your bundles and keep them on every device. They move to your
          account when you do.
        </p>
      </div>

      <LocalBundleGrid bundles={bundles} />
    </div>
  );
}

/** Browser bundles as cards; also shows signed in for any the import left. */
export function LocalBundleGrid({
  bundles,
  title,
}: {
  bundles: LocalBundle[];
  title?: string;
}) {
  const { remove } = useLocalBundleActions();

  return (
    <>
      <BundleGrid
        title={title}
        items={bundles.map((bundle) => ({
          key: bundle.id,
          name: bundle.name,
          description: bundle.description,
          skillCount: bundle.skills.length,
          createdAt: bundle.createdAt,
          isPublic: false,
          actions: (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="xs"
                className="h-9 sm:h-7"
                nativeButton={false}
                render={<Link href={localBundleHref(bundle.id)} />}
                leadingIcon={
                  <HugeiconsIcon
                    icon={EyeIcon}
                    strokeWidth={2}
                    className="size-3.5"
                  />
                }
              >
                View
              </Button>
              <AlertDialogTrigger
                handle={deleteLocalBundleHandle}
                payload={{ id: bundle.id, name: bundle.name }}
                render={
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-9 sm:h-7"
                    leadingIcon={
                      <HugeiconsIcon
                        icon={Delete01Icon}
                        strokeWidth={2}
                        className="size-3.5"
                      />
                    }
                  >
                    Delete
                  </Button>
                }
              />
            </div>
          ),
        }))}
      />

      <AlertDialog handle={deleteLocalBundleHandle}>
        {({ payload }) => (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete bundle</AlertDialogTitle>
              <AlertDialogDescription>
                <span className="font-medium text-foreground">
                  {payload?.name}
                </span>{" "}
                will be removed from this browser. This can&rsquo;t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose
                render={<Button variant="outline">Cancel</Button>}
              />
              <AlertDialogClose
                render={
                  <Button
                    variant="destructive"
                    onClick={() => payload && remove(payload.id)}
                  >
                    Delete
                  </Button>
                }
              />
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </>
  );
}
