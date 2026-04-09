"use client";

import { useState } from "react";
import Link from "next/link";
import { usePreloadedQuery, useMutation, type Preloaded } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { BundleCard } from "@/components/bundle-card";
import { HugeiconsIcon } from "@hugeicons/react";
import { EyeIcon, LockIcon, Delete01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";
import { useUserPlan } from "@/hooks/use-user-plan";
import { toast } from "@/components/ui/cubby-ui/toast/toast";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogClose,
} from "@/components/ui/cubby-ui/alert-dialog";

interface DashboardContentProps {
  preloadedBundles: Preloaded<typeof api.bundles.listByUser>;
}

export function DashboardContent({ preloadedBundles }: DashboardContentProps) {
  const bundles = usePreloadedQuery(preloadedBundles);
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
  const { limits } = useUserPlan();
  const [deletingId, setDeletingId] = useState<Id<"bundles"> | null>(null);

  async function handleDelete() {
    if (!deletingId) return;
    await deleteBundle({ bundleId: deletingId });
    setDeletingId(null);
  }

  if (bundles.length === 0) {
    return (
      <div className="py-20 text-center">
        <h2 className="text-lg font-semibold">No bundles yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Select some skills and save your first bundle.
        </p>
        <Button
          variant="primary"
          className="mt-6"
          nativeButton={false}
          render={<Link href="/" />}
        >
          Create your first bundle
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {bundles.map((bundle, i) => (
          <div
            key={bundle._id}
            className="animate-in fade-in slide-in-from-bottom-2 fill-mode-[both]"
            style={{ animationDelay: `${i * 30}ms`, animationDuration: "150ms" }}
          >
            <BundleCard
              name={bundle.name}
              urlId={bundle.urlId}
              skillCount={bundle.skills.length}
              createdAt={bundle.createdAt}
              creatorName="You"
              isPublic={bundle.isPublic}
              viewCount={bundle.viewCount}
              actions={
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="xs"
                    nativeButton={false}
                    render={<Link href={`/stack/${bundle.urlId}`} />}
                    leftSection={<HugeiconsIcon icon={EyeIcon} strokeWidth={2} className="size-3.5" />}
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
                          description: "Upgrade to Pro to make bundles private.",
                        });
                        return;
                      }
                      updateVisibility({
                        bundleId: bundle._id,
                        isPublic: !bundle.isPublic,
                      });
                    }}
                    leftSection={<HugeiconsIcon icon={LockIcon} strokeWidth={2} className="size-3.5" />}
                  >
                    {bundle.isPublic ? "Make private" : "Make public"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setDeletingId(bundle._id)}
                    leftSection={<HugeiconsIcon icon={Delete01Icon} strokeWidth={2} className="size-3.5" />}
                  >
                    Delete
                  </Button>
                </div>
              }
            />
          </div>
        ))}
      </div>

      <AlertDialog
        open={deletingId !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete bundle</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this bundle and its shareable link.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="outline">Cancel</Button>}
            />
            <AlertDialogClose
              render={<Button variant="destructive" onClick={handleDelete}>Delete</Button>}
            />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
