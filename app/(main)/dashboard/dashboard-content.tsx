"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useConvexAuth } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { BundleCard } from "@/components/bundle-card";
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
import { DashboardStats } from "./dashboard-stats";
import { DashboardEmpty } from "./dashboard-empty";
import { DashboardSkeleton } from "./dashboard-skeleton";
import {
  BundleSectionHeader,
  type SortBy,
} from "./bundle-section-header";

const deleteBundleHandle = createAlertDialogHandle<Id<"bundles">>();

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
  const { isAuthenticated } = useConvexAuth();
  const bundles = useQuery(
    api.bundles.listByUser,
    isAuthenticated ? {} : "skip",
  );
  const planData = useQuery(
    api.plans.currentPlan,
    isAuthenticated ? {} : "skip",
  );

  if (bundles === undefined || planData === undefined) {
    return <DashboardSkeleton />;
  }
  return <DashboardLoaded bundles={bundles} planData={planData} />;
}

function DashboardLoaded({
  bundles,
  planData,
}: {
  bundles: FunctionReturnType<typeof api.bundles.listByUser>;
  planData: FunctionReturnType<typeof api.plans.currentPlan>;
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
  const limits = planData.limits;
  const [sortBy, setSortBy] = useState<SortBy>("newest");

  const sortedBundles = useMemo(() => {
    const list = [...bundles];
    switch (sortBy) {
      case "most-copied":
        return list.sort(
          (a, b) => (b.copyCount ?? 0) - (a.copyCount ?? 0),
        );
      case "alphabetical":
        return list.sort((a, b) => a.name.localeCompare(b.name));
      case "newest":
      default:
        return list.sort((a, b) => b.createdAt - a.createdAt);
    }
  }, [bundles, sortBy]);

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

  if (bundles.length === 0) {
    return <DashboardEmpty />;
  }

  return (
    <>
      <div className="space-y-10">
        <DashboardStats
          bundles={bundles}
          plan={planData.plan}
          limits={planData.limits}
        />

        <section className="space-y-5">
          <BundleSectionHeader
            count={bundles.length}
            sortBy={sortBy}
            onSortChange={setSortBy}
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 motion-reduce:animate-none">
            {sortedBundles.map((bundle, i) => (
              <div
                key={bundle._id}
                className="animate-in fade-in slide-in-from-bottom-2 fill-mode-[both] motion-reduce:animate-none"
                style={{
                  animationDelay: `${i * 30}ms`,
                  animationDuration: "150ms",
                }}
              >
                <BundleCard
                  name={bundle.name}
                  urlId={bundle.urlId}
                  description={bundle.description}
                  skillCount={bundle.skills.length}
                  createdAt={bundle.createdAt}
                  creatorName="You"
                  isPublic={bundle.isPublic}
                  copyCount={bundle.copyCount}
                  actions={
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="xs"
                        nativeButton={false}
                        render={<Link href={`/bundle/${bundle.urlId}`} />}
                        leftSection={
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
                        onClick={() => {
                          if (bundle.isPublic && !limits?.canMakePrivate) {
                            toast.info({
                              title: "Pro feature",
                              description:
                                "Upgrade to Pro to make bundles private.",
                            });
                            return;
                          }
                          updateVisibility({
                            bundleId: bundle._id,
                            isPublic: !bundle.isPublic,
                          });
                        }}
                        leftSection={
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
                        payload={bundle._id}
                        render={
                          <Button
                            variant="ghost"
                            size="xs"
                            leftSection={
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
                  }
                />
              </div>
            ))}
          </div>
        </section>
      </div>

      <AlertDialog handle={deleteBundleHandle}>
        {({ payload: bundleId }) => (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete bundle</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this bundle and its shareable
                link. This action cannot be undone.
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
                    onClick={() => bundleId && handleDelete(bundleId)}
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
