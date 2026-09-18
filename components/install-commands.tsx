"use client";

import { useState } from "react";
import { Button } from "@/components/ui/cubby-ui/button";
import { toast } from "@/components/ui/cubby-ui/toast/toast";
import { InstallCommandBlock } from "@/components/install-command-block";
import {
  generateInstallCommands,
  generateAllCommandsText,
  uncoveredSkills,
  type BundleSkill,
} from "@/lib/install-commands";
import { useWellKnownIndexes } from "@/hooks/use-well-known-indexes";

interface InstallCommandsProps {
  skills: BundleSkill[];
}

// A bundle can hold dozens of skills from one source, and the note below is a
// single grey line. Name a few, count the rest.
const MAX_LISTED_IDS = 3;

function summarizeIds(ids: string[]): string {
  if (ids.length <= MAX_LISTED_IDS) return ids.join(", ");
  const shown = ids.slice(0, MAX_LISTED_IDS).join(", ");
  return `${shown} and ${ids.length - MAX_LISTED_IDS} more`;
}

// Copy-all control, extracted so it can sit in the section header beside the
// "Install" title (the page owns that row) while the copy state stays here.
export function CopyAllCommandsButton({ skills }: InstallCommandsProps) {
  const [copiedAll, setCopiedAll] = useState(false);
  const { indexes, pending } = useWellKnownIndexes(skills);

  async function handleCopyAll() {
    const text = generateAllCommandsText(skills, indexes);
    // Nothing here has a command. Say so rather than flipping the button to
    // "Copied!" over an empty clipboard, the same way the floating bar does.
    if (text === "") {
      toast({
        title: "No install command",
        description:
          "These skills' sources don't publish a skills index the CLI can read.",
      });
      return;
    }
    await navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={handleCopyAll}
    >
      {copiedAll ? "Copied!" : "Copy all"}
    </Button>
  );
}

export function InstallCommands({ skills }: InstallCommandsProps) {
  const { indexes, pending } = useWellKnownIndexes(skills);
  const commands = generateInstallCommands(skills, indexes);
  // Skills with no command: a well-known skill whose domain publishes no root
  // index for the CLI to read. Named out loud, because the alternative is a
  // panel that silently lists fewer skills than the reader put in the bundle.
  // Held while the query is in flight, when every well-known skill looks
  // uncovered and the sentence would be false for most of them.
  const uncovered = pending ? [] : uncoveredSkills(skills, indexes);

  if (commands.length === 0 && uncovered.length === 0) return null;

  return (
    <div className="space-y-3">
      {commands.map((cmd) => (
        <div key={cmd.source}>
          <p className="mb-1 text-xs text-muted-foreground">
            {cmd.source}
            <span className="ml-1">
              ({cmd.skills.length} skill{cmd.skills.length !== 1 ? "s" : ""})
            </span>
          </p>
          <InstallCommandBlock command={cmd.command} />
          {cmd.hasWarning && (
            <p className="mt-1.5 text-xs text-warning-foreground">
              Some skills in this command may not be installable: their source
              files could not be found.
            </p>
          )}
        </div>
      ))}

      {uncovered.map((group) => (
        <p key={group.source} className="text-xs text-muted-foreground">
          {group.reason === "no-index"
            ? `${group.source} publishes no skills index the CLI can read, so ${summarizeIds(group.skillIds)} ${group.skillIds.length === 1 ? "has" : "have"} no install command.`
            : `${group.source}'s skills index doesn't list ${summarizeIds(group.skillIds)}, so there is no command for ${group.skillIds.length === 1 ? "it" : "them"}.`}
        </p>
      ))}
    </div>
  );
}
