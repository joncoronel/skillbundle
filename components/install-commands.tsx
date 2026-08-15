"use client";

import { useState } from "react";
import { Button } from "@/components/ui/cubby-ui/button";
import { CopyButton } from "@/components/ui/cubby-ui/copy-button/copy-button";
import {
  generateInstallCommands,
  generateAllCommandsText,
  type BundleSkill,
} from "@/lib/install-commands";

interface InstallCommandsProps {
  skills: BundleSkill[];
}

// Copy-all control, extracted so it can sit in the section header beside the
// "Install" title (the page owns that row) while the copy state stays here.
export function CopyAllCommandsButton({ skills }: InstallCommandsProps) {
  const [copiedAll, setCopiedAll] = useState(false);

  async function handleCopyAll() {
    const text = generateAllCommandsText(skills);
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
  const commands = generateInstallCommands(skills);

  if (commands.length === 0) return null;

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
          <div className="group relative w-fit max-w-full rounded-xl bg-muted">
            <pre className="overflow-x-auto px-4 py-3 pr-16 font-mono text-sm">
              {cmd.command}
            </pre>
            <div className="absolute top-1/2 right-1.5 -translate-y-1/2">
              <CopyButton content={cmd.command} className="backdrop-blur-sm" />
            </div>
          </div>
          {cmd.hasWarning && (
            <p className="mt-1.5 text-xs text-warning-foreground">
              Some skills in this command may not be installable: their source
              files could not be found.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
