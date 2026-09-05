"use client";

/**
 * DIRECTION CONTRACT — pricing cards
 *
 * THESIS: Free is the whole product at personal scale; Pro is the same product
 * without the ceiling. So: two cards, and Pro's list is "Everything in Free,
 * plus" three lines. Refuses the comparison plate this page shipped, whose
 * nine rows were mostly two identical ticks and got skipped by every reader.
 *
 * OWN-WORLD: The committed Control Panel system. Violet-tinted neutrals, the
 * surface ladder for lift, one blue signal on the one action that matters
 * (Pro's button). No new tokens, no second face, no decoration.
 *
 * STORY: The reader sees Free covers a personal setup, sees exactly three
 * things Pro adds, and knows within seconds which card is theirs.
 *
 * FIRST VIEWPORT: Hero stating the offer in one line, the billing toggle, then
 * both cards with prices and actions visible. Nothing below the fold is needed
 * to decide.
 *
 * FORM: Two cards, shaped directly from a precise brief (no direction roll:
 * the user specified the form). Motion is spent twice: the toggle's sliding
 * indicator and the Pro price crossfading between cycles.
 *
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, and DESIGN.md.
 */

import { useState } from "react";
import Link from "next/link";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useConvexAuth,
  useQuery,
} from "convex/react";
import { CheckoutLink } from "@convex-dev/polar/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { api } from "@/convex/_generated/api";
import {
  FREE_WATCHED_SKILLS,
  PLANS,
  yearlySavingsDollars,
  type Plan,
} from "@/lib/plans";
import { useUserPlan } from "@/hooks/use-user-plan";
import { Button } from "@/components/ui/cubby-ui/button";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { solidSurface } from "@/lib/cubby-ui/elevated";
import { cn } from "@/lib/utils";

const PRO_MONTHLY_PRODUCT_ID =
  process.env.NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID!;
const PRO_YEARLY_PRODUCT_ID =
  process.env.NEXT_PUBLIC_POLAR_PRO_YEARLY_PRODUCT_ID!;

type Cycle = "monthly" | "yearly";

// One spring for every state swap on this page, so the toggle and the price
// read as a single mechanism rather than two effects. No bounce: a price is a
// serious number.
const SWAP = { type: "spring", duration: 0.2, bounce: 0 } as const;

export function PricingCards() {
  const [cycle, setCycle] = useState<Cycle>("monthly");

  return (
    <div className="flex flex-col items-center gap-8">
      <BillingToggle cycle={cycle} onChange={setCycle} />

      <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-2">
        <FreeCard />
        <ProCard cycle={cycle} />
      </div>

      <WhereYouLand />
    </div>
  );
}

/**
 * A radio group, not Tabs: nothing here is a tabpanel. What this governs, the
 * Pro price and which product id checkout uses, lives in the card below.
 *
 * The active pill is one element that travels between the two labels
 * (`layoutId`), so switching reads as the same control moving rather than one
 * highlight vanishing and another appearing. Under reduced motion it jumps.
 */
