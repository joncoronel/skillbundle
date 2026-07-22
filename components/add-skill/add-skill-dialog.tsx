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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent variant="inset">
          <DialogHeader>
            <DialogTitle className="font-display font-medium">
              Add a skill
            </DialogTitle>
            <DialogDescription>
              Paste a skills.sh link or a GitHub repo. We&apos;ll pull it from
              GitHub if it isn&apos;t on skills.sh yet.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <AddSkillFlow initialInput={initialInput} autoFocus />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
