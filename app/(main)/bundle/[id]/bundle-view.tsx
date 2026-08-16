"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePreloadedQuery, useMutation, type Preloaded } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  BundleRegister,
  RegisterTally,
  buildRegister,
} from "@/components/bundle/bundle-register";
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
import { cn, formatDate } from "@/lib/utils";
import { BundleEditChrome } from "@/components/bundle-edit/editable-skill-section";
import { useBundleEditSession } from "@/hooks/use-bundle-edit-session";
import { MAX_BUNDLE_DESCRIPTION_LENGTH } from "@/lib/bundle-limits";

interface BundleViewProps {
  preloadedBundle: Preloaded<typeof api.bundles.getByUrlId>;
  preloadedChanges: Preloaded<typeof api.skillVersions.listChangesForBundle>;
  urlId: string;
}

/**
 * The bundle read's own skill shape, taken from the query rather than restated.
 * `EditableSkill` is a looser structural type (every register field optional),
 * so declaring the fallback as that widened `skills` into a union and every
 * consumer below rejected it.
 */
type BundleSkill = NonNullable<
  FunctionReturnType<typeof api.bundles.getByUrlId>
>["skills"][number];

/**
 * Stable empty array. `bundle?.skills ?? []` would be a new reference on every
 * render, which defeats the memos below and the staging hook's mirror mode.
 */
const EMPTY_SKILLS: BundleSkill[] = [];

const descriptionDialogHandle = createDialogHandle();
const renameBundleDialogHandle = createDialogHandle();

