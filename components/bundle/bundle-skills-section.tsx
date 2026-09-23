"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, PencilEdit02Icon } from "@hugeicons/core-free-icons";
import {
  BundleRegister,
  RegisterTally,
  buildRegister,
  type RegisterChange,
} from "@/components/bundle/bundle-register";
import {
  InstallCommands,
  CopyAllCommandsButton,
} from "@/components/install-commands";
import { BundleEditChrome } from "@/components/bundle-edit/editable-skill-section";
import { Button } from "@/components/ui/cubby-ui/button";
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/cubby-ui/collapsible";
import type {
  BundleEditSession,
  EditableSkill,
} from "@/hooks/use-bundle-edit-session";
import { useWellKnownIndexes } from "@/hooks/use-well-known-indexes";
import {
  generateInstallCommands,
  uncoveredSkills,
} from "@/lib/install-commands";
import { cn } from "@/lib/utils";

/**
 * A bundle's skills: the heading with Install and Edit, the install panel, the
 * tally and the register. Shared by the account bundle page and the page for a
 * bundle saved in the browser, which differ only in where the skills, the
 * changes and the save come from.
 */
export function BundleSkillsSection({
  skills,
  changes,
  canEdit,
  editing,
  onEdit,
  onExitEdit,
  editSession,
}: {
  /** In roster order; the register sorts them by consequence itself. */
  skills: EditableSkill[];
  changes: { items: RegisterChange[]; suppressed: boolean };
  /** The owner's view: Edit skills, the edit chrome, the owner's empty state. */
  canEdit: boolean;
  editing: boolean;
  onEdit: () => void;
  onExitEdit: () => void;
  editSession: BundleEditSession;
}) {
  const [installOpen, setInstallOpen] = useState(false);
  const installPanelId = useId();
  const skillCount = skills.length;

  const register = useMemo(
    () => buildRegister(skills, changes.items),
    [skills, changes],
  );
  // Counted with the same map InstallCommands renders from, or the header
  // would advertise a command count the panel below it doesn't produce.
  const { indexes: wellKnown, pending: wellKnownPending } =
    useWellKnownIndexes(skills);
  const commandCount = useMemo(
    () => generateInstallCommands(skills, wellKnown).length,
    [skills, wellKnown],
  );
  // The panel also explains the skills it CANNOT write a command for, and that
  // explanation lives inside the disclosure. Gating the trigger on commands
  // alone hid it in the one case it exists for: a bundle where nothing has a
  // command.
  // Gated on `pending` exactly as the panel is: while the query is in flight
  // every site skill looks uncovered, and counting them here would open the
  // disclosure over a panel that is deliberately rendering nothing yet.
  const uncoveredCount = useMemo(
    () => (wellKnownPending ? 0 : uncoveredSkills(skills, wellKnown).length),
    [skills, wellKnown, wellKnownPending],
  );
  const installPanelHasContent = commandCount > 0 || uncoveredCount > 0;

  return (
    // The register, and its caption. Consequence before inventory: the tally
    // answers "is anything wrong?" and the rows underneath are ordered so the
    // worst one is already first. Install is a disclosure beside Edit skills,
    // still reachable, no longer leading.
    <section className="space-y-4">
      {/* Install sits with Edit skills, not on its own line. It used to ride
          the tally row, and once the sections took over the tally's job that
          row went empty except for this button — an orphan control above the
          table. */}
      <SectionHeader
        title="Skills"
        count={skillCount}
        action={
          <div className="flex items-center gap-2">
            {installPanelHasContent && !editing ? (
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
            {canEdit ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onEdit}
                disabled={editing}
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

      {/* `mb-0!` cancels the section's `space-y-4`, and the panel carries that
          spacing internally as `pb-4` instead.

          The section gives every child `margin-bottom: 16px`. While the panel
          is mounted that 16px sits below it, but Base UI unmounts the panel at
          the end of the close — the root becomes an empty box, stops
          contributing the margin, and the gap vanished in one frame *after*
          the height animation had finished. That was the jump.

          Moving it inside makes it part of the animated height, so it
          collapses with everything else. The closed layout is unchanged: the
          root contributed nothing once empty anyway.

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
              <CopyAllCommandsButton skills={skills} />
            </div>
            <InstallCommands skills={skills} />
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* The tally steps aside in edit mode: it reports saved state, and while
          you have unsaved adds and removes staged it would be counting
          something that is no longer on screen. */}
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

        Two instances is what this replaced, and the cost was invisible in the
        markup but obvious in use — React tore one down and built the other, so
        the section folds you had opened closed again and the scroll offset
        inside the register's own container jumped back to the top after every
        save.
      */}
      {skillCount > 0 || editing ? (
        <BundleRegister
          groups={editing ? editSession.rows.groups : register.groups}
          actions={editing ? editSession.actions : undefined}
        />
      ) : (
        <BundleEmpty isOwner={canEdit} />
      )}

      {/* The controls only — picker, bottom bar, discard dialog. Mounts
          unconditionally for owners so the bar can animate in and out via its
          `open` prop instead of being yanked out of the tree. */}
      {canEdit ? (
        <BundleEditChrome
          editing={editing}
          session={editSession}
          onExit={onExitEdit}
        />
      ) : null}
    </section>
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
