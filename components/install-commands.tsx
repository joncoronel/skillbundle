"use client";

import { useState } from "react";
import { Button } from "@/components/ui/cubby-ui/button";
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

// Copy-all control, extracted so it can sit in the section header beside the
// "Install" title (the page owns that row) while the copy state stays here.
export function CopyAllCommandsButton({ skills }: InstallCommandsProps) {
  const [copiedAll, setCopiedAll] = useState(false);
  const wellKnown = useWellKnownIndexes(skills);

  async function handleCopyAll() {
    const text = generateAllCommandsText(skills, wellKnown);
    await navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleCopyAll}>
      {copiedAll ? "Copied!" : "Copy all"}
    </Button>
  );
}

export function InstallCommands({ skills }: InstallCommandsProps) {
  const wellKnown = useWellKnownIndexes(skills);
  const commands = generateInstallCommands(skills, wellKnown);
  // Skills no command covers — almost always a well-known skill whose domain
  // publishes no root index for the CLI to read. Named out loud, because the
  // alternative is a panel that silently lists fewer skills than the reader put
  // in the bundle.
  const uncovered = uncoveredSkills(skills, wellKnown);

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

      {uncovered.length > 0 && (
        <p className="text-xs text-muted-foreground">
          No install command for {uncovered.map((s) => s.skillId).join(", ")}.{" "}
          {uncovered.length === 1
            ? "Its source doesn't"
            : "Their sources don't"}{" "}
          publish a skills index the CLI can read.
        </p>
      )}
    </div>
  );
}
