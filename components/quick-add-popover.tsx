"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useConvexAuth } from "convex/react";
import { ConvexError } from "convex/values";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowLeft01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/cubby-ui/button";
import { Checkbox } from "@/components/ui/cubby-ui/checkbox";
import { CheckboxGroup } from "@/components/ui/cubby-ui/checkbox-group";
import { Input } from "@/components/ui/cubby-ui/input";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/cubby-ui/popover";
import { toast } from "@/components/ui/cubby-ui/toast/toast";
import {
  TransitionPanel,
  TransitionPanelView,
} from "@/components/ui/cubby-ui/transition-panel";
import { UpgradeBanner } from "@/components/upgrade-banner";
import { useUserPlan } from "@/hooks/use-user-plan";
import { MAX_BUNDLE_SKILLS } from "@/lib/bundle-limits";
import { cn } from "@/lib/utils";

export interface QuickAddPopoverSkill {
  source: string;
  skillId: string;
  name: string;
}

interface QuickAddPopoverProps {
  skill: QuickAddPopoverSkill;
  className?: string;
  /** When opened from inside a bundle detail page, identifies the bundle
   *  the user is currently viewing so its row in the picker can be marked
   *  with a "CURRENT" tag and have its checkbox disabled. Removal from the
   *  current bundle should go through Edit skills, not the popover. */
  currentBundleId?: string;
}

/**
 * "+" button on a skill card that opens a small picker listing the user's
 * bundles. Each row is a checkbox: toggle to add or remove this skill from
 * that bundle. Mutations apply optimistically against the listByUser cache.
 * "Create new bundle" swaps the panel into an inline create form that adds
 * the skill to a newly created bundle and returns to the list.
 */
export function QuickAddPopover({
  skill,
  className,
  currentBundleId,
}: QuickAddPopoverProps) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [open, setOpen] = useState(false);

  // Subscribe to listByUser at trigger-mount so the query is hot by the time
  // the user clicks. Convex dedupes by query key, so dozens of cards on a
  // page share one fetch. Skipped for unauthenticated users.
  useQuery(api.bundles.listByUser, isAuthenticated ? {} : "skip");

  // While auth is still resolving (the post-hydration window), fall through
  // to the unauthenticated Link variant. It has the same visual shape as
  // the authenticated `+` button, so the layout doesn't reflow when auth
  // eventually resolves — preventing the post-hard-refresh flash where the
  // button appeared late and pushed surrounding content.
  //
  // Accepted tradeoff: a signed-in user who clicks `+` during the
  // auth-loading window (typically <100ms post-hydration) gets routed to
  // /sign-in instead of the popover. Rare, the recovery is one click,
  // and any alternative (loading skeleton, dual-button cross-fade)
  // reintroduces the layout shift we're explicitly avoiding here.
  if (!isAuthenticated || isLoading) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon_xs"
        nativeButton={false}
        render={
          <Link href="/sign-in" aria-label="Sign in to add to a bundle" />
        }
        className={cn("text-muted-foreground hover:text-foreground", className)}
        title="Sign in to add"
      >
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-3.5" />
      </Button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon_xs"
            aria-label="Add to a bundle"
            title="Add to bundle"
            className={cn(
              "text-muted-foreground hover:text-foreground",
              className,
            )}
          />
        }
      >
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={6}
        className="p-0 **:data-[slot=popover-viewport]:p-0! **:data-[slot=popover-viewport]:[--viewport-padding:0px]"
      >
        <QuickAddPanel skill={skill} currentBundleId={currentBundleId} />
      </PopoverContent>
    </Popover>
  );
}

// ----- Inner panel -----
//
// Width lives on the TransitionPanel's outer container (not on
// PopoverContent) so Base UI's popup-width auto-measurement reads it via
// `w-(--popup-width,auto)`. The animation, height measurement, mount-flag
// gating, and direction-aware slide are all owned by TransitionPanel.

