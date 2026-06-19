"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/cubby-ui/button";
import { CopyButton } from "@/components/ui/cubby-ui/copy-button/copy-button";
import {
  generateInstallCommands,
  generateAllCommandsText,
  type BundleSkill,
} from "@/lib/install-commands";

interface InstallCommandsProps {
  skills: BundleSkill[];
  bundleId?: Id<"bundles">;
}

// Copy-all control, extracted so it can sit in the section header beside the
// "Install" title (the page owns that row) while the copy state stays here.
export function CopyAllCommandsButton({ skills, bundleId }: InstallCommandsProps) {
  const [copiedAll, setCopiedAll] = useState(false);
  const recordCopy = useMutation(api.bundleEvents.recordCopy);

  async function handleCopyAll() {
    const text = generateAllCommandsText(skills);
    await navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
    if (bundleId) recordCopy({ bundleId }).catch(() => {});
  }

  return (
    <Button variant="outline" size="sm" onClick={handleCopyAll}>
      {copiedAll ? "Copied!" : "Copy all"}
    </Button>
  );
}

export function InstallCommands({ skills, bundleId }: InstallCommandsProps) {
  const commands = generateInstallCommands(skills);
  const recordCopy = useMutation(api.bundleEvents.recordCopy);

  function trackCopy() {
    if (bundleId) {
      recordCopy({ bundleId }).catch(() => {});
    }
  }

  if (commands.length === 0) return null;

  return (
    <div className="space-y-3">
      {commands.map((cmd) => (
        <div key={cmd.source}>
          <p className="text-xs text-muted-foreground mb-1">
            {cmd.source}
            <span className="ml-1">
              ({cmd.skills.length} skill{cmd.skills.length !== 1 ? "s" : ""})
            </span>
          </p>
          <div className="group relative rounded-xl bg-muted w-fit max-w-full">
            <pre className="overflow-x-auto px-4 py-3 text-sm font-mono pr-16">
              {cmd.command}
            </pre>
            <div className="absolute top-1/2 right-1.5 -translate-y-1/2">
              <CopyButton
                content={cmd.command}
                className="backdrop-blur-sm"
                onCopied={trackCopy}
              />
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
