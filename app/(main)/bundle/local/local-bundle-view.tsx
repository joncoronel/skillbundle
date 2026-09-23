"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  Delete01Icon,
  Edit01Icon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import {
  BundleRegister,
  RegisterTally,
  buildRegister,
} from "@/components/bundle/bundle-register";
import {
  InstallCommands,
  CopyAllCommandsButton,
} from "@/components/install-commands";
import { BundleEditChrome } from "@/components/bundle-edit/editable-skill-section";
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
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogClose,
  AlertDialogTrigger,
} from "@/components/ui/cubby-ui/alert-dialog";
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/cubby-ui/collapsible";
import { signInUrl } from "@/components/auth/shared";
import { useBundleEditSession } from "@/hooks/use-bundle-edit-session";
import { useWellKnownIndexes } from "@/hooks/use-well-known-indexes";
import {
  generateInstallCommands,
  uncoveredSkills,
} from "@/lib/install-commands";
import {
  MAX_BUNDLE_DESCRIPTION_LENGTH,
  MAX_BUNDLE_NAME_LENGTH,
  watchKey,
} from "@/lib/bundle-limits";
import {
  useLocalBundleActions,
  useLocalBundles,
  type LocalBundle,
} from "@/lib/local-bundles";
import { localBundleHref } from "@/lib/local-bundles-core";
import { cn } from "@/lib/utils";
import BundleLoading from "../[id]/loading";
import { BundleEmpty, MetadataItems, SectionHeader } from "../[id]/bundle-view";

const detailsDialogHandle = createDialogHandle();

/**
 * A bundle saved in this browser (lib/local-bundles.ts), rendered with the same
 * register as an account bundle. What differs is where the data comes from:
 * the entries live in localStorage, and the catalog rows and change payloads
 * come from two read-only queries that take those entries as arguments
 * (`bundles.resolveSkills`, `skillVersions.listChangesForSkills`).
 *
 * No share control. A share link needs the bundle on a server, so it is the
 * thing signing in adds, and the header says so.
 */
export function LocalBundleView() {
  const id = useSearchParams().get("id");
  const bundles = useLocalBundles();

  // Before hydration the stored list is unknown, and the server rendered the
  // loading shell; keep showing it rather than a false "not found".
  if (bundles === undefined) return <BundleLoading />;

  const bundle = id ? bundles.find((b) => b.id === id) : undefined;
  if (!bundle) return <LocalBundleNotFound />;
  // Keyed so switching bundles resets the edit session and dialogs.
  return <LocalBundleLoaded key={bundle.id} bundle={bundle} />;
}

