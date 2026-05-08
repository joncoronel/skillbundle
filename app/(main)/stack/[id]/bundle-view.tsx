"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
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
import { StarButton } from "@/components/star-button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Share01Icon,
  Edit01Icon,
  Cancel01Icon,
  StarIcon,
} from "@hugeicons/core-free-icons";
import { generateInstallCommands } from "@/lib/install-commands";
import { timeAgo } from "@/lib/utils";

// Admin-only — lazy-loaded so non-admins don't pay the bundle cost. The JSX
// site is also gated on `viewerIsAdmin`, so the chunk is only fetched when
// it'll actually render.
const FeatureToggleButton = dynamic(
  () =>
    import("@/components/admin/feature-toggle-button").then(
      (m) => m.FeatureToggleButton,
    ),
  { ssr: false },
);

interface BundleViewProps {
  preloadedBundle: Preloaded<typeof api.bundles.getByUrlId>;
  preloadedPlan: Preloaded<typeof api.plans.currentPlan>;
  urlId: string;
  shareToken?: string;
  isAuthenticated: boolean;
}

const skillDetailHandle = createSkillDetailHandle();

export function BundleView({
  preloadedBundle,
  preloadedPlan,
  urlId,
  shareToken,
  isAuthenticated,
}: BundleViewProps) {
  const bundle = usePreloadedQuery(preloadedBundle);
  const planData = usePreloadedQuery(preloadedPlan);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const queryArgs = { urlId, shareToken };
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
    return <BundleNotFound />;
  }

  const updatedCount = bundle.skills.filter((s) => s.updatedSinceAdded).length;
  const skillCount = bundle.skills.length;
  const commandCount = generateInstallCommands(bundle.skills).length;

  return (
    <main className="mx-auto max-w-5xl px-4 pt-12 pb-20">
      <div className="space-y-12">
        <header>
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                {/*
                 * Show the badge only when the bundle is *actually* surfaced
                 * as featured — i.e. both editorial-marked AND public.
                 * `featuredAt` deliberately persists across visibility flips so
                 * re-publishing auto-restores featured status, but during the
                 * private window the badge would be misleading (the bundle
                 * isn't on /explore Featured, and listFeatured filters by
                 * isPublic at the query level).
                 */}
                {bundle.featuredAt !== undefined && bundle.isPublic ? (
                  <>
                    <span className="inline-flex items-center gap-1 font-medium text-primary">
                      <HugeiconsIcon
                        icon={StarIcon}
                        aria-hidden
                        className="size-3.5 fill-primary"
                      />
                      Featured
                    </span>
                    <span aria-hidden>·</span>
                  </>
                ) : null}
                <span>by {bundle.creatorName}</span>
              </div>
              <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight leading-hero text-balance wrap-break-word md:text-5xl">
                {bundle.name}
              </h1>

              <p className="mt-4 text-sm text-muted-foreground tabular-nums">
                <MetadataItems
                  skillCount={skillCount}
                  createdAt={bundle.createdAt}
                  copyCount={bundle.copyCount}
                  forkCount={bundle.forkCount}
                  starCount={bundle.starCount}
                />
              </p>

              {bundle.forkedFrom && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Forked from{" "}
                  <Link
                    href={`/stack/${bundle.forkedFrom.urlId}`}
                    className="text-foreground underline-offset-2 hover:underline"
                  >
                    {bundle.forkedFrom.name}
                  </Link>{" "}
                  by {bundle.forkedFrom.creatorName}
                </p>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-2 empty:hidden">
                {/*
                 * Show on public bundles (anyone can star), AND on private
                 * bundles where the viewer has an existing star — so a user
                 * who starred while public can still unstar after the owner
                 * flips private. Matches `toggleStar`'s deliberate allowance
                 * to delete existing stars regardless of visibility.
                 */}
                {bundle.isPublic || bundle.viewerHasStarred ? (
                  <StarButton
                    bundleId={bundle._id}
                    starred={bundle.viewerHasStarred}
                    count={bundle.starCount}
                    isAuthenticated={isAuthenticated}
                  />
                ) : null}
                {bundle.isOwner ? (
                  <>
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
                    {!bundle.isPublic ? (
                      <SharePopover
                        bundleId={bundle._id}
                        urlId={bundle.urlId}
                        shareToken={bundle.shareToken}
                        onGenerate={generateShare}
                        onRevoke={revokeShare}
                      />
                    ) : null}
                  </>
                ) : null}
                {bundle.viewerIsAdmin ? (
                  <FeatureToggleButton
                    bundleId={bundle._id}
                    isPublic={bundle.isPublic}
                    featuredAt={bundle.featuredAt}
                  />
                ) : null}
              </div>
            </div>

            {!bundle.isOwner && (
              <div className="shrink-0">
                <ForkBundleButton
                  bundleId={bundle._id}
                  isAuthenticated={isAuthenticated}
                />
              </div>
            )}
          </div>
        </header>

        {updatedCount > 0 && (
          <div className="rounded-lg bg-primary/10 px-4 py-3">
            <p className="text-sm font-medium">Updates available</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {updatedCount} skill{updatedCount !== 1 ? "s" : ""} updated since
              this bundle was saved — re-run the install commands to get the
              latest versions.
            </p>
          </div>
        )}

        <section>
          <SectionHeader count={commandCount} title="Copy-paste & go." />
          <InstallCommands skills={bundle.skills} bundleId={bundle._id} />
        </section>

        <section>
          <SectionHeader count={skillCount} title="What's inside." />
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
      </div>

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
// Metadata row + section header + toolbar slot
// ---------------------------------------------------------------------------

function MetadataItems({
  skillCount,
  createdAt,
  copyCount,
  forkCount,
  starCount,
}: {
  skillCount: number;
  createdAt: number;
  copyCount: number;
  forkCount: number;
  starCount: number;
}) {
  const items: string[] = [
    `${skillCount} skill${skillCount !== 1 ? "s" : ""}`,
    `Created ${timeAgo(createdAt)}`,
  ];
  if (copyCount > 0) {
    items.push(`${copyCount} ${copyCount !== 1 ? "copies" : "copy"}`);
  }
  if (forkCount > 0) {
    items.push(`${forkCount} fork${forkCount !== 1 ? "s" : ""}`);
  }
  if (starCount > 0) {
    items.push(`${starCount} star${starCount !== 1 ? "s" : ""}`);
  }

  return (
    <>
      {items.map((item, i) => (
        <span key={i}>
          {i > 0 && (
            <span aria-hidden className="px-1.5">
              &middot;
            </span>
          )}
          {item}
        </span>
      ))}
    </>
  );
}

function SectionHeader({ count, title }: { count: number; title: string }) {
  return (
    <div className="mb-5">
      <h2 className="font-display text-2xl font-semibold tracking-tight leading-tight text-balance">
        {title}
        <span className="ml-2 font-normal text-muted-foreground tabular-nums">
          · {count}
        </span>
      </h2>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Not-found state
// ---------------------------------------------------------------------------

function BundleNotFound() {
  return (
    <main className="mx-auto max-w-5xl px-4 pt-20 pb-20">
      <div className="rounded-xl bg-muted/40 px-8 py-20 md:px-12">
        <h1 className="font-display text-4xl font-semibold tracking-tight leading-hero text-balance md:text-5xl">
          This bundle isn&rsquo;t here.
        </h1>
        <p className="mt-3 max-w-md text-sm text-muted-foreground">
          It may have been deleted, set to private, or the link is incorrect.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            nativeButton={false}
            render={<Link href="/explore" />}
          >
            Explore bundles
          </Button>
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href="/" />}
          >
            Back home
          </Button>
        </div>
      </div>
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
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            leftSection={
              <HugeiconsIcon
                icon={Share01Icon}
                strokeWidth={2}
                className="size-3.5"
              />
            }
          />
        }
      >
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
                    icon={Share01Icon}
                    className="size-4"
                    strokeWidth={2}
                  />
                }
              >
                {generating ? "Creating link…" : "Create share link"}
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
            {saving ? "Renaming…" : "Rename"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
