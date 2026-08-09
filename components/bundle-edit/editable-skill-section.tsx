"use client";

import { useCallback } from "react";
import { Button } from "@/components/ui/cubby-ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/cubby-ui/alert-dialog";
import {
  useEditChromeState,
  type BundleEditSession,
} from "@/hooks/use-bundle-edit-session";
import { BundleEditSkillPicker } from "./skill-picker-sheet";
import { BundleEditBar } from "./bundle-edit-bar";

interface BundleEditChromeProps {
  /**
   * True when the user is actively in edit mode. The component stays mounted
   * regardless so the BundleEditBar can animate in and out through Base UI's
   * Sheet — when this flips false the bar's `open` flips with it and the Sheet
   * runs its exit transition rather than getting yanked out of the DOM.
   */
  editing: boolean;
  /** Owned by the bundle page, so one register can serve both modes. */
  session: BundleEditSession;
  onExit: () => void;
}

/**
 * The controls around edit mode: the skill picker, the bottom bar, and the
 * discard confirmation.
 *
 * Deliberately renders NO register. It used to render its own, which made edit
 * mode a second `<BundleRegister>` at a different position in the React tree —
 * so entering or leaving edit mode unmounted one and mounted the other, and the
 * reader lost their section folds and their scroll position on every save. The
 * page now renders one register and hands it `session.actions` when editing;
 * the staging state lives in `useBundleEditSession` so both can reach it.
 */
export function BundleEditChrome({
  editing,
  session,
  onExit,
}: BundleEditChromeProps) {
  const { pickerOpen, setPickerOpen, cancelOpen, setCancelOpen } =
    useEditChromeState();

  const handleCancelClick = useCallback(() => {
    if (session.dirty) {
      setCancelOpen(true);
    } else {
      onExit();
    }
  }, [session.dirty, onExit, setCancelOpen]);

  const handleConfirmDiscard = useCallback(() => {
    session.discard();
    setCancelOpen(false);
  }, [session, setCancelOpen]);

  return (
    <>
      <BundleEditSkillPicker
        open={pickerOpen && editing}
        onOpenChange={setPickerOpen}
        existingKeys={session.stagedKeys}
        // PickerSkill's shape is a subset of SkillData (matching required
        // fields + same optional ones), so a direct binding works via
        // structural typing — the previous field-by-field copy was an
        // identity transform.
        onAdd={session.addSkill}
        onRemove={session.removeSkill}
      />

      <BundleEditBar
        open={editing}
        skillCount={session.skillCount}
        addedCount={session.addedCount}
        removedCount={session.removedCount}
        dirty={session.dirty}
        onSave={session.save}
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