function LocalBundleLoaded({ bundle }: { bundle: LocalBundle }) {
  const actions = useLocalBundleActions();
  const router = useRouter();
  const [editingSkills, setEditingSkills] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const installPanelId = useId();

  const entries = useMemo(
    () =>
      bundle.skills.map(({ source, skillId, addedAt }) => ({
        source,
        skillId,
        addedAt,
      })),
    [bundle.skills],
  );

  // keepPreviousData: an edit changes the arguments, and without it both
  // queries would drop to undefined and put the loading shell back over a page
  // that was already showing.
  const resolved = useQuery({
    ...convexQuery(api.bundles.resolveSkills, { skills: entries }),
    placeholderData: keepPreviousData,
  });
  const changesQuery = useQuery({
    ...convexQuery(api.skillVersions.listChangesForSkills, { skills: entries }),
    placeholderData: keepPreviousData,
  });
  const changes = changesQuery.data;

  // Every stored entry, joined to its catalog row when one has come back. A
  // skill added a moment ago renders from its stored name until the query
  // catches up, instead of vanishing from the list.
  const skills = useMemo(() => {
    const byKey = new Map((resolved.data ?? []).map((s) => [watchKey(s), s]));
    return bundle.skills.map(
      (s) =>
        byKey.get(watchKey(s)) ?? {
          source: s.source,
          skillId: s.skillId,
          addedAt: s.addedAt,
          name: s.name,
          installs: 0,
          isDelisted: false,
          hasContentFetchError: false,
        },
    );
  }, [bundle.skills, resolved.data]);

  const register = useMemo(
    () => buildRegister(skills, changes?.items),
    [skills, changes],
  );

  // Same rule as the account page: opening the bundle marks it read, but only
  // once its changes are on screen. Marking something read that was never
  // shown is the one thing a monitoring product cannot do.
  const changesReady = changes !== undefined;
  const { markViewed } = actions;
  useEffect(() => {
    if (changesReady) markViewed(bundle.id);
  }, [changesReady, markViewed, bundle.id]);

  const { indexes: wellKnown, pending: wellKnownPending } =
    useWellKnownIndexes(skills);
  const commandCount = useMemo(
    () => generateInstallCommands(skills, wellKnown).length,
    [skills, wellKnown],
  );
  const uncoveredCount = useMemo(
    () => (wellKnownPending ? 0 : uncoveredSkills(skills, wellKnown).length),
    [skills, wellKnown, wellKnownPending],
  );
  const installPanelHasContent = commandCount > 0 || uncoveredCount > 0;

  const editSession = useBundleEditSession({
    bundleId: undefined,
    queryArgs: { urlId: "" },
    initialSkills: skills,
    changes: changes?.items,
    onExit: () => setEditingSkills(false),
    saveSkills: (next) => {
      const result = actions.setSkills({
        id: bundle.id,
        skills: next.map(({ source, skillId, name }) => ({
          source,
          skillId,
          name,
        })),
      });
      return result.ok ? null : result.error;
    },
  });

  // Both reads resolve together on first load, like the account page's
  // preload, so the register never paints every row as Steady and then
  // re-sorts when the changes land.
  // To app/(main)/error.tsx, which keeps the header and offers retry. A failed
  // read would otherwise sit on the loading shell forever.
  if (resolved.isError) throw resolved.error;
  if (changesQuery.isError) throw changesQuery.error;
  if (resolved.data === undefined || changes === undefined) {
    return <BundleLoading />;
  }

  const skillCount = bundle.skills.length;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-12 pb-20">
      <div className="space-y-12">
        <header>
          <p className="text-sm text-muted-foreground">
            Saved in this browser.{" "}
            <Link
              href={signInUrl(localBundleHref(bundle.id))}
              className="font-medium text-foreground underline decoration-muted-foreground/50 underline-offset-2 transition-colors hover:decoration-foreground"
            >
              Sign in
            </Link>{" "}
            to share it or open it on another device.
          </p>
          <h1 className="mt-2 text-display-sm wrap-break-word">
            {bundle.name}
          </h1>
          {bundle.description ? (
            <p className="mt-3 max-w-prose text-sm whitespace-pre-line text-muted-foreground">
              {bundle.description}
            </p>
          ) : null}

          <p className="mt-4 text-sm text-muted-foreground tabular-nums">
            <MetadataItems createdAt={bundle.createdAt} />
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <DialogTrigger
              handle={detailsDialogHandle}
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
                  Edit details
                </Button>
              }
            />
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
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
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete bundle</AlertDialogTitle>
                  <AlertDialogDescription>
                    <span className="font-medium text-foreground">
                      {bundle.name}
                    </span>{" "}
                    will be removed from this browser. This can&rsquo;t be
                    undone.
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
                        onClick={() => {
                          router.push("/dashboard");
                          actions.remove(bundle.id);
                        }}
                      >
                        Delete
                      </Button>
                    }
                  />
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </header>

        <section className="space-y-4">
          <SectionHeader
            title="Skills"
            count={skillCount}
            action={
              <div className="flex items-center gap-2">
                {installPanelHasContent && !editingSkills ? (
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
              </div>
            }
          />

          {/* See the account page for why the spacing lives inside the panel
              (`mb-0!` + `pb-4`): it collapses with the height animation. */}
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
                  <CopyAllCommandsButton skills={skills} />
                </div>
                <InstallCommands skills={skills} />
              </div>
            </CollapsibleContent>
          </Collapsible>

          {editingSkills ? null : (
            <RegisterTally
              total={skillCount}
              faults={register.faults}
              changed={register.changed}
              suppressed={changes.suppressed}
            />
          )}

          {skillCount > 0 || editingSkills ? (
            <BundleRegister
              groups={editingSkills ? editSession.rows.groups : register.groups}
              actions={editingSkills ? editSession.actions : undefined}
            />
          ) : (
            <BundleEmpty isOwner />
          )}

          <BundleEditChrome
            editing={editingSkills}
            session={editSession}
            onExit={() => setEditingSkills(false)}
          />
        </section>
      </div>

      <DetailsDialog bundle={bundle} />
    </div>
  );
}

