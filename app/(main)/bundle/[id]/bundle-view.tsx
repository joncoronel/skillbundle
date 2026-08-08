"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  usePreloadedQuery,
  useMutation,
  useQuery,
  type Preloaded,
} from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  BundleRegister,
  RegisterTally,
  buildRegister,
} from "@/components/bundle/bundle-register";
import {
  SkillDetailSheet,
  SkillDetailHandleProvider,
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
import { Switch } from "@/components/ui/cubby-ui/switch/switch";
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/cubby-ui/collapsible";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  Share01Icon,
  Edit01Icon,
  Edit02Icon,
  PencilEdit02Icon,
  LockIcon,
} from "@hugeicons/core-free-icons";
import { generateInstallCommands } from "@/lib/install-commands";
import { cn, timeAgo } from "@/lib/utils";
import { EditableSkillSection } from "@/components/bundle-edit/editable-skill-section";
import { MAX_BUNDLE_DESCRIPTION_LENGTH } from "@/lib/bundle-limits";

interface BundleViewProps {
  preloadedBundle: Preloaded<typeof api.bundles.getByUrlId>;
  urlId: string;
}

const skillDetailHandle = createSkillDetailHandle();
const descriptionDialogHandle = createDialogHandle();
const renameBundleDialogHandle = createDialogHandle();

