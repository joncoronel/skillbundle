import Link from "next/link";
import * as React from "react";
import { LogoMark } from "@/components/brand-mark";
import { Card, CardContent, CardFooter } from "@/components/ui/cubby-ui/card";
import { Spinner } from "@/components/ui/spinner";

interface AuthFrameProps {
  /**
   * The step's heading and subheading.
   *
   * Optional as a pair, and only one caller omits them: the password reset
   * flow, which animates between steps. `TransitionPanel` requires every view
   * to be a sibling, so a heading rendered here — outside the panel — would
   * hard-swap while the body under it slid, which reads as a rendering fault
   * rather than as one card changing. That flow renders `AuthStepHeader`
   * inside each view instead, so the whole step moves as one thing.
   *
   * The logo badge deliberately does NOT move with it. It is the fixed anchor
   * the changing content travels under.
   */
  title?: string;
  description?: string;
  footer?: React.ReactNode;
  /**
   * The page-level line BELOW the card. Defaults to `AuthLegalLinks` (plain
   * Privacy · Terms), which is what every auth screen should carry: these pages
   * have no header and no site footer, so without it `/sign-in` and
   * `/sign-in/reset` are dead ends with no route to the legal documents at all.
   *
   * Sign-up passes `AuthLegalConsent` instead — see `AuthLegalLinks` for why
   * the two are alternatives rather than both.
   */
  legal?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * A step's heading and subheading, at the exact metrics `AuthFrame` used when
 * it owned them. Extracted so the animated reset flow can render the same
 * header inside each of its views without the two drifting apart.
 */
export function AuthStepHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <>
      <h1 className="text-center text-2xl font-semibold tracking-tight text-balance">
        {title}
      </h1>
      <p className="mx-auto mt-2.5 max-w-[19rem] text-center text-sm text-pretty text-muted-foreground">
        {description}
      </p>
    </>
  );
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
 * short viewport. It sits on the wrapper below rather than on `<main>`, so the
 * card and the legal line centre together.
 */
export function AuthFrame({
  title,
  description,
  footer,
  legal,
  children,
}: AuthFrameProps) {
  return (
    <div className="flex min-h-svh flex-col px-4 py-10">
      {/* `m-auto` moved from <main> to this wrapper so the card and the legal
          line centre as ONE group. It has to stay an auto margin rather than
          `justify-center` for the reason the old note gave: auto margins do not
          clip an overflowing child, so a tall step still scrolls to its top on
          a short viewport.

          Deliberately NOT pinned to the bottom of the viewport. Clerk's own
          auth pages put their legal line there, but on a tall screen that
          strands a consent notice hundreds of pixels from the button it
          describes. Centred with the card keeps it close to the action while
          still reading as page-level fine print rather than card content. */}
      <div className="m-auto flex w-full flex-col items-center gap-6">
        <main className="w-full max-w-[25rem]">
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

              {title !== undefined && description !== undefined ? (
                <div className="mt-6">
                  <AuthStepHeader title={title} description={description} />
                </div>
              ) : null}

              {/* `mt-8` under a header, `mt-6` without one — which is the header's
                own top margin, so a view that renders its own heading puts it
                at exactly the y the shared header occupied. Without the second
                case the animated flow's headings sat 8px lower than every other
                auth screen's. */}
              <div className={title === undefined ? "mt-6" : "mt-8"}>
                {children}
              </div>
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

        {/* Wider than the card (28rem vs 25rem) so the sign-up consent sentence
            fits on one line instead of wrapping mid-clause. A real <footer>,
            which makes it a `contentinfo` landmark — correct for page-level
            fine print, and outside <main> so `e2e/landmarks.spec.ts` still sees
            exactly one main. */}
        <footer className="w-full max-w-md">
          {legal ?? <AuthLegalLinks />}
        </footer>
      </div>
    </div>
  );
}

/**
 * The default legal line under every auth card: reach the documents, no claim
 * about agreeing to them.
 *
 * Sign-up overrides this with `AuthLegalConsent`, which is a consent NOTICE
 * rather than a pair of links — creating an account is the moment the terms
 * start binding, and no other auth screen is that moment. Showing both on one
 * page would say the same thing twice in two registers.
 */
export function AuthLegalLinks() {
  return (
    <p className="text-center text-xs text-muted-foreground">
      <Link
        href="/privacy"
        className="underline underline-offset-2 transition-colors hover:text-foreground"
      >
        Privacy
      </Link>
      <span className="px-2" aria-hidden="true">
        ·
      </span>
      <Link
        href="/terms"
        className="underline underline-offset-2 transition-colors hover:text-foreground"
      >
        Terms
      </Link>
    </p>
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
