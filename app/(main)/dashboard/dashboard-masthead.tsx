import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";

export function DashboardMasthead() {
  return (
    <header>
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="font-display text-[clamp(2.5rem,5vw,4rem)] font-semibold tracking-tight leading-hero text-balance">
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
