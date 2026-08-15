import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";

export function DashboardMasthead() {
  return (
    <header>
      <div className="flex items-start justify-between gap-6">
        <div>
          {/* Names the page's job, not its contents. The status panel leads
              now, so "Your bundles." described the section that comes second —
              and the wording stays true when bundles become watchlists. */}
          <h1 className="font-display text-[clamp(2.5rem,5vw,4rem)] font-medium tracking-tight leading-hero">
            Your setup.
          </h1>
          <p className="mt-3 max-w-prose text-sm text-muted-foreground">
            What you&rsquo;re watching, and what has changed since you last
            looked.
          </p>
        </div>
        <Button
          variant="primary"
          nativeButton={false}
          render={<Link href="/" />}
          leadingIcon={
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