function QuickAddPanel({
  skill,
  currentBundleId,
}: {
  skill: QuickAddPopoverSkill;
  currentBundleId?: string;
}) {
  const [view, setView] = useState<"list" | "create">("list");
  // Ref is created here so TransitionPanelView can read it for focus
  // management and CreateBundleView can attach it to its name input.
  const createInputRef = useRef<HTMLInputElement>(null);

  return (
    <TransitionPanel activeKey={view} axis="x" className="w-72">
      <TransitionPanelView viewKey="list">
        <BundleListView
          skill={skill}
          onCreate={() => setView("create")}
          currentBundleId={currentBundleId}
        />
      </TransitionPanelView>
      <TransitionPanelView viewKey="create" initialFocus={createInputRef}>
        <CreateBundleView
          skill={skill}
          onBack={() => setView("list")}
          active={view === "create"}
          inputRef={createInputRef}
        />
      </TransitionPanelView>
    </TransitionPanel>
  );
}

// ----- List view -----

function BundleListView({
  skill,
  onCreate,
  currentBundleId,
}: {
  skill: QuickAddPopoverSkill;
  onCreate: () => void;
  currentBundleId?: string;
}) {
  const bundles = useQuery(api.bundles.listByUser);
  const updateSkills = useMutation(
    api.bundles.updateBundleSkills,
  ).withOptimisticUpdate((localStore, { bundleId, skills }) => {
    const current = localStore.getQuery(api.bundles.listByUser, {});
    if (current === undefined) return;
    localStore.setQuery(
      api.bundles.listByUser,
      {},
      current.map((b) => {
        if (b._id !== bundleId) return b;
        // Index prior skills by `${source}::${skillId}` once so the merge
        // is O(n) instead of O(n*m). Mirrors `updateBundleSkills`
        // server-side and `useBundleEdit.displayItems`.
        const priorByKey = new Map(
          b.skills.map((p) => [`${p.source}::${p.skillId}`, p]),
        );
        return {
          ...b,
          skills: skills.map((s) => {
            const prior = priorByKey.get(`${s.source}::${s.skillId}`);
            return {
              source: s.source,
              skillId: s.skillId,
              addedAt: prior?.addedAt,
            };
          }),
        };
      }),
    );
  });
  const [filter, setFilter] = useState("");

  const skillKey = `${skill.source}::${skill.skillId}`;

  const filtered = useMemo(() => {
    if (!bundles) return [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return bundles;
    return bundles.filter((b) => b.name.toLowerCase().includes(needle));
  }, [bundles, filter]);

  // CheckboxGroup value = the bundle IDs that currently contain this skill.
  // Derived from the (optimistically updated) listByUser cache, so the
  // checkbox state stays in sync with the rest of the page. Single-pass
  // loop instead of `filter().map()` to match the codebase's
  // combine-iterations convention.
  const checkedIds = useMemo<string[]>(() => {
    if (!bundles) return [];
    const out: string[] = [];
    for (const b of bundles) {
      if (b.skills.some((s) => `${s.source}::${s.skillId}` === skillKey)) {
        out.push(b._id);
      }
    }
    return out;
  }, [bundles, skillKey]);

  async function handleValueChange(nextChecked: string[]) {
    if (!bundles) return;
    const previous = new Set(checkedIds);
    const next = new Set(nextChecked);

    // CheckboxGroup fires one toggle at a time — find the single diff.
    let toggledId: Id<"bundles"> | null = null;
    let action: "add" | "remove" | null = null;

    for (const id of nextChecked) {
      if (!previous.has(id)) {
        toggledId = id as Id<"bundles">;
        action = "add";
        break;
      }
    }
    if (!toggledId) {
      for (const id of checkedIds) {
        if (!next.has(id)) {
          toggledId = id as Id<"bundles">;
          action = "remove";
          break;
        }
      }
    }
    if (!toggledId || !action) return;

    const bundle = bundles.find((b) => b._id === toggledId);
    if (!bundle) return;

    const baseSkills = bundle.skills.map((s) => ({
      source: s.source,
      skillId: s.skillId,
    }));
    const nextSkills =
      action === "add"
        ? [...baseSkills, { source: skill.source, skillId: skill.skillId }]
        : baseSkills.filter((s) => `${s.source}::${s.skillId}` !== skillKey);

    try {
      await updateSkills({ bundleId: toggledId, skills: nextSkills });
    } catch (error) {
      // ConvexError carries the original server message on `.data`. Plain
      // Errors fall back to `.message`, which in dev is wrapped with the
      // `[CONVEX M(...)] [Request ID: ...]` boilerplate — by the time
      // this trips, the server already throws ConvexError so the wrapper
      // case is just defensive.
      let message = "Couldn't update bundle. Try again.";
      if (error instanceof ConvexError && typeof error.data === "string") {
        message = error.data;
      } else if (error instanceof Error) {
        message = error.message;
      }
      toast.error({ title: "Cannot update bundle", description: message });
    }
  }

  return (
    <div className="flex flex-col">
      <div className="px-3 py-2 border-b">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Add to a bundle
        </p>
        {bundles && bundles.length > 6 ? (
          <div className="relative mt-2">
            <HugeiconsIcon
              icon={Search01Icon}
              strokeWidth={2}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none"
            />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter bundles…"
              className=" pl-7"
            />
          </div>
        ) : null}
      </div>

      <div className="max-h-72 overflow-y-auto px-1.5 py-1.5">
        {bundles === undefined ? (
          <SkeletonRows />
        ) : bundles.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            You don&rsquo;t have any bundles yet. Create one below.
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            No bundles match &ldquo;{filter}&rdquo;.
          </p>
        ) : (
          <CheckboxGroup
            value={checkedIds}
            onValueChange={handleValueChange}
            className="gap-0"
          >
            {filtered.map((bundle) => {
              const isCurrent = bundle._id === currentBundleId;
              if (isCurrent) {
                // The bundle the user is viewing right now. Show as
                // checked-and-locked: the checkbox renders in its checked
                // state (since it IS in this bundle) but is disabled so
                // the user can't accidentally remove the skill from the
                // page they're looking at. Removal flows through the
                // canonical Edit-skills path instead. The CURRENT tag
                // replaces the skill-count badge so the right-side slot
                // doesn't go empty.
                return (
                  <div
                    key={bundle._id}
                    className="flex w-full items-center gap-2.5 px-2 py-1.5 rounded-md"
                    title="Use Edit skills to remove from this bundle"
                  >
                    <Checkbox name={bundle._id} disabled />
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                      {bundle.name}
                    </span>
                    <span className="text-[10px] uppercase tracking-eyebrow text-primary shrink-0">
                      Current
                    </span>
                  </div>
                );
              }
              // Cap preempt: when the bundle is full AND this skill isn't
              // already in it, disable the row. If the skill IS in the
              // bundle (checked), keep the checkbox enabled — uncheck
              // (remove) never violates the cap, so the user can always
              // pull this skill out even when the bundle is at max.
              const isChecked = checkedIds.includes(bundle._id);
              const isFull =
                bundle.skills.length >= MAX_BUNDLE_SKILLS && !isChecked;
              if (isFull) {
                return (
                  <div
                    key={bundle._id}
                    className="flex w-full items-center gap-2.5 px-2 py-1.5 rounded-md opacity-60"
                    title={`Bundle is at the ${MAX_BUNDLE_SKILLS}-skill maximum`}
                  >
                    <Checkbox name={bundle._id} disabled />
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                      {bundle.name}
                    </span>
                    <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
                      {bundle.skills.length} (full)
                    </span>
                  </div>
                );
              }
              return (
                <label
                  key={bundle._id}
                  className="flex w-full items-center gap-2.5 px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent/50 transition-colors"
                >
                  <Checkbox name={bundle._id} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {bundle.name}
                  </span>
                  <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
                    {bundle.skills.length}
                  </span>
                </label>
              );
            })}
          </CheckboxGroup>
        )}
      </div>

      <button
        type="button"
        onClick={onCreate}
        className="border-t flex items-center gap-2 px-3 py-2.5 text-left text-sm text-foreground hover:bg-accent/50 focus-visible:bg-accent/50 outline-none transition-colors"
      >
        <HugeiconsIcon
          icon={Add01Icon}
          strokeWidth={2}
          className="size-3.5 text-muted-foreground"
        />
        Create new bundle
      </button>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex items-center gap-2.5 px-2 py-1.5"
          aria-hidden
        >
          <div className="size-4.5 shrink-0 rounded-xs bg-muted/60 animate-pulse" />
          <div
            className={cn(
              "h-3.5 rounded-sm bg-muted/60 animate-pulse",
              i === 0 ? "w-32" : i === 1 ? "w-24" : "w-28",
            )}
          />
          <div className="ml-auto h-3 w-4 rounded-sm bg-muted/40 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// ----- Create view -----

function CreateBundleView({
  skill,
  onBack,
  active,
  inputRef,
}: {
  skill: QuickAddPopoverSkill;
  onBack: () => void;
  active: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const createBundle = useMutation(api.bundles.createBundle);

  // Preempt the bundle-limit failure: if the user is already at their
  // plan's max, swap the form for an UpgradeBanner instead of letting
  // them type a name and only fail at submit time. Mirrors the pattern
  // in save-bundle-dialog.tsx.
  const { limits } = useUserPlan();
  const bundles = useQuery(api.bundles.listByUser);
  const atLimit =
    limits !== null &&
    bundles !== undefined &&
    bundles.length >= limits.maxBundles;

  // Reset the input whenever this view transitions out. The TransitionPanel
  // keeps inactive views mounted (display: none) so their useState values
  // persist across visits — without this, the previously-typed bundle name
  // would still be in the field the next time the user opens the create
  // view. Render-time conditional setter per the React "adjusting state
  // when a prop changes" pattern.
  const [lastActive, setLastActive] = useState(active);
  if (active !== lastActive) {
    setLastActive(active);
    if (!active) setName("");
  }

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed || atLimit) return;
    setCreating(true);
    try {
      await createBundle({
        name: trimmed,
        skills: [{ source: skill.source, skillId: skill.skillId }],
        isPublic: true,
      });
      // Swap back to the list so the user sees the new bundle (with this
      // skill checked) without losing context. Popover stays open.
      onBack();
    } catch (error) {
      // ConvexError carries the original server message on `.data`.
      // Plain Errors fall back to `.message`, which in dev is wrapped
      // with `[CONVEX M(...)] [Request ID: ...] Server Error ...` — by
      // the time this branch trips, the server already threw a
      // ConvexError so the wrapper case is just defensive.
      let message = "Couldn't create bundle. Try again.";
      if (error instanceof ConvexError && typeof error.data === "string") {
        message = error.data;
      } else if (error instanceof Error) {
        message = error.message;
      }
      toast.error({ title: "Cannot create bundle", description: message });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onBack}
          disabled={creating}
          leftSection={
            <HugeiconsIcon
              icon={ArrowLeft01Icon}
              strokeWidth={2}
              className="size-3.5"
            />
          }
        >
          Back
        </Button>
        <span className="pr-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          New bundle
        </span>
      </div>

      {atLimit && limits ? (
        <div className="p-3">
          <UpgradeBanner
            message={`You've reached your limit of ${limits.maxBundles} bundles. Upgrade to Pro for unlimited bundles.`}
          />
        </div>
      ) : (
        <>
          <div className="px-3 py-2.5 space-y-2">
            <Input
              ref={inputRef}
              placeholder="Bundle name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") onBack();
              }}
              disabled={creating}
              className="h-9 text-sm"
            />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Adds{" "}
              <span className="text-foreground font-medium">{skill.name}</span>{" "}
              to the new bundle.
            </p>
          </div>

          <div className="flex items-center justify-end gap-1.5 border-t px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={onBack}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="xs"
              onClick={handleCreate}
              disabled={!name.trim() || creating}
              loading={creating}
            >
              {creating ? "Creating…" : "Create"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
