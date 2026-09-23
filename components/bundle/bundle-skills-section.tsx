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
 * A bundle's skills: heading, install panel, tally and register. Shared by the
 * account and browser bundle pages, which differ only in where the data and
 * the save come from.
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
  /** The owner's view: Edit skills, edit chrome, the owner's empty state. */
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
  // The panel also explains skills it can't write a command for, so those
  // count too. Gated on `pending` like the panel, or every site skill would
  // look uncovered while the query is in flight.
  const uncoveredCount = useMemo(
    () => (wellKnownPending ? 0 : uncoveredSkills(skills, wellKnown).length),
    [skills, wellKnown, wellKnownPending],
  );
  const installPanelHasContent = commandCount > 0 || uncoveredCount > 0;

  return (
    <section className="space-y-4">
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

      {/* `mb-0!` + inner `pb-4`: the spacing has to collapse with the height
          animation, or it vanishes a frame after the panel unmounts. */}
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

      {/* The tally reports saved state, so it steps aside while editing. */}
      {editing ? null : (
        <RegisterTally
          total={skillCount}
          faults={register.faults}
          changed={register.changed}
          suppressed={changes.suppressed}
        />
      )}

      {/* One register for both modes, so toggling edit keeps its folds and
          scroll position. */}
      {skillCount > 0 || editing ? (
        <BundleRegister
          groups={editing ? editSession.rows.groups : register.groups}
          actions={editing ? editSession.actions : undefined}
        />
      ) : (
        <BundleEmpty isOwner={canEdit} />
      )}

      {/* Always mounted for owners so the edit bar can animate out. */}
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
 * A bundle with no skills: a real state, not an empty register under a green
 * "all clear".
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
