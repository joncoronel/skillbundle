import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";

export function DashboardMasthead() {
  return (
    <header className="border-b pb-8">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Dashboard <span aria-hidden>&middot;</span> Bundles
          </p>
          <h1 className="mt-3 font-display text-5xl font-semibold tracking-tight text-[clamp(2.5rem,5vw,4rem)] leading-[0.95]">
            Your bundles.
          </h1>
          <p className="mt-3 max-w-prose text-sm text-muted-foreground">
            Saved skill stacks, ready to share or install.
          </p>
        </div>
        <Button
          variant="primary"
          nativeButton={false}
          render={<Link href="/" />}
          leftSection={
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2.25} className="size-3.5" />
          }
          className="shrink-0"
        >
          New bundle
        </Button>
      </div>
    </header>
  );
}
