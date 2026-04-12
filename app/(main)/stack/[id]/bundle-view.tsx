"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePreloadedQuery, useMutation, type Preloaded } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SkillCardView } from "@/components/skill-card";
import {
  SkillDetailSheet,
  createSkillDetailHandle,
} from "@/components/skill-detail-sheet";

import { InstallCommands } from "@/components/install-commands";
import { Button } from "@/components/ui/cubby-ui/button";
import { Switch } from "@/components/ui/cubby-ui/switch";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/cubby-ui/tooltip";
import { Input } from "@/components/ui/cubby-ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/cubby-ui/dialog";
import { CopyButton } from "@/components/ui/cubby-ui/copy-button/copy-button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/cubby-ui/popover";
import { ForkBundleButton } from "@/components/explore/fork-bundle-button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Share01Icon,
  Loading03Icon,
  Edit01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";

interface BundleViewProps {
  preloadedBundle: Preloaded<typeof api.bundles.getByUrlId>;
  preloadedPlan: Preloaded<typeof api.plans.currentPlan>;
  urlId: string;
  shareToken?: string;
}

const skillDetailHandle = createSkillDetailHandle();

export function BundleView({
  preloadedBundle,
  preloadedPlan,
  urlId,
  shareToken,
}: BundleViewProps) {
  const bundle = usePreloadedQuery(preloadedBundle);
  const planData = usePreloadedQuery(preloadedPlan);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const queryArgs = { urlId, shareToken };
  const recordEvent = useMutation(api.bundleEvents.recordEvent);
  const viewTracked = useRef(false);

  useEffect(() => {
    if (bundle?._id && !viewTracked.current) {
      viewTracked.current = true;
      recordEvent({ bundleId: bundle._id, eventType: "view" }).catch(() => {});
    }
  }, [bundle?._id, recordEvent]);
  const updateVisibility = useMutation(
    api.bundles.updateBundleVisibility,
  ).withOptimisticUpdate((localStore, { isPublic }) => {
    const current = localStore.getQuery(api.bundles.getByUrlId, queryArgs);
    if (current !== undefined && current !== null) {
      localStore.setQuery(api.bundles.getByUrlId, queryArgs, {
        ...current,
        isPublic,
      });
    }
  });
  const generateShare = useMutation(api.bundles.generateShareToken);
  const revokeShare = useMutation(
    api.bundles.revokeShareToken,
  ).withOptimisticUpdate((localStore) => {
    const current = localStore.getQuery(api.bundles.getByUrlId, queryArgs);
    if (current !== undefined && current !== null) {
      localStore.setQuery(api.bundles.getByUrlId, queryArgs, {
        ...current,
        shareToken: undefined,
      });
    }
  });

  if (bundle === null) {
    return (
      <div className="mx-auto max-w-5xl px-4 pt-24 text-center">
        <h1 className="text-2xl font-bold">Bundle not found</h1>
        <p className="mt-2 text-muted-foreground">
          This bundle may have been deleted or the link is incorrect.
        </p>
        <Button
          variant="primary"
          className="mt-6"
          nativeButton={false}
          render={<Link href="/" />}
        >
          Back to home
        </Button>
      </div>
    );
  }

  const updatedCount = bundle.skills.filter((s) => s.updatedSinceAdded).length;

  return (
    <main className="mx-auto max-w-5xl px-4 pt-12 pb-20">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          {bundle.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          by {bundle.creatorName} &middot; {bundle.skills.length} skill
          {bundle.skills.length !== 1 ? "s" : ""}
        </p>
        {(bundle.viewCount > 0 ||
          bundle.copyCount > 0 ||
          bundle.forkCount > 0) && (
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            {bundle.viewCount > 0 && (
              <span className="font-mono tabular-nums">
                {bundle.viewCount} {bundle.viewCount === 1 ? "view" : "views"}
              </span>
            )}
            {bundle.copyCount > 0 && (
              <span className="font-mono tabular-nums">
                {bundle.copyCount} {bundle.copyCount === 1 ? "copy" : "copies"}
              </span>
            )}
            {bundle.forkCount > 0 && (
              <span className="font-mono tabular-nums">
                {bundle.forkCount} {bundle.forkCount === 1 ? "fork" : "forks"}
              </span>
            )}
          </div>
        )}
        {bundle.forkedFrom && (
          <p className="mt-1 text-xs text-muted-foreground">
            Forked from{" "}
            <Link
              href={`/stack/${bundle.forkedFrom.urlId}`}
              className="underline hover:text-foreground"
            >
              {bundle.forkedFrom.name}
            </Link>{" "}
            by {bundle.forkedFrom.creatorName}
          </p>
        )}
        {!bundle.isOwner && (
          <div className="mt-3">
            <ForkBundleButton bundleId={bundle._id} />
          </div>
        )}

        {bundle.isOwner && (
          <div className="mt-4 flex items-center gap-4 border-t pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRenameDialogOpen(true)}
              leftSection={
                <HugeiconsIcon
                  icon={Edit01Icon}
                  strokeWidth={2}
                  className="size-3.5"
                />
              }
            >
              Rename
            </Button>
            <VisibilityToggle
              bundleId={bundle._id}
              isPublic={bundle.isPublic}
              canMakePrivate={planData.limits?.canMakePrivate ?? false}
              updateVisibility={updateVisibility}
            />
            {!bundle.isPublic && (
              <SharePopover
                bundleId={bundle._id}
                urlId={bundle.urlId}
                shareToken={bundle.shareToken}
                onGenerate={generateShare}
                onRevoke={revokeShare}
              />
            )}
          </div>
        )}
      </div>

      {updatedCount > 0 && (
        <div className="mb-6 rounded-lg border border-info-border bg-info px-4 py-3 text-sm text-info-foreground">
          {updatedCount} skill{updatedCount !== 1 ? "s have" : " has"} been
          updated since you saved this bundle. Re-run the install commands to
          get the latest versions.
        </div>
      )}

      <section className="mb-10">
        <InstallCommands skills={bundle.skills} bundleId={bundle._id} />
      </section>

      <section>
        <h2 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Skills in this bundle
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {bundle.skills.map((skill) => (
            <SkillCardView
              key={`${skill.source}/${skill.skillId}`}
              skill={skill}
              sheetHandle={skillDetailHandle}
            />
          ))}
        </div>
      </section>

      <SkillDetailSheet handle={skillDetailHandle} />

      {bundle.isOwner && (
        <RenameBundleDialog
          open={renameDialogOpen}
          onOpenChange={setRenameDialogOpen}
          bundleId={bundle._id}
          currentName={bundle.name}
          queryArgs={queryArgs}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Share popover
// ---------------------------------------------------------------------------

function SharePopover({
  bundleId,
  urlId,
  shareToken,
  onGenerate,
  onRevoke,
}: {
  bundleId: Id<"bundles">;
  urlId: string;
  shareToken?: string;
  onGenerate: (args: { bundleId: Id<"bundles"> }) => Promise<string>;
  onRevoke: (args: { bundleId: Id<"bundles"> }) => Promise<null>;
}) {
  const [generating, setGenerating] = useState(false);
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/stack/${urlId}?share=${shareToken}`
      : `/stack/${urlId}?share=${shareToken}`;

  async function handleGenerate() {
    setGenerating(true);
    try {
      await onGenerate({ bundleId });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        Share
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        className="w-72"
      >
        <div className="flex flex-col gap-2">
          {shareToken ? (
            <>
              <div className="flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-1.5">
                <span className="min-w-0 flex-1 overflow-x-auto text-nowrap text-xs text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {shareUrl}
                </span>
                <CopyButton content={shareUrl} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Anyone with this link can view
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-destructive"
                  onClick={() => onRevoke({ bundleId })}
                  leftSection={
                    <HugeiconsIcon
                      icon={Cancel01Icon}
                      strokeWidth={2}
                      className="size-3.5"
                    />
                  }
                >
                  Revoke
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Create a link to share this private bundle.
              </p>
              <Button
                variant="primary"
                size="sm"
                onClick={handleGenerate}
                loading={generating}
                rightSection={
                  <HugeiconsIcon
                    icon={generating ? Loading03Icon : Share01Icon}
                    className={generating ? "size-4 animate-spin" : "size-4"}
                    strokeWidth={2}
                  />
                }
              >
                Create share link
              </Button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Visibility toggle (plan-gated)
// ---------------------------------------------------------------------------

function VisibilityToggle({
  bundleId,
  isPublic,
  canMakePrivate,
  updateVisibility,
}: {
  bundleId: Id<"bundles">;
  isPublic: boolean;
  canMakePrivate: boolean;
  updateVisibility: (args: {
    bundleId: Id<"bundles">;
    isPublic: boolean;
  }) => void;
}) {
  const disabled = isPublic && !canMakePrivate;

  const toggle = (
    <div className="flex items-center gap-2">
      <Switch
        id="bundle-visibility"
        checked={isPublic}
        disabled={disabled}
        onCheckedChange={(checked) =>
          updateVisibility({ bundleId, isPublic: checked })
        }
      />
      <label
        htmlFor="bundle-visibility"
        className="text-sm text-muted-foreground"
      >
        {isPublic ? "Public" : "Private"}
      </label>
    </div>
  );

  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger render={<div />}>{toggle}</TooltipTrigger>
        <TooltipContent sideOffset={8}>
          Upgrade to Pro to make bundles private
        </TooltipContent>
      </Tooltip>
    );
  }

  return toggle;
}

// ---------------------------------------------------------------------------
// Rename dialog
// ---------------------------------------------------------------------------

interface RenameBundleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bundleId: Id<"bundles">;
  currentName: string;
  queryArgs: { urlId: string; shareToken?: string };
}

function RenameBundleDialog({
  open,
  onOpenChange,
  bundleId,
  currentName,
  queryArgs,
}: RenameBundleDialogProps) {
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const updateName = useMutation(
    api.bundles.updateBundleName,
  ).withOptimisticUpdate((localStore, { name: newName }) => {
    const current = localStore.getQuery(api.bundles.getByUrlId, queryArgs);
    if (current !== undefined && current !== null) {
      localStore.setQuery(api.bundles.getByUrlId, queryArgs, {
        ...current,
        name: newName.trim(),
      });
    }
  });

  useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentName) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    try {
      await updateName({ bundleId, name: trimmed });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="inset">
        <DialogHeader>
          <DialogTitle>Rename bundle</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div>
            <label
              htmlFor="rename-bundle-name"
              className="text-sm font-medium mb-1.5 block"
            >
              Bundle name
            </label>
            <Input
              id="rename-bundle-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!name.trim() || saving}
            loading={saving}
          >
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