/** Name and description in one dialog; both are plain local writes. */
function DetailsDialog({ bundle }: { bundle: LocalBundle }) {
  const { rename, setDescription } = useLocalBundleActions();
  const nameId = useId();
  const descriptionId = useId();
  const [name, setName] = useState(bundle.name);
  const [description, setDescriptionDraft] = useState(bundle.description ?? "");
  const trimmedDescription = description.trim();
  const descriptionOverLimit =
    trimmedDescription.length > MAX_BUNDLE_DESCRIPTION_LENGTH;

  function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed || descriptionOverLimit) return;
    if (trimmed !== bundle.name) rename(bundle.id, trimmed);
    if (trimmedDescription !== (bundle.description ?? "")) {
      setDescription(bundle.id, trimmedDescription || undefined);
    }
    detailsDialogHandle.close();
  }

  return (
    <Dialog
      handle={detailsDialogHandle}
      onOpenChange={(open) => {
        // Reset to the stored values on every open, like the account page's
        // rename and description dialogs.
        if (open) {
          setName(bundle.name);
          setDescriptionDraft(bundle.description ?? "");
        }
      }}
    >
      <DialogContent variant="inset">
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogBody className="space-y-4">
            <div>
              <label
                htmlFor={nameId}
                className="mb-1.5 block text-sm font-medium"
              >
                Bundle name
              </label>
              <Input
                id={nameId}
                variant="elevated"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={MAX_BUNDLE_NAME_LENGTH}
                required
              />
            </div>
            <div>
              <label
                htmlFor={descriptionId}
                className="mb-1.5 block text-sm font-medium"
              >
                Description
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  Optional
                </span>
              </label>
              <Textarea
                id={descriptionId}
                variant="elevated"
                value={description}
                onChange={(e) => setDescriptionDraft(e.target.value)}
                className="min-h-20"
                maxLength={MAX_BUNDLE_DESCRIPTION_LENGTH + 50}
              />
              <div className="mt-1 flex justify-end text-xs text-muted-foreground tabular-nums">
                <span
                  className={
                    descriptionOverLimit
                      ? "font-medium text-destructive"
                      : undefined
                  }
                >
                  {trimmedDescription.length} / {MAX_BUNDLE_DESCRIPTION_LENGTH}
                </span>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button
              type="submit"
              variant="primary"
              disabled={!name.trim() || descriptionOverLimit}
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LocalBundleNotFound() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-20 pb-20">
      <div className="rounded-xl bg-muted/40 px-8 py-20 md:px-12">
        <h1 className="text-2xl font-semibold tracking-tight">
          This bundle isn&rsquo;t in this browser.
        </h1>
        <p className="mt-3 max-w-md text-sm text-muted-foreground">
          Bundles saved without an account only exist in the browser that saved
          them. If you signed in since, it moved to your account.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            nativeButton={false}
            render={<Link href="/dashboard" />}
          >
            Your bundles
          </Button>
        </div>
      </div>
    </div>
  );
}
