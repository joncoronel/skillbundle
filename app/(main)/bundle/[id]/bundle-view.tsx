"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePreloadedQuery, useMutation, type Preloaded } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SkillCardView } from "@/components/skill-card";
import {
  SkillDetailSheet,
  createSkillDetailHandle,
} from "@/components/skill-detail-sheet";

import {
  InstallCommands,
  CopyAllCommandsButton,
} from "@/components/install-commands";
import { Button } from "@/components/ui/cubby-ui/button";
import { Input } from "@/components/ui/cubby-ui/input";
import { Textarea } from "@/components/ui/cubby-ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogClose,
  DialogTrigger,
  createDialogHandle,
} from "@/components/ui/cubby-ui/dialog";
import { CopyButton } from "@/components/ui/cubby-ui/copy-button/copy-button";
import { toast } from "@/components/ui/cubby-ui/toast/toast";
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
  Edit02Icon,
  Cancel01Icon,
  StarIcon,
  PencilEdit02Icon,
  LockIcon,
} from "@hugeicons/core-free-icons";
import { generateInstallCommands } from "@/lib/install-commands";
import { timeAgo } from "@/lib/utils";
import { EditableSkillSection } from "@/components/bundle-edit/editable-skill-section";
import { MAX_BUNDLE_DESCRIPTION_LENGTH } from "@/lib/bundle-limits";

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
const descriptionDialogHandle = createDialogHandle();
const renameBundleDialogHandle = createDialogHandle();

