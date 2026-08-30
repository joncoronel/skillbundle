import Link from "next/link";
import { Button } from "@/components/ui/cubby-ui/button";

export function DashboardEmpty() {
  return (
    <div className="overflow-hidden rounded-xl bg-muted/40">
      <div className="px-6 py-16 md:px-12 md:py-24">
        <h2 className="text-display-sm">Start with a stack.</h2>
        <p className="mt-4 max-w-md text-sm text-muted-foreground">
          Pick your tech, save the skills that fit, and your bundles will live
          here. Share them, install them, fork them later.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            nativeButton={false}
            render={<Link href="/" />}
          >
            Build your first bundle
          </Button>
        </div>
      </div>
    </div>
  );
}