export function BundleView({
  preloadedBundle,
  preloadedChanges,
  urlId,
}: BundleViewProps) {
  const bundle = usePreloadedQuery(preloadedBundle);
  const [editingSkills, setEditingSkills] = useState(false);
  // Above the `bundle === null` early return below — hooks cannot sit after it
  // without changing call order between the found and not-found renders.
  const [installOpen, setInstallOpen] = useState(false);
  const installPanelId = useId();
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

  // Per-skill change payloads for the register, baselined on when each skill
  // joined the bundle. Separate from the bundle read because it touches the
  // version archive and the audit table, which the roster itself does not need.
  //
  // Preloaded on the server (see page.tsx) rather than fetched here. As a
  // `useQuery` this resolved after the page content had already painted, so the
  // register showed every row as Steady under a "Checking N skills…" line —
  // a second loading phase on a page that had finished loading. It stays a live
  // subscription after hydration, so edits and new changes still stream in.
  const changes = usePreloadedQuery(preloadedChanges);
  const changesReady = changes !== undefined;

  useEffect(() => {
    // The stamp is earned by the page having SHOWN the changes. That used to
    // need an explicit gate, because the change list arrived after first paint
    // and every row read Steady until it did — so firing unconditionally marked
    // a bundle read whose changes nobody had seen, and the dashboard then drops
    // them forever, including a security regression. That is the failure
    // `markBundleViewed`'s own docstring calls the one thing a monitoring
    // product cannot do.
    //
    // Preloading closed that hole at the source: `changes` is server-rendered,
    // so if this page painted at all, the changes were on it. The gate is kept
    // as a guard rather than deleted — if this ever goes back to a client fetch,
    // it must not silently start stamping early again.
    if (!ownedBundleId || !changesReady) return;
    void markViewed({ bundleId: ownedBundleId });
    // Depends on `changesReady`, NOT on `changes` itself. `usePreloadedQuery`
    // returns the deserialized preload on the first render and then a fresh
    // object once the subscription resolves, so a `changes` dependency moves at
    // least twice per visit — and again on every re-emit, i.e. once per edit.
    // Each move re-fired the mutation. The boolean settles once.
  }, [ownedBundleId, changesReady, markViewed]);

  const updateVisibilityMutation = useMutation(
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

  // Surfaced, not swallowed. On rejection Convex reverts the optimistic update
  // and the switch silently flips back — on the one control that decides
  // whether strangers can read this bundle. An owner would read that as a
  // glitch and assume the link is live. Matches the rename/description dialogs.
  function updateVisibility(args: {
    bundleId: Id<"bundles">;
    isPublic: boolean;
  }) {
    updateVisibilityMutation(args).catch((error: unknown) => {
      let message = "Couldn't reach the server. Try again.";
      if (error instanceof ConvexError && typeof error.data === "string") {
        message = error.data;
      } else if (error instanceof Error) {
        message = error.message;
      }
      toast.error({
        title: args.isPublic
          ? "Couldn't share the bundle"
          : "Couldn't make the bundle private",
        description: message,
      });
    });
  }

  // Memoised, and above the early return so the hook order does not change
  // between the found and not-found renders.
  //
  // Unmemoised this ran twice per render, because the edit component fed its
  // own `buildRegister` from a fresh array literal and invalidated every memo
  // inside `useBundleEdit` — a second 100-element sort plus three filter passes
  // on every render, for output that was discarded while not editing.
  const skills = useMemo(
    () => bundle?.skills ?? EMPTY_SKILLS,
    [bundle?.skills],
  );
  const register = useMemo(
    // `changes` streams in after the preloaded bundle — the register renders
    // immediately with every row Steady and settles as the archive answers,
    // rather than holding the whole page behind a second round trip.
    () => buildRegister(skills, changes.items),
    [skills, changes],
  );
  const commandCount = useMemo(
    () => generateInstallCommands(skills).length,
    [skills],
  );

  // The staging state lives HERE, not inside the edit chrome, so one register
  // can serve both modes. Two instances meant toggling edit mode unmounted one
  // and mounted the other, resetting the reader's section folds and their
  // scroll offset inside the register's own scroll container on every save.
  const editSession = useBundleEditSession({
    bundleId: bundle?._id,
    queryArgs,
    initialSkills: skills,
    changes: changes.items,
    onExit: () => setEditingSkills(false),
  });

  if (bundle === null) {
    return <BundleNotFound />;
  }

  const skillCount = bundle.skills.length;
  const editing = bundle.isOwner && editingSkills;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-12 pb-20">
      <div className="space-y-12">
        <header>
          <div>
            <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              <span>by {bundle.creatorName}</span>
            </div>
            <h1 className="mt-2 font-display text-4xl leading-hero font-medium tracking-tight wrap-break-word md:text-5xl">
              {bundle.name}
            </h1>

            <BundleDescription
              description={bundle.description}
              isOwner={bundle.isOwner}
            />

            <p className="mt-4 text-sm text-muted-foreground tabular-nums">
              <MetadataItems createdAt={bundle.createdAt} />
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
          {/* Install sits with Edit skills, not on its own line. It used to
              ride the tally row, and once the sections took over the tally's
              job that row went empty except for this button — an orphan
              control above the table. */}
          <SectionHeader
            title="Skills"
            count={skillCount}
            action={
              <div className="flex items-center gap-2">
                {commandCount > 0 && !editing ? (
                  <Button
                    variant="outline"
                    size="sm"
                    aria-expanded={installOpen}
                    aria-controls={installPanelId}
                    onClick={() => setInstallOpen((o) => !o)}
                    trailingIcon={
                      <HugeiconsIcon
                        icon={ArrowDown01Icon}
                        strokeWidth={2}
                        className={cn(
                          "size-3.5 transition-transform duration-100 motion-reduce:transition-none",
                          installOpen && "rotate-180",
                        )}
                      />
                    }
                  >
                    Install
                  </Button>
                ) : null}
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
            }
          />

          {/* `mb-0!` cancels the section's `space-y-4`, and the panel carries
              that spacing internally as `pb-4` instead.

              The section gives every child `margin-bottom: 16px`. While the
              panel is mounted that 16px sits below it, but Base UI unmounts the
              panel at the end of the close — the root becomes an empty box,
              stops contributing the margin, and the gap vanished in one frame
              *after* the height animation had finished. That was the jump.

              Moving it inside makes it part of the animated height, so it
              collapses with everything else. The closed layout is unchanged:
              the root contributed nothing once empty anyway.

              `!` because the `space-y-4` selector outranks a plain utility. */}
          <Collapsible
            open={installOpen}
            onOpenChange={setInstallOpen}
            className="mb-0!"
          >
            <CollapsibleContent id={installPanelId}>
              <div className="space-y-3 pb-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Install commands
                  </p>
                  <CopyAllCommandsButton skills={bundle.skills} />
                </div>
                <InstallCommands skills={bundle.skills} />
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* The tally steps aside in edit mode: it reports saved state, and
              while you have unsaved adds and removes staged it would be
              counting something that is no longer on screen. */}
          {editing ? null : (
            <RegisterTally
              total={skillCount}
              faults={register.faults}
              changed={register.changed}
              suppressed={changes.suppressed}
            />
          )}

          {/*
            ONE register, in one position in the tree, for both modes. Edit is
            genuinely a mode OF it: the same component instance takes the staged
            groups and the row handlers, so nothing unmounts when you toggle.

            Two instances is what this replaced, and the cost was invisible in
            the markup but obvious in use — React tore one down and built the
            other, so the section folds you had opened closed again and the
            scroll offset inside the register's own container jumped back to the
            top after every save.
          */}
          {skillCount > 0 || editing ? (
            <BundleRegister
              groups={editing ? editSession.rows.groups : register.groups}
              actions={editing ? editSession.actions : undefined}
            />
          ) : (
            <BundleEmpty isOwner={bundle.isOwner} />
          )}

          {/* The controls only — picker, bottom bar, discard dialog. Mounts
              unconditionally for owners so the bar can animate in and out via
              its `open` prop instead of being yanked out of the tree. */}
          {bundle.isOwner ? (
            <BundleEditChrome
              editing={editingSkills}
              session={editSession}
              onExit={() => setEditingSkills(false)}
            />
          ) : null}
        </section>
      </div>

      {/* No SkillDetailSheet / SkillDetailHandleProvider here any more. Its only
          consumer is `skill-card.tsx`, and no skill card renders on this page
          since the register replaced the grids — register rows are plain links.
          The provider wrapped zero consumers and the sheet was mounted with no
          way to open it, dragging its dependency graph (audit section,
          bundle-selection, install-commands, compare, badges) into the route's
          client bundle for nothing. */}
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metadata row + section header + toolbar slot
// ---------------------------------------------------------------------------

function MetadataItems({ createdAt }: { createdAt: number }) {
  // Skill count deliberately absent: the section heading and the tally both
  // state it, and three copies in one viewport is two too many. That leaves one
  // item, so this is a string and not a list with an unreachable separator.
  //
  // Absolute, unlike the change times in the register below. The split is the
  // question each answers: a change time is the monitoring signal ("did
  // something move recently?"), where "2d ago" is the answer and a date makes
  // you compute it. When a list was created is provenance — nobody monitors it,
  // and "8mo ago" is a worse way to say a date you might want to cite.
  //
  // Not a prerender-hazard fix, and it would be wrong to read it as one: the
  // register below server-renders `timeAgo` too (both `addedAt` and the change
  // lines, since their data is preloaded rather than fetched on the client), so
  // this is not the only clock read on the page. Those stay relative on
  // purpose — they are the monitoring answer, and the route is request-time
  // (auth + `io()`), so there is no shared shell for a clock read to poison.
  // See the `timeAgo` note in lib/utils.ts for where it does bite.
  return (
    <>
      Created{" "}
      <time dateTime={new Date(createdAt).toISOString()}>
        {formatDate(createdAt)}
      </time>
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
    <div className="flex items-center justify-between gap-3">
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
    <div className="mx-auto max-w-6xl px-4 pt-20 pb-20">
      <div className="rounded-xl bg-muted/40 px-8 py-20 md:px-12">
        <h1 className="text-2xl font-semibold tracking-tight">
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
    </div>
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
            <span className="min-w-0 flex-1 overflow-x-auto text-xs text-nowrap text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
          className="flex min-h-0 flex-1 flex-col"
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
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
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
    <div className="group/desc relative mt-3 max-w-2xl">
      <p className="text-sm wrap-break-word whitespace-pre-wrap text-foreground/85">
        {description}
      </p>
      {isOwner ? (
        <DialogTrigger
          handle={descriptionDialogHandle}
          render={
            <button
              type="button"
              aria-label="Edit description"
              className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
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
          className="flex min-h-0 flex-1 flex-col"
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
                  overLimit ? "font-medium text-destructive" : undefined
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

// ---------------------------------------------------------------------------
// Empty bundle
// ---------------------------------------------------------------------------

/**
 * A bundle with no skills.
 *
 * Gets a real state rather than an absent register. The previous build left
 * roughly 800px of nothing under a success-green status light, which told the
 * owner their empty bundle was healthy — an answer to a question they had not
 * asked, in the colour reserved for the one they had.
 */
function BundleEmpty({ isOwner }: { isOwner: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
      <p className="text-sm font-medium">Nothing to watch yet.</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
        {isOwner
          ? "Add the skills you depend on and this page will tell you when any of them change."
          : "The owner hasn't added any skills to this bundle."}
      </p>
      {isOwner ? (
        <Button
          variant="primary"
          size="sm"
          className="mt-5"
          nativeButton={false}
          render={<Link href="/" />}
        >
          Browse skills
        </Button>
      ) : null}
    </div>
  );
}