export function BundleView({ preloadedBundle, urlId }: BundleViewProps) {
  const bundle = usePreloadedQuery(preloadedBundle);
  const [editingSkills, setEditingSkills] = useState(false);
  const queryArgs = { urlId };

  // Opening the bundle now marks it read, and the register is what earns that:
  // every changed skill is on this page, in consequence order, with its
  // description delta shown inline. This was pulled once before, when the page
  // was still a card grid that named no changes — marking something read that
  // was never shown is the one thing a monitoring product cannot do.
  //
  // Owner-only (the mutation re-checks and no-ops otherwise), fired once per
  // mount, and not awaited: the page renders identically either way, and a
  // failed timestamp is not worth an error surface.
  //
  // The register itself is unaffected by the stamp — `listChangesForBundle`
  // baselines on `addedAt`, not on the last visit, so the page does not erase
  // its own contents on load. Only the dashboard panel clears.
  const ownedBundleId = bundle?.isOwner ? bundle._id : undefined;
  const markViewed = useMutation(api.bundles.markBundleViewed);
  useEffect(() => {
    if (!ownedBundleId) return;
    void markViewed({ bundleId: ownedBundleId });
  }, [ownedBundleId, markViewed]);

  // Per-skill change payloads for the register, baselined on when each skill
  // joined the bundle. Separate from the bundle read because it touches the
  // version archive and the audit table, which the roster itself does not need.
  const changes = useQuery(api.skillVersions.listChangesForBundle, { urlId });

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

  if (bundle === null) {
    return <BundleNotFound />;
  }

  const skillCount = bundle.skills.length;
  const commandCount = generateInstallCommands(bundle.skills).length;
  // `changes` streams in after the preloaded bundle — the register renders
  // immediately with every row Steady and settles as the archive answers,
  // rather than holding the whole page behind a second round trip.
  const register = buildRegister(bundle.skills, changes);

  return (
    // Rows anywhere in this page (read-only grid, edit-mode diff grid) open
    // the skill detail sheet through this provider.
    <SkillDetailHandleProvider handle={skillDetailHandle}>
    <main className="mx-auto max-w-6xl px-4 pt-12 pb-20">
      <div className="space-y-12">
        <header>
          <div>
              <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
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
                {bundle.isOwner ? (
                  <>
                    <DialogTrigger
                      handle={renameBundleDialogHandle}
                      render={
                        <Button
                          variant="outline"
                          size="sm"
                          leadingIcon={
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
                    <ShareControl
                      bundleId={bundle._id}
                      urlId={bundle.urlId}
                      isPublic={bundle.isPublic}
                      updateVisibility={updateVisibility}
                    />
                  </>
                ) : null}
              </div>
          </div>
        </header>

        {/* The register, and its caption. Consequence before inventory: the
            tally answers "is anything wrong?" and the rows underneath are
            ordered so the worst one is already first. Install is a disclosure
            in the tally line — still reachable, no longer leading. */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeader title="Register" count={skillCount} />
            {bundle.isOwner ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditingSkills(true)}
                disabled={editingSkills}
                leadingIcon={
                  <HugeiconsIcon
                    icon={PencilEdit02Icon}
                    strokeWidth={2}
                    className="size-3.5"
                  />
                }
              >
                Edit skills
              </Button>
            ) : null}
          </div>

          <InstallDisclosure
            skills={bundle.skills}
            enabled={commandCount > 0}
            tally={(trigger) => (
              <RegisterTally
                total={skillCount}
                faults={register.faults}
                changed={register.changed}
                steady={register.steady}
                action={trigger}
              />
            )}
          />

          {/* Read-only register: visible whenever we're not in edit mode (or
              for non-owners who can never enter edit mode). */}
          {!(bundle.isOwner && editingSkills) && skillCount > 0 ? (
            <BundleRegister rows={register.rows} />
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
    </SkillDetailHandleProvider>
  );
}

// ---------------------------------------------------------------------------
// Metadata row + section header + toolbar slot
// ---------------------------------------------------------------------------

function MetadataItems({
  skillCount,
  createdAt,
}: {
  skillCount: number;
  createdAt: number;
}) {
  const items: string[] = [
    `${skillCount} skill${skillCount !== 1 ? "s" : ""}`,
    `Created ${timeAgo(createdAt)}`,
  ];

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
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          This bundle isn&rsquo;t here.
        </h1>
        <p className="mt-3 max-w-md text-sm text-muted-foreground">
          It may have been deleted, set to private, or the link is incorrect.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
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
// Share control — one link, one switch
// ---------------------------------------------------------------------------

/**
 * The whole sharing model, in one popover.
 *
 * There used to be two controls and two links: a public/private toggle, and a
 * separate "create share link" that minted a second, token-bearing URL for
 * closed bundles. The owner then had to remember which URL they had copied and
 * which rule it followed. Now the bundle has one address, and this switch says
 * whether anyone but the owner can open it.
 *
 * The URL is shown whatever the state, greyed while closed, so the thing you
 * are turning on is visible before you turn it on.
 */
function ShareControl({
  bundleId,
  urlId,
  isPublic,
  updateVisibility,
}: {
  bundleId: Id<"bundles">;
  urlId: string;
  isPublic: boolean;
  updateVisibility: (args: {
    bundleId: Id<"bundles">;
    isPublic: boolean;
  }) => void;
}) {
  // Read at render, not through state: this only ever renders inside an opened
  // popover, which is a client-side interaction, so there is no server pass to
  // mismatch against. The relative path is a correct fallback either way.
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/bundle/${urlId}`
      : `/bundle/${urlId}`;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            leadingIcon={
              <HugeiconsIcon
                icon={isPublic ? Share01Icon : LockIcon}
                strokeWidth={2}
                className="size-3.5"
              />
            }
          />
        }
      >
        {isPublic ? "Shared" : "Private"}
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        className="w-80"
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Share this bundle</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {isPublic
                  ? "Anyone with the link can open it."
                  : "Only you can open it."}
              </p>
            </div>
            <Switch
              checked={isPublic}
              onCheckedChange={(checked: boolean) =>
                updateVisibility({ bundleId, isPublic: checked })
              }
              aria-label="Anyone with the link can open this bundle"
            />
          </div>

          <div
            className={cn(
              "flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-1.5 transition-opacity duration-100",
              !isPublic && "opacity-50",
            )}
          >
            <span className="min-w-0 flex-1 overflow-x-auto text-nowrap text-xs text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {shareUrl}
            </span>
            <CopyButton content={shareUrl} disabled={!isPublic} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Rename dialog
// ---------------------------------------------------------------------------

interface RenameBundleDialogProps {
  bundleId: Id<"bundles">;
  currentName: string;
  queryArgs: { urlId: string };
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
  queryArgs: { urlId: string };
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

// ---------------------------------------------------------------------------
// Install disclosure
// ---------------------------------------------------------------------------

/**
 * The install commands, folded away.
 *
 * They used to open the page as a full section, which said that reproducing the
 * setup is what a bundle is for. It is a real job, but a secondary one — the
 * page's subject is the state of what you already have. Demoted to a control on
 * the tally line: one click away, zero vertical space when unused.
 *
 * Takes the tally as a render prop rather than sitting next to it, because the
 * trigger has to be INSIDE the Collapsible while the panel it opens has to be
 * full-width BELOW the tally. Rendering the disclosure as its own sibling made
 * the trigger a full-width bar that read as an empty input field.
 */
function InstallDisclosure({
  skills,
  enabled,
  tally,
}: {
  skills: React.ComponentProps<typeof InstallCommands>["skills"];
  enabled: boolean;
  tally: (trigger: ReactNode) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!enabled) return <>{tally(null)}</>;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      {/* A plain Button rather than CollapsibleTrigger: that component ships
          `w-full` plus its own border and card background because it is built
          for accordion headers, and `render` merges those onto whatever you
          pass — which turned this control into a full-width bar that read as an
          empty input. The Collapsible is controlled, so a button toggling the
          same state is equivalent, with aria-expanded restoring what the
          trigger would have announced. */}
      {tally(
        <Button
          variant="outline"
          size="xs"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          trailingIcon={
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              strokeWidth={2}
              className={cn(
                "size-3.5 transition-transform duration-100 motion-reduce:transition-none",
                open && "rotate-180",
              )}
            />
          }
        >
          Install
        </Button>,
      )}
      <CollapsibleContent>
        <div className="space-y-3 pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-eyebrow font-medium uppercase tracking-eyebrow text-muted-foreground">
              Install commands
            </p>
            <CopyAllCommandsButton skills={skills} />
          </div>
          <InstallCommands skills={skills} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
