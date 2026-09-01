import Link from "next/link";
import * as React from "react";
import { LogoMark } from "@/components/brand-mark";
import { Card, CardContent, CardFooter } from "@/components/ui/cubby-ui/card";

interface AuthFrameProps {
  title: string;
  description: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The shell every auth step renders into: one centered card on an otherwise
 * empty page.
 *
 * Built on `Card variant="inset"` rather than a hand-rolled pair of divs — the
 * variant already is the tray-around-a-panel shape (a `bg-muted` frame holding
 * a raised `surface-3` content well), so the depth comes from the elevation
 * system instead of a bespoke shadow. Three overrides are deliberate and
 * concentric: a 24px outer radius (`rounded-5xl`) minus the tray's 6px band
 * (`p-1.5`) wants an 18px inner radius, which is exactly `rounded-3xl`. They
 * are one decision — change any one and change the others.
 *
 * The tray band below the well is where the cross-link lives, which is why the
 * footer is a sibling of `CardContent` and not inside it.
 *
 * `m-auto` rather than `items-center` does the vertical centering: auto margins
 * in flexbox do not clip an overflowing child, so the tall steps (verify code
 * plus an error) still scroll to their top on a short viewport.
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
          {/* `rounded-3xl!` needs the bang — CardContent's own `rounded-lg` is
              scoped by an arbitrary variant (specificity 0,2,0), so
              tailwind-merge never sees the two as the same utility and the
              variant wins. Any padding class here needs the same bang, which is
              why there is none: the variant's own `p-4` is what we want. 16px
              plus the tray's 6px band puts the fields 22px from the card edge,
              and the reference this card was built from insets them 23px. An
              earlier `px-6 py-9 sm:px-8` here was dead for the specificity
              reason above; forcing it through pinched the card. */}
          <CardContent className="rounded-3xl!">
            {/* `neutral`, not `chrome`. Chrome is near-black in BOTH themes by
                design, so in dark the badge lost its edge against the card and
                only the mark read. Neutral inverts with the theme — black badge
                with a white mark in light, the reverse in dark — which is also
                what the submit button does, so the card's two solid shapes stay
                one decision. */}
            <Link
              href="/"
              aria-label="SkillBundle home"
              className="mx-auto flex size-11 items-center justify-center rounded-xl bg-neutral text-neutral-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/60"
            >
              <LogoMark className="h-[18px]" />
            </Link>

            {/* Not `text-display-sm`, despite it being the nearest display
                role. That role is documented for strings we do NOT control
                (bundle names, `owner/repo`) and carries extra leading because
                those wrap; these titles are fixed, short, and sit in a 400px
                card rather than above a dense page, where 34px read oversized.
                24px semibold is the app's existing heading at this scale —
                `bundle-view.tsx` and `pricing-faq.tsx` use the same three
                classes. */}
            <h1 className="mt-6 text-center text-2xl font-semibold tracking-tight text-balance">
              {title}
            </h1>
            <p className="mx-auto mt-2.5 max-w-[19rem] text-center text-sm text-pretty text-muted-foreground">
              {description}
            </p>

            <div className="mt-8">{children}</div>
          </CardContent>

          {footer ? (
            // Two things here, both about `CardFooter`'s inset variant.
            //
            // The content is one paragraph, not a row of flex items: the footer
            // is a flex container, which swallows the whitespace between "New
            // here?" and the link and pins the group right. A single full-width
            // child restores normal inline flow and centres it.
            //
            // `pt-3!` needs the bang for the same reason `rounded-3xl!` does
            // above — the variant ships `pt-4` scoped by an arbitrary variant,
            // which tailwind-merge cannot match against a plain `pt-3`, so the
            // value was dropped and the band sat 16px over 12px. 12px pairs with
            // the 6px footer bottom plus the tray's own 6px band.
            <CardFooter className="px-4 pt-3! pb-1.5">
              <p className="w-full text-center text-sm">{footer}</p>
            </CardFooter>
          ) : null}
        </Card>
      </main>
    </div>
  );
}
