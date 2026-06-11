"use client";

import { useCallback, useState } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { ArrowTurnBackwardIcon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/cubby-ui/button";
import { toast } from "@/components/ui/cubby-ui/toast/toast";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/cubby-ui/alert-dialog";
import { SkillCardView, type SkillData } from "@/components/skill-card";
import type { SkillDetailHandle } from "@/components/skill-detail-sheet";
import { MarchingBorder } from "@/components/ui/cubby-ui/marching-border/marching-border";
import { useBundleEdit } from "@/hooks/use-bundle-edit";
import { cn } from "@/lib/utils";
import { BundleEditSkillPicker } from "./skill-picker-sheet";
import { BundleEditBar } from "./bundle-edit-bar";

interface EditableSkillSectionProps {
  /** True when the user is actively in edit mode. The component stays
   *  mounted regardless so the BundleEditBar can animate in and out
   *  through Base UI's Sheet — when this flips false the bar's `open`
   *  flips with it and the Sheet runs its exit transition rather than
   *  getting yanked out of the DOM. */
  editing: boolean;
  bundleId: Id<"bundles">;
  /** Full query args (`urlId` + optional `shareToken`) for `getByUrlId`,
   *  matching the cache key the bundle page is reading. Passing only
   *  `urlId` would miss the cache entry on share-token-accessed bundles
   *  and the optimistic patch would silently no-op. */
  queryArgs: { urlId: string; shareToken?: string };
  /** The bundle's current skills, used to seed the staging area. */
  initialSkills: SkillData[];
  sheetHandle: SkillDetailHandle;
  onExit: () => void;
}

export function EditableSkillSection({
  editing,
  bundleId,
  queryArgs,
  initialSkills,
  sheetHandle,
  onExit,
}: EditableSkillSectionProps) {
  const edit = useBundleEdit<SkillData>(initialSkills);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  // `.withOptimisticUpdate` is recreated every render, so the callback
  // closes over the current render's `edit.skills` — no ref or effect
  // needed to keep the enriched data fresh. By the time the user clicks
  // Save, the latest render's wrapped mutation is what fires, with the
  // up-to-date staged list bound by closure.
  const enriched = edit.skills;
  const updateSkills = useMutation(
    api.bundles.updateBundleSkills,
  ).withOptimisticUpdate((localStore, { bundleId: id }) => {
    // getByUrlId is the query the bundle detail page is reading — patch
    // it directly using the prop-supplied queryArgs (urlId + optional
    // shareToken). We don't try to fish urlId out of listByUser because
    // that query may not be subscribed (the QuickAddPopover only
    // subscribes from view-only SkillCardViews, and those unmount when
    // edit mode is active). For skills already in the bundle, merge the
    // staged data over the existing detail record to preserve
    // server-only fields like `addedAt`; brand-new skills come straight
    // from the staged list and Convex will overwrite with the canonical
    // enriched shape on emit.
    const detail = localStore.getQuery(api.bundles.getByUrlId, queryArgs);
    if (detail) {
      // Index prior skills by `${source}::${skillId}` once so the merge
      // is O(n) over `enriched` instead of O(n*m). Mirrors the shape
      // used by `useBundleEdit.displayItems` and the server-side
      // `updateBundleSkills` handler.
      const priorByKey = new Map(
        detail.skills.map((p) => [`${p.source}::${p.skillId}`, p]),
      );
      localStore.setQuery(api.bundles.getByUrlId, queryArgs, {
        ...detail,
        skills: enriched.map((s) => {
          const prior = priorByKey.get(`${s.source}::${s.skillId}`);
          return prior ? { ...prior, ...s } : s;
        }) as typeof detail.skills,
      });
    }

    // listByUser carries minimal { source, skillId, addedAt } refs.
    // Patch it when it happens to be cached (dashboard, popover) so
    // those surfaces stay consistent, but don't depend on it.
    const list = localStore.getQuery(api.bundles.listByUser, {});
    if (list) {
      localStore.setQuery(
        api.bundles.listByUser,
        {},
        list.map((b) => {
          if (b._id !== id) return b;
          const priorByKey = new Map(
            b.skills.map((p) => [`${p.source}::${p.skillId}`, p]),
          );
          return {
            ...b,
            skills: enriched.map((s) => {
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
    }
  });

  const handleCancelClick = useCallback(() => {
    if (edit.dirty) {
      setCancelOpen(true);
    } else {
      onExit();
    }
  }, [edit.dirty, onExit]);

  const handleConfirmDiscard = useCallback(() => {
    edit.reset();
    setCancelOpen(false);
    onExit();
  }, [edit, onExit]);

  const handleSave = useCallback(() => {
    // Non-blocking save. The optimistic update on `updateSkills` paints
    // the new bundle into the cache immediately, so the view-only grid
    // renders the saved state the moment we exit edit mode — no
    // server-round-trip "snap." If the server later rejects the
    // mutation, Convex auto-rolls back the optimistic update (the view
    // reverts to the pre-save state) and we surface the failure via
    // toast. The user's staged in-memory edits are gone by then, so the
    // toast is the only recovery path; for a deliberate Save action
    // that tradeoff is acceptable.
    const pending = updateSkills({
      bundleId,
      skills: edit.skills.map((s) => ({
        source: s.source,
        skillId: s.skillId,
      })),
    });
    edit.reset();
    onExit();
    pending.catch((error: unknown) => {
      // ConvexError carries the original server message on `.data`.
      // Plain Errors fall through to `.message`, which in dev is wrapped
      // with the `[CONVEX M(...)]` boilerplate.
      let message = "Couldn't reach the server. Try again.";
      if (error instanceof ConvexError && typeof error.data === "string") {
        message = error.data;
      } else if (error instanceof Error) {
        message = error.message;
      }
      toast.error({
        title: "Couldn't save changes",
        description: message,
      });
    });
  }, [bundleId, edit, onExit, updateSkills]);

  return (
    <>
      {editing ? (
        <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {edit.displayItems.map(({ skill, status }) => {
          const isAdded = status === "added";
          const isRemoved = status === "removed";
          const isStaged = isAdded || isRemoved;
          return (
            <div
              key={`${skill.source}/${skill.skillId}`}
              className="relative h-full rounded-2xl"
            >
              <SkillCardView
                skill={skill}
                sheetHandle={sheetHandle}
                className={cn(
                  "h-full",
                  // Hide the card's solid 1px border on staged cards so
                  // it doesn't peek through the gaps in the marching
                  // dashed overlay.
                  isStaged && "border-transparent dark:border-transparent",
                  // Pending-add: "+" prefix on the title as a typographic
                  // cue; the marching dashed overlay carries the color.
                  isAdded && [
                    "**:data-[slot=card-title]:before:content-['+']",
                    "**:data-[slot=card-title]:before:mr-1.5",
                  ],
                  // Pending-remove: faded card content + title strikethrough.
                  // Overlay supplies the red dashed border. Opacity is
                  // scoped to slotted children (header, footer) so the
                  // absolute restore-button overlay stays at full opacity
                  // — CSS opacity cascades multiplicatively and can't be
                  // overridden from a child, so the fade has to skip the
                  // overlay's ancestor chain entirely.
                  isRemoved && [
                    "*:data-slot:opacity-60",
                    "**:data-[slot=card-title]:line-through",
                  ],
                )}
                editControls={
                  isRemoved
                    ? {
                        onRemove: () => edit.addSkill(skill),
                        removeIcon: ArrowTurnBackwardIcon,
                        removeLabel: "Restore skill",
                      }
                    : {
                        onRemove: () =>
                          edit.removeSkill(skill.source, skill.skillId),
                      }
                }
              />
              {isStaged && (
                <MarchingBorder
                  className={
                    isAdded
                      ? "text-success-foreground/55"
                      : "text-destructive/55"
                  }
                />
              )}
            </div>
          );
        })}
        </div>
      ) : null}

      <BundleEditSkillPicker
        open={pickerOpen && editing}
        onOpenChange={setPickerOpen}
        existingKeys={edit.stagedKeys}
        // PickerSkill's shape is a subset of SkillData (matching required
        // fields + same optional ones), so a direct binding works via
        // structural typing — the previous field-by-field copy was an
        // identity transform.
        onAdd={edit.addSkill}
        onRemove={edit.removeSkill}
      />

      <BundleEditBar
        open={editing}
        skillCount={edit.skills.length}
        addedCount={edit.addedCount}
        removedCount={edit.removedCount}
        dirty={edit.dirty}
        onSave={handleSave}
        onCancel={handleCancelClick}
        onAddSkills={() => setPickerOpen(true)}
      />

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved skill changes. Discarding will revert this bundle
              to its last saved state.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogBody />
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCancelOpen(false)}
            >
              Keep editing
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmDiscard}
            >
              Discard
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
