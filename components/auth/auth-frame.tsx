import Link from "next/link";
import * as React from "react";
import { LogoMark } from "@/components/brand-mark";
import { Card, CardContent, CardFooter } from "@/components/ui/cubby-ui/card";
import { Spinner } from "@/components/ui/spinner";

interface AuthFrameProps {
  title: string;
  description: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The shell every auth step renders into: one centered card on an empty page.
 *
 * `Card variant="inset"` already is the tray-around-a-panel shape, so the depth
 * comes from the elevation system rather than a bespoke shadow. The radii are
 * concentric and are one decision: 24px outer minus the 6px band wants 18px
 * inside.
 *
 * `m-auto` does the vertical centering, not `items-center`. Auto margins do not
 * clip an overflowing child, so the tall steps still scroll to their top on a
 * short viewport.
 */
export function AuthFrame({
  title,
  description,
  footer,
  children,
}: AuthFrameProps) {
  return (
    <div className="flex min-h-svh flex-col px-4 py-10">
      <main className="m-auto w-full max-w-[25rem]">
        <Card variant="inset" className="rounded-5xl p-1.5">
          {/* Every override on CardContent and CardFooter needs the bang. The
              inset variant scopes its own padding and radius behind
              `[data-variant=inset] > &`, which outranks a plain utility and
              which tailwind-merge cannot pair. Padding is deliberately not
              overridden: the variant's own `p-4` is the value we want. */}
          <CardContent className="rounded-3xl!">
            {/* `neutral`, not `chrome`: chrome is near-black in both themes, so
                in dark the badge lost its edge against the card. */}
            <Link
              href="/"
              aria-label="SkillBundle home"
              className="mx-auto flex size-11 items-center justify-center rounded-xl bg-neutral text-neutral-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/60"
            >
              <LogoMark className="h-[18px]" />
            </Link>

            <h1 className="mt-6 text-center text-2xl font-semibold tracking-tight text-balance">
              {title}
            </h1>
            <p className="mx-auto mt-2.5 max-w-[19rem] text-center text-sm text-pretty text-muted-foreground">
              {description}
            </p>

            <div className="mt-8">{children}</div>
          </CardContent>

          {footer ? (
            // One `<p>`, not bare children: CardFooter is a flex container,
            // which drops the whitespace before the link and pins the group
            // right.
            <CardFooter className="px-4 pt-3! pb-1.5">
              <p className="w-full text-center text-sm">{footer}</p>
            </CardFooter>
          ) : null}
        </Card>
      </main>
    </div>
  );
}

/** The body of every "hold on, we are finishing" step. */
export function AuthPendingBody() {
  return (
    <div className="flex justify-center">
      <Spinner size="md" />
    </div>
  );
}