function BillingToggle({
  cycle,
  onChange,
}: {
  cycle: Cycle;
  onChange: (cycle: Cycle) => void;
}) {
  const reduceMotion = useReducedMotion();
  const saved = yearlySavingsDollars(PLANS.pro);

  return (
    <fieldset
      className={cn(
        // Same track and pill as the capsule Tabs indicator, so this reads as
        // the app's segmented control. surface-2 under surface-3 was one tonal
        // step in dark and the pill all but vanished.
        "relative isolate inline-flex gap-1 rounded-xl bg-muted p-1",
      )}
    >
      <legend className="sr-only">Billing cycle</legend>
      {(["monthly", "yearly"] as const).map((value) => {
        const active = cycle === value;
        return (
          <label
            key={value}
            className={cn(
              "relative cursor-pointer rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100 ease-out select-none sm:py-1.5",
              "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring/50",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active ? (
              <motion.span
                layoutId="billing-cycle-indicator"
                aria-hidden
                className={cn(
                  "absolute inset-0 z-0 rounded-md",
                  solidSurface(5, 1),
                )}
                transition={reduceMotion ? { duration: 0 } : SWAP}
              />
            ) : null}
            <input
              type="radio"
              name="billing-cycle"
              value={value}
              checked={active}
              onChange={() => onChange(value)}
              className="sr-only"
            />
            {/* The text sits above the indicator in the FIELDSET's stacking
                context, not the label's. The indicator is re-mounted inside
                whichever label is active and animates in from the other one,
                so if each label were its own stacking context the travelling
                pill would paint over the text it is leaving. */}
            <span className="relative z-10">
              {value === "monthly" ? "Monthly" : "Yearly"}
              {value === "yearly" && saved ? (
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                  save ${saved}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function FreeCard() {
  return (
    <PlanCard
      plan="free"
      price={<Price amount={0} caption="forever" />}
      action={<FreeAction />}
      tone="quiet"
    />
  );
}

function ProCard({ cycle }: { cycle: Cycle }) {
  const plan = PLANS.pro;
  const monthly = plan.priceMonthly ?? 0;
  const yearly = plan.priceYearly ?? 0;
  const amount = cycle === "monthly" ? monthly : Math.round(yearly / 12);
  const caption =
    cycle === "monthly" ? "per month" : `per month, $${yearly} billed yearly`;

  return (
    <PlanCard
      plan="pro"
      price={<CyclingPrice amount={amount} caption={caption} />}
      action={<ProAction cycle={cycle} />}
      listHeading="Everything in Free, plus"
      tone="lifted"
      footnote="Cancel anytime. Pro stays active to the end of the period, and nothing is deleted when it ends."
    />
  );
}

/**
 * The card itself. Both plans share one anatomy so the eye lines them up:
 * name, price, action, list, in that order and at the same heights. The only
 * differences are the lift (Pro sits two shadow levels higher), the list
 * heading, and which action is blue.
 */
function PlanCard({
  plan,
  price,
  action,
  listHeading = "Includes",
  tone,
  footnote,
}: {
  plan: Plan;
  price: React.ReactNode;
  action: React.ReactNode;
  listHeading?: string;
  tone: "quiet" | "lifted";
  /** Pinned to the card's bottom edge, under the list. */
  footnote?: string;
}) {
  const info = PLANS[plan];
  const headingId = `plan-${plan}`;
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "flex flex-col rounded-2xl p-6",
        tone === "lifted" ? solidSurface(3, 3) : solidSurface(3, 1),
      )}
    >
      <h2 id={headingId} className="text-sm font-semibold">
        {info.name}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{info.description}</p>

      <div className="mt-5">{price}</div>

      <div className="mt-5">{action}</div>

      <div className="mt-6 border-t border-border pt-5">
        <p className="text-xs font-medium text-muted-foreground">
          {listHeading}
        </p>
        <ul className="mt-3 flex flex-col gap-2.5">
          {info.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5 text-sm">
              <HugeiconsIcon
                icon={Tick02Icon}
                strokeWidth={2.5}
                aria-hidden
                className={cn(
                  "mt-0.5 size-3.5 shrink-0",
                  tone === "lifted"
                    ? "text-foreground"
                    : "text-muted-foreground",
                )}
              />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </div>

      {footnote ? (
        <p className="mt-auto pt-6 text-xs text-muted-foreground">{footnote}</p>
      ) : null}
    </section>
  );
}

const FIGURE = "text-3xl font-semibold tracking-tight tabular-nums";

/** A price that never changes. The free card. */
function Price({ amount, caption }: { amount: number; caption: string }) {
  return (
    <p className="flex flex-col gap-1">
      <span className={cn("leading-none", FIGURE)}>${amount}</span>
      <span className="text-xs text-muted-foreground">{caption}</span>
    </p>
  );
}

/**
 * A price that follows the billing cycle. A change crossfades the old figure
 * out upward and the new one in from below, with a touch of blur so the two
 * never read as overlapping. Height is fixed by the line itself, so nothing
 * below shifts.
 *
 * The animated spans are decorative: during the swap both figures are in the
 * DOM, which an atomic live region would read as "$5$4". A separate sr-only
 * span carries the plain current value and is the only thing announced.
 */
function CyclingPrice({
  amount,
  caption,
}: {
  amount: number;
  caption: string;
}) {
  const reduceMotion = useReducedMotion();
  const hidden = reduceMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 10, filter: "blur(2px)" };
  const hiddenUp = reduceMotion
    ? { opacity: 0 }
    : { opacity: 0, y: -10, filter: "blur(2px)" };
  const shown = { opacity: 1, y: 0, filter: "blur(0px)" };

  return (
    <p className="flex flex-col gap-1">
      <span className="sr-only" aria-live="polite" aria-atomic>
        ${amount} {caption}
      </span>
      <span
        aria-hidden
        className="relative block h-[1em] text-3xl leading-none"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={amount}
            initial={hidden}
            animate={shown}
            exit={hiddenUp}
            transition={SWAP}
            className={cn("absolute inset-x-0 top-0 block", FIGURE)}
          >
            ${amount}
          </motion.span>
        </AnimatePresence>
      </span>
      <span
        aria-hidden
        className="relative block h-4 text-xs text-muted-foreground"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={caption}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={SWAP}
            className="absolute inset-x-0 top-0 block whitespace-nowrap tabular-nums"
          >
            {caption}
          </motion.span>
        </AnimatePresence>
      </span>
    </p>
  );
}

// Every action slot, button or not, holds the default Button's height so the
// two cards keep a shared baseline while auth resolves. Button is one step
// taller below `sm` (button.tsx), so this must be too.
const ACTION_HEIGHT = "h-10 sm:h-9";

function ActionSkeleton() {
  return <Skeleton className={cn("w-full rounded-lg", ACTION_HEIGHT)} />;
}

/**
 * The auth gate every action slot shares: a sign-up link for visitors, the
 * plan-aware control for members, and a same-height placeholder in between.
 */
function PlanAction({
  signedOut,
  signedIn,
}: {
  signedOut: React.ReactNode;
  signedIn: React.ReactNode;
}) {
  return (
    <>
      <Unauthenticated>{signedOut}</Unauthenticated>
      <Authenticated>{signedIn}</Authenticated>
      <AuthLoading>
        <ActionSkeleton />
      </AuthLoading>
    </>
  );
}

function FreeAction() {
  return (
    <PlanAction
      signedOut={
        <Button
          nativeButton={false}
          variant="outline"
          className="w-full"
          render={<Link href="/sign-up" />}
        >
          {PLANS.free.cta.free}
        </Button>
      }
      signedIn={<CurrentPlanNote plan="free" />}
    />
  );
}

/**
 * Signed in and on this plan: the card says so where the button would be,
 * and at the button's height so the two cards keep their shared baseline.
 */
function CurrentPlanNote({ plan }: { plan: Plan }) {
  const { plan: current, isLoading } = useUserPlan();
  if (isLoading) return <ActionSkeleton />;
  if (current !== plan) {
    // A Pro subscriber looking at the Free card: nothing to do here, but hold
    // the button's height so both cards keep their shared baseline.
    return (
      <p
        className={cn(
          "inline-flex w-full items-center justify-center text-sm text-muted-foreground",
          ACTION_HEIGHT,
        )}
      >
        Included in Pro
      </p>
    );
  }
  return (
    <p
      className={cn(
        "inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-muted text-sm text-muted-foreground",
        ACTION_HEIGHT,
      )}
    >
      <HugeiconsIcon
        icon={Tick02Icon}
        strokeWidth={2.5}
        aria-hidden
        className="size-3.5 text-success-foreground"
      />
      Your current plan
    </p>
  );
}

function ProAction({ cycle }: { cycle: Cycle }) {
  return (
    <PlanAction
      signedOut={
        <Button
          nativeButton={false}
          variant="primary"
          className="w-full"
          render={<Link href="/sign-up" />}
        >
          {PLANS.pro.cta.free}
        </Button>
      }
      signedIn={<ProCheckout cycle={cycle} />}
    />
  );
}

function ProCheckout({ cycle }: { cycle: Cycle }) {
  const { plan, isLoading } = useUserPlan();
  if (isLoading) return <ActionSkeleton />;

  if (plan === "pro") {
    return (
      <Button
        nativeButton={false}
        variant="outline"
        className="w-full"
        render={<Link href="/settings?tab=billing" />}
      >
        {PLANS.pro.cta.manage}
      </Button>
    );
  }

  return (
    <CheckoutLink
      polarApi={{ generateCheckoutLink: api.polar.generateCheckoutLink }}
      productIds={[
        cycle === "yearly" ? PRO_YEARLY_PRODUCT_ID : PRO_MONTHLY_PRODUCT_ID,
      ]}
      className="w-full"
      embed={false}
      lazy
    >
      <Button variant="primary" className="w-full">
        {PLANS.pro.cta.upgrade}
      </Button>
    </CheckoutLink>
  );
}

/**
 * The one line on this page that is about the reader rather than the offer.
 *
 * Signed out, it states the limit plainly. Signed in on Free, it shows their
 * own watched count against it. Reads the VIEWER'S limit, not the free
 * constant, so a Pro subscriber watching 40 skills is not told they are over.
 */
function WhereYouLand() {
  const { isAuthenticated } = useConvexAuth();
  const { limits } = useUserPlan();
  const watchedKeys = useQuery(
    api.bundles.listWatchedSkillKeys,
    isAuthenticated ? {} : "skip",
  );

  if (!isAuthenticated) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        Most personal setups never reach {FREE_WATCHED_SKILLS} watched skills.
      </p>
    );
  }

  // Signed in but the websocket has not answered yet. Hold the usage block's
  // height rather than flashing the signed-out sentence and then growing,
  // which shoved the FAQ down once the data arrived.
  if (watchedKeys === undefined || limits === null) {
    return (
      <div className="w-full max-w-sm" aria-busy>
        <div className="flex items-baseline justify-between">
          <Skeleton className="h-5 w-32 rounded-md" />
          <Skeleton className="h-5 w-24 rounded-md" />
        </div>
        <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
        <Skeleton className="mt-2 h-4 w-56 rounded-md" />
      </div>
    );
  }

  const watched = watchedKeys.length;
  const noun = watched === 1 ? "skill" : "skills";

  if (!Number.isFinite(limits.maxWatchedSkills)) {
    return (
      <p className="text-center text-sm text-muted-foreground tabular-nums">
        You watch {watched} {noun}. Pro has no limit.
      </p>
    );
  }

  const over = watched > FREE_WATCHED_SKILLS;
  const pct = Math.min(100, Math.round((watched / FREE_WATCHED_SKILLS) * 100));

  return (
    <div className="w-full max-w-sm">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium tabular-nums">
          You watch {watched} {noun}
        </span>
        <span className="text-muted-foreground tabular-nums">
          Free covers {FREE_WATCHED_SKILLS}
        </span>
      </div>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${watched} of ${FREE_WATCHED_SKILLS} watched skills used on the free plan`}
      >
        <div
          className={cn(
            "h-full rounded-full",
            over ? "bg-warning-foreground" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {over
          ? "You're past what Free covers. Pro removes the limit."
          : "Comfortably inside Free. Upgrade if that changes."}
      </p>
    </div>
  );
}
