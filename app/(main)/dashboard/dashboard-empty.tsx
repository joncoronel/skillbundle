import Link from "next/link";
import { Button } from "@/components/ui/cubby-ui/button";
import { signInUrl } from "@/components/auth/shared";

export function DashboardEmpty({ signedOut = false }: { signedOut?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl bg-muted/40">
      <div className="px-6 py-16 md:px-12 md:py-24">
        <h2 className="text-display-sm">Start with a stack.</h2>
        <p className="mt-4 max-w-md text-sm text-muted-foreground">
          Pick your tech, save the skills that fit, and your bundles will live
          here, along with anything that changed in them since you saved them.
          {signedOut
            ? " No account needed: they stay in this browser until you sign in."
            : null}
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            nativeButton={false}
            render={<Link href="/" />}
          >
            Build your first bundle
          </Button>
          {signedOut ? (
            <Button
              variant="ghost"
              nativeButton={false}
              render={<Link href={signInUrl("/dashboard")} />}
            >
              Sign in
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
