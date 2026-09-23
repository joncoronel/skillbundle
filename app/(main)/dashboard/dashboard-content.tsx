"use client";

import Link from "next/link";
import { useQuery, useMutation, useConvexAuth } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { HugeiconsIcon } from "@hugeicons/react";
import { EyeIcon, LockIcon, Delete01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";
import { toast } from "@/components/ui/cubby-ui/toast/toast";
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
import { ChangeFeed } from "./change-feed";
import { DashboardStats } from "./dashboard-stats";
import { DashboardEmpty } from "./dashboard-empty";
import { DashboardSkeleton } from "./dashboard-skeleton";
import { BundleGrid } from "./bundle-grid";
import { LocalBundleGrid, LocalDashboard } from "./local-dashboard";
import { useLocalBundles, useLocalImportSettled } from "@/lib/local-bundles";
import { isFault } from "@/lib/monitoring/conditions";

const deleteBundleHandle = createAlertDialogHandle<{
  id: Id<"bundles">;
  name: string;
}>();

export function DashboardContent() {
  // Client-fetched over the root layout's Convex websocket — the route is
  // static (see page.tsx). Both queries are live subscriptions (what
  // usePreloadedQuery degraded to after its first frame anyway), and the
  // optimistic updates below write to the same client cache these read from.
  //
  // The queries MUST be gated on auth: subscriptions made before the
  // Clerk→Convex handshake completes execute unauthenticated, and listByUser
  // returns [] (not undefined) for an anonymous caller — ungated, a signed-in
  // cold load briefly flashes the empty state. Skipped queries return
  // undefined, so the skeleton covers the handshake window.
  const { isAuthenticated, isLoading } = useConvexAuth();
  const bundles = useQuery(
    api.bundles.listByUser,
    isAuthenticated ? {} : "skip",
  );
  const planData = useQuery(
    api.plans.currentPlan,
    isAuthenticated ? {} : "skip",
  );
  const feed = useQuery(
    api.skillVersions.listRecentChangesForUser,
    isAuthenticated ? {} : "skip",
  );

  // `feed` is deliberately NOT in this gate. It is the heaviest of the three
  // (it fans out over every watched skill), and AND-ing it here made every
  // dashboard visit pay the slowest query's latency for the whole page —
  // against docs/architecture.md's Suspense-default-state principle, which says
  // a surface paints its meaningful default and lets slower islands fill in.
  // ChangeFeed owns its own pending state.
  if (isLoading) return <DashboardSkeleton />;
  // Signed out: the bundles saved in this browser. The route stopped being
  // sign-in-only so saving a bundle never starts with an account.
  if (!isAuthenticated) return <LocalDashboard />;
  if (bundles === undefined || planData === undefined) {
    return <DashboardSkeleton />;
  }
  return <DashboardLoaded bundles={bundles} planData={planData} feed={feed} />;
}

function DashboardLoaded({
  bundles,
  planData,
  feed,
}: {
  bundles: FunctionReturnType<typeof api.bundles.listByUser>;
  planData: FunctionReturnType<typeof api.plans.currentPlan>;
  feed:
    | FunctionReturnType<typeof api.skillVersions.listRecentChangesForUser>
    | undefined;
}) {
  const deleteBundle = useMutation(
    api.bundles.deleteBundle,
  ).withOptimisticUpdate((localStore, { bundleId }) => {
    const current = localStore.getQuery(api.bundles.listByUser, {});
    if (current !== undefined) {
      localStore.setQuery(
        api.bundles.listByUser,
        {},
        current.filter((b) => b._id !== bundleId),
      );
    }
  });
  const markAllViewed = useMutation(
    api.bundles.markAllBundlesViewed,
  ).withOptimisticUpdate((localStore) => {
    // Empty the feed synchronously so the panel settles the moment the button
    // is pressed. This is the payoff gesture of the whole surface; waiting a
    // round trip to see "all clear" would flatten it.
    for (const q of localStore.getAllQueries(
      api.skillVersions.listRecentChangesForUser,
    )) {
      if (q.value === undefined) continue;
      localStore.setQuery(api.skillVersions.listRecentChangesForUser, q.args, {
        ...q.value,
        // Faults survive. Marking read acknowledges CHANGES; a skill that is
        // still delisted is still delisted, and dropping it here would make the
        // button look like it fixed something. The server agrees (faults do
        // not consult the baseline), so clearing them optimistically would
        // also flicker them straight back on the next round trip.
        items: q.value.items.filter((i) => isFault(i.condition)),
        suppressed: false,
      });
    }
  });
  const updateVisibility = useMutation(
    api.bundles.updateBundleVisibility,
  ).withOptimisticUpdate((localStore, { bundleId, isPublic }) => {
    const current = localStore.getQuery(api.bundles.listByUser, {});
    if (current !== undefined) {
      localStore.setQuery(
        api.bundles.listByUser,
        {},
        current.map((b) => (b._id === bundleId ? { ...b, isPublic } : b)),
      );
    }
  });
  // Bundles still in this browser after sign-in: the ones LocalBundleImporter
  // could not move because they would take the account past its limits.
  // Shown rather than hidden, since they still exist and still hold skills.
  // Only once the import has run, or every browser bundle would show here for
  // the moment between sign-in and the import landing.
  const localBundles = useLocalBundles();
  const importSettled = useLocalImportSettled();
  const leftoverLocal = importSettled ? localBundles : undefined;

  // Non-blocking delete: AlertDialogClose closes the dialog immediately,
  // the optimistic update filters the bundle out of the list synchronously,
  // and failures surface via toast. Convex auto-reverts the cache on error.
  function handleDelete(bundleId: Id<"bundles">) {
    const pending = deleteBundle({ bundleId });
    pending.catch((error: unknown) => {
      let message = "Couldn't reach the server. Try again.";
      if (error instanceof ConvexError && typeof error.data === "string") {
        message = error.data;
      } else if (error instanceof Error) {
        message = error.message;
      }
      toast.error({ title: "Couldn't delete bundle", description: message });
    });
  }

  const leftover =
    leftoverLocal && leftoverLocal.length > 0 ? (
      <div className="space-y-3">
        <LocalBundleGrid
          bundles={leftoverLocal}
          title="Still in this browser"
        />
        <p className="max-w-prose text-sm text-muted-foreground">
          These couldn&rsquo;t move to your account when you signed in, usually
          because they would take you past your plan&rsquo;s watched-skill
          limit.{" "}
          <Link
            href="/pricing"
            className="font-medium text-foreground underline decoration-muted-foreground/50 underline-offset-2 transition-colors hover:decoration-foreground"
          >
            Upgrade
          </Link>{" "}
          or remove skills from your bundles and they&rsquo;ll move on your next
          visit.
        </p>
      </div>
    ) : null;

  if (bundles.length === 0) {
    // Browser bundles still on their way in (sign-in usually lands here):
    // "Start with a stack" would flash before they arrive.
    if (!importSettled && localBundles && localBundles.length > 0) {
      return <DashboardSkeleton />;
    }
    return leftover ?? <DashboardEmpty />;
  }

  return (
    <>
      <div className="space-y-10">
        {/* State before inventory (PRODUCT.md principle 3): the panel answers
            "is anything wrong?" above the fold, and the bundle grid answers
            "what do I have?" underneath it. */}
        <ChangeFeed feed={feed} onMarkAllRead={() => void markAllViewed({})} />

        <DashboardStats
          bundles={bundles}
          plan={planData.plan}
          limits={planData.limits}
        />

        <BundleGrid
          items={bundles.map((bundle) => ({
            key: bundle._id,
            name: bundle.name,
            description: bundle.description,
            skillCount: bundle.skills.length,
            createdAt: bundle.createdAt,
            isPublic: bundle.isPublic,
            actions: (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  className="h-9 sm:h-7"
                  nativeButton={false}
                  render={<Link href={`/bundle/${bundle.urlId}`} />}
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
                <Button
                  variant="ghost"
                  size="xs"
                  className="h-9 sm:h-7"
                  onClick={() => {
                    updateVisibility({
                      bundleId: bundle._id,
                      isPublic: !bundle.isPublic,
                    });
                  }}
                  leadingIcon={
                    <HugeiconsIcon
                      icon={LockIcon}
                      strokeWidth={2}
                      className="size-3.5"
                    />
                  }
                >
                  {bundle.isPublic ? "Make private" : "Make public"}
                </Button>
                <AlertDialogTrigger
                  handle={deleteBundleHandle}
                  payload={{ id: bundle._id, name: bundle.name }}
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

        {leftover}
      </div>

      <AlertDialog handle={deleteBundleHandle}>
        {({ payload }) => (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete bundle</AlertDialogTitle>
              <AlertDialogDescription>
                <span className="font-medium text-foreground">
                  {payload?.name}
                </span>{" "}
                and its shareable link will be permanently deleted. This action
                cannot be undone.
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
                    onClick={() => payload && handleDelete(payload.id)}
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
