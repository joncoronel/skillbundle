import Link from "next/link";
import { Button } from "@/components/ui/cubby-ui/button";
import { DotMatrix } from "@/components/ui/dot-matrix";

export function DashboardEmpty() {
  return (
    <div className="relative overflow-hidden rounded-xl bg-muted/40">
      <DotMatrix />
      <div className="relative px-6 py-16 md:px-12 md:py-24">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">
          Start with a stack.
        </h2>
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
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href="/explore" />}
          >
            Explore public bundles
          </Button>
        </div>
      </div>
    </div>
  );
}
