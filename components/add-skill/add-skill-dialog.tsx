"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
} from "@/components/ui/cubby-ui/dialog";
import { Button } from "@/components/ui/cubby-ui/button";
import { AddSkillFlow } from "@/components/add-skill/add-skill-flow";

/**
 * Opens the reusable AddSkillFlow in a modal — the search empty-state entry
 * point. `initialInput` seeds the field (e.g. the query the user just searched
 * when it looks like a repo reference).
 */
export function AddSkillDialog({
  initialInput,
  className,
}: {
  initialInput?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={className}
        onClick={() => setOpen(true)}
      >
        Add a skill
      </Button>
      {/* Escape and backdrop clicks are ignored while a step is in flight.
          The actions are not cancellable, so dismissing mid-add doesn't stop
          the write — it just throws away the only confirmation the user gets,
          after a GitHub-only add has already spent a quota slot. */}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && pending) return;
          setOpen(next);
        }}
      >
        {/* The close button goes with the blocked dismissal rather than
            sitting there enabled and inert — an X that visibly does nothing is
            worse than no X. The flow's own aria-live region announces the step
            in progress, so the state is still reported. */}
        <DialogContent variant="inset" showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle className="font-semibold">Add a skill</DialogTitle>
            <DialogDescription>
              Paste a skills.sh link or a GitHub repo. We&apos;ll pull it from
              GitHub if it isn&apos;t on skills.sh yet.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {/* `elevated`: this content sits at `surface-5`, and in light mode
                that and `bg-input`'s `surface-3` are both pure white, so the
                default opaque field had nothing here but its hairline. */}
            <AddSkillFlow
              initialInput={initialInput}
              autoFocus
              onPendingChange={setPending}
              variant="elevated"
            />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