export function BundleView({
  preloadedBundle,
  preloadedPlan,
  urlId,
  shareToken,
  isAuthenticated,
}: BundleViewProps) {
  const bundle = usePreloadedQuery(preloadedBundle);
  const planData = usePreloadedQuery(preloadedPlan);
  const [editingSkills, setEditingSkills] = useState(false);
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
    <main className="mx-auto max-w-6xl px-4 pt-12 pb-20">
      <div className="space-y-12">
        <header>
          <div>
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
              <h1 className="mt-2 font-display text-4xl font-medium tracking-tight leading-hero text-balance wrap-break-word md:text-5xl">
                {bundle.name}
              </h1>

              <BundleDescription
                description={bundle.description}
                isOwner={bundle.isOwner}
              />

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
                    href={`/bundle/${bundle.forkedFrom.urlId}`}
                    className="text-foreground underline-offset-2 hover:underline"
                  >
                    {bundle.forkedFrom.name}
                  </Link>{" "}
                  by {bundle.forkedFrom.creatorName}
                </p>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-2 empty:hidden">
                {/* Viewer actions grouped together, Fork leading. */}
                {!bundle.isOwner ? (
                  <ForkBundleButton
                    bundleId={bundle._id}
                    isAuthenticated={isAuthenticated}
                  />
                ) : null}
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
                    <DialogTrigger
                      handle={renameBundleDialogHandle}
                      render={
                        <Button
                          variant="outline"
                          size="sm"
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
                      }
                    />
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
        </header>

        {updatedCount > 0 && (
          <div className="rounded-lg bg-primary/10 px-4 py-3">
            <p className="text-sm font-medium">Updates available</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {updatedCount} skill{updatedCount !== 1 ? "s" : ""} updated since
              this bundle was saved. Re-run the install commands to get the
              latest versions.
            </p>
          </div>
        )}

        {commandCount > 0 && (
          <section>
            <SectionHeader
              title="Install"
              action={
                <CopyAllCommandsButton
                  skills={bundle.skills}
                  bundleId={bundle._id}
                />
              }
            />
            <InstallCommands skills={bundle.skills} bundleId={bundle._id} />
          </section>
        )}

        <section>
          {/* Co-locate the Edit-skills affordance with the section it
              modifies: the bundle-identity actions (Rename, Visibility,
              Share) stay in the header, while "Edit skills" sits with the
              skills it acts on. */}
          <SectionHeader
            title="Skills"
            count={skillCount}
            action={
              bundle.isOwner ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingSkills(true)}
                  disabled={editingSkills}
                  leftSection={
                    <HugeiconsIcon
                      icon={PencilEdit02Icon}
                      strokeWidth={2}
                      className="size-3.5"
                    />
                  }
                >
                  Edit skills
                </Button>
              ) : null
            }
          />
          {/* Read-only grid: visible whenever we're not in edit mode (or
              for non-owners who can never enter edit mode). */}
          {!(bundle.isOwner && editingSkills) ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {bundle.skills.map((skill) => (
                <SkillCardView
                  key={`${skill.source}/${skill.skillId}`}
                  skill={skill}
                  sheetHandle={skillDetailHandle}
                  enableQuickAdd={isAuthenticated}
                  currentBundleId={bundle._id}
                />
              ))}
            </div>
          ) : null}
          {/* Edit infrastructure: mounts unconditionally for owners so the
              BundleEditBar can animate in/out via its `open` prop instead
              of being yanked out of the tree when edit mode exits. The
              diff grid renders only when `editing` is true. */}
          {bundle.isOwner ? (
            <EditableSkillSection
              key={bundle._id}
              editing={editingSkills}
              bundleId={bundle._id}
              queryArgs={queryArgs}
              initialSkills={bundle.skills}
              sheetHandle={skillDetailHandle}
              onExit={() => setEditingSkills(false)}
            />
          ) : null}
        </section>
      </div>

      <SkillDetailSheet
        handle={skillDetailHandle}
        footerAction="copy-install"
      />

      {bundle.isOwner && (
        <>
          <RenameBundleDialog
            bundleId={bundle._id}
            currentName={bundle.name}
            queryArgs={queryArgs}
          />
          <DescriptionDialog
            bundleId={bundle._id}
            currentDescription={bundle.description}
            queryArgs={queryArgs}
          />
        </>
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

function SectionHeader({
  count,
  title,
  action,
}: {
  count?: number;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3">
      <h2 className="text-xl font-semibold tracking-tight">
        {title}
        {count !== undefined ? (
          <span className="ml-2 font-normal text-muted-foreground tabular-nums">
            · {count}
          </span>
        ) : null}
      </h2>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Not-found state
// ---------------------------------------------------------------------------

function BundleNotFound() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-20 pb-20">
      <div className="rounded-xl bg-muted/40 px-8 py-20 md:px-12">
        <h1 className="font-display text-4xl font-medium tracking-tight leading-hero text-balance md:text-5xl">
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
      ? `${window.location.origin}/bundle/${urlId}?share=${shareToken}`
      : `/bundle/${urlId}?share=${shareToken}`;

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
                  variant="destructive-soft"
                  size="xs"
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
  // Gate is surfaced inline (the "Pro" tag) rather than in a hover tooltip,
  // so touch users see it too. Matches the dashboard's Make-private button.
  const gated = isPublic && !canMakePrivate;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        if (gated) {
          toast.info({
            title: "Pro feature",
            description: "Upgrade to Pro to make bundles private.",
          });
          return;
        }
        updateVisibility({ bundleId, isPublic: !isPublic });
      }}
      leftSection={
        <HugeiconsIcon icon={LockIcon} strokeWidth={2} className="size-3.5" />
      }
      rightSection={
        gated ? (
          <span className="rounded bg-secondary px-1 py-0.5 font-mono text-[10px] font-medium uppercase tracking-eyebrow text-muted-foreground">
            Pro
          </span>
        ) : undefined
      }
    >
      {isPublic ? "Make private" : "Make public"}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Rename dialog
// ---------------------------------------------------------------------------

interface RenameBundleDialogProps {
  bundleId: Id<"bundles">;
  currentName: string;
  queryArgs: { urlId: string; shareToken?: string };
}

function RenameBundleDialog({
  bundleId,
  currentName,
  queryArgs,
}: RenameBundleDialogProps) {
  const titleId = useId();
  const [name, setName] = useState(currentName);
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

  // Non-blocking save: fire the mutation, close instantly, surface failures
  // via toast. The optimistic update has already patched the page header,
  // so closing immediately matches reality. Convex auto-reverts on failure.
  function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trimmed !== currentName) {
      const pending = updateName({ bundleId, name: trimmed });
      pending.catch((error: unknown) => {
        let message = "Couldn't reach the server. Try again.";
        if (error instanceof ConvexError && typeof error.data === "string") {
          message = error.data;
        } else if (error instanceof Error) {
          message = error.message;
        }
        toast.error({
          title: "Couldn't rename bundle",
          description: message,
        });
      });
    }
    renameBundleDialogHandle.close();
  }

  return (
    <Dialog
      handle={renameBundleDialogHandle}
      onOpenChange={(open) => {
        // Reset to the latest currentName on every open transition. See
        // DescriptionDialog for the rationale on reset-on-open vs effect.
        if (open) setName(currentName);
      }}
    >
      <DialogContent variant="inset">
        <DialogHeader>
          <DialogTitle id={titleId}>Rename bundle</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
          className="flex flex-1 min-h-0 flex-col"
        >
          <DialogBody>
            <Input
              aria-labelledby={titleId}
              variant="elevated"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My React stack"
              required
            />
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button type="submit" variant="primary" disabled={!name.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Bundle description display + edit
// ---------------------------------------------------------------------------

function BundleDescription({
  description,
  isOwner,
}: {
  description?: string;
  isOwner: boolean;
}) {
  if (!description) {
    if (!isOwner) return null;
    return (
      <DialogTrigger
        handle={descriptionDialogHandle}
        render={
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <HugeiconsIcon
              icon={Edit02Icon}
              strokeWidth={2}
              className="size-3.5"
            />
            Add a description
          </button>
        }
      />
    );
  }

  return (
    <div className="mt-3 group/desc relative max-w-2xl">
      <p className="text-sm text-foreground/85 wrap-break-word whitespace-pre-wrap">
        {description}
      </p>
      {isOwner ? (
        <DialogTrigger
          handle={descriptionDialogHandle}
          render={
            <button
              type="button"
              aria-label="Edit description"
              className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <HugeiconsIcon
                icon={Edit02Icon}
                strokeWidth={2}
                className="size-3"
              />
              Edit description
            </button>
          }
        />
      ) : null}
    </div>
  );
}

interface DescriptionDialogProps {
  bundleId: Id<"bundles">;
  currentDescription?: string;
  queryArgs: { urlId: string; shareToken?: string };
}

function DescriptionDialog({
  bundleId,
  currentDescription,
  queryArgs,
}: DescriptionDialogProps) {
  const titleId = useId();
  const [value, setValue] = useState(currentDescription ?? "");
  const updateDescription = useMutation(
    api.bundles.updateBundleDescription,
  ).withOptimisticUpdate((localStore, { description }) => {
    const current = localStore.getQuery(api.bundles.getByUrlId, queryArgs);
    if (current !== undefined && current !== null) {
      const trimmed = description.trim();
      localStore.setQuery(api.bundles.getByUrlId, queryArgs, {
        ...current,
        description: trimmed.length === 0 ? undefined : trimmed,
      });
    }
  });

  // Non-blocking save: fire the mutation, close the dialog immediately,
  // surface failures via toast. The optimistic update has already patched
  // the page's view of the description, so closing instantly matches
  // reality. Convex auto-reverts the cache on failure.
  function handleSubmit() {
    const trimmed = value.trim();
    if (trimmed !== (currentDescription ?? "")) {
      const pending = updateDescription({ bundleId, description: trimmed });
      pending.catch((error: unknown) => {
        let message = "Couldn't reach the server. Try again.";
        if (error instanceof ConvexError && typeof error.data === "string") {
          message = error.data;
        } else if (error instanceof Error) {
          message = error.message;
        }
        toast.error({
          title: "Couldn't save description",
          description: message,
        });
      });
    }
    descriptionDialogHandle.close();
  }

  const overLimit = value.trim().length > MAX_BUNDLE_DESCRIPTION_LENGTH;

  return (
    <Dialog
      handle={descriptionDialogHandle}
      onOpenChange={(open) => {
        // Snap the textarea to the latest currentDescription each time the
        // dialog opens. Reset-on-open (not on close) ensures the field is
        // fresh against the truth at the moment the user sees it — handles
        // both stale-draft-after-cancel and external currentDescription
        // updates that happened while the dialog was closed.
        if (open) setValue(currentDescription ?? "");
      }}
    >
      <DialogContent variant="inset">
        <DialogHeader>
          <DialogTitle id={titleId}>
            {currentDescription ? "Edit description" : "Add a description"}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
          className="flex flex-1 min-h-0 flex-col"
        >
          <DialogBody>
            <Textarea
              aria-labelledby={titleId}
              variant="elevated"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="What's this bundle for?"
              className="min-h-28"
              maxLength={MAX_BUNDLE_DESCRIPTION_LENGTH + 50}
            />
            <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground tabular-nums">
              <span>Optional</span>
              <span
                className={
                  overLimit ? "text-destructive font-medium" : undefined
                }
              >
                {value.trim().length} / {MAX_BUNDLE_DESCRIPTION_LENGTH}
              </span>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button type="submit" variant="primary" disabled={overLimit}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
