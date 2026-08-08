"use client";

/**
 * DIRECTION CONTRACT — pricing plate
 *
 * THESIS: Free and Pro are the same product at different scale, so the page is
 * one specimen plate with both on a shared baseline and only the differences
 * marked. Refuses the category default this page shipped: two cards with two
 * feature lists, an arrangement that implies two products and buries the fact
 * that almost every row is identical.
 *
 * OWN-WORLD: The committed Control Panel system — violet-tinted neutrals, one
 * blue signal on the primary action, mono for labels and figures. No new tokens.
 *
 * STORY: The reader sees the two columns are nearly the same, finds the three
 * rows that are not, and locates themselves against the only one that scales.
 *
 * FIRST VIEWPORT: A headline naming the sameness, the billing toggle, then the
 * plate's head — two prices side by side over one rule — and its first
 * differing row, marked. The primary action sits in the Pro column head.
 *
 * FORM: Diagnostic plate. Dealt as a challenger against assigned index 5 of 7
 * (calculator/self-locate) on seed key skillbundle-pricing-2026-08-08, and
 * taken on product clarity: near-identity is the truth of this offer, and the
 * plate is the one form built to dramatise it. The assigned direction's
 * self-locating survives as the signature interaction below the plate.
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
import { ArrowRight02Icon, Tick02Icon } from "@hugeicons/core-free-icons";

import { api } from "@/convex/_generated/api";
import {
  COMPARISON,
  FREE_WATCHED_SKILLS,
  PLANS,
  yearlySavingsPercent,
  type ComparisonRow,
  type ComparisonValue,
} from "@/lib/plans";
import { useUserPlan } from "@/hooks/use-user-plan";
import { Button } from "@/components/ui/cubby-ui/button";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/cubby-ui/tabs";
import { solidSurface } from "@/lib/cubby-ui/elevated";
import { cn } from "@/lib/utils";

const PRO_MONTHLY_PRODUCT_ID =
  process.env.NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID!;
const PRO_YEARLY_PRODUCT_ID =
  process.env.NEXT_PUBLIC_POLAR_PRO_YEARLY_PRODUCT_ID!;

type Cycle = "monthly" | "yearly";

/** A row differs when the two columns do not read the same. */
function differs(row: ComparisonRow) {
  return row.free !== row.pro;
}

export function PricingPlate() {
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const savings = yearlySavingsPercent(PLANS.pro);

  return (
    <div className="space-y-8">
      <div className="flex justify-center">
        <Tabs
          value={cycle}
          onValueChange={(v) => v && setCycle(v as Cycle)}
        >
          <TabsList>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
            <TabsTrigger value="yearly">
              Yearly
              {savings ? (
                <span className="ml-1.5 text-primary">&minus;{savings}%</span>
              ) : null}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className={cn("overflow-hidden rounded-2xl", solidSurface(3, 1))}>
        <PlateHead cycle={cycle} />
        {COMPARISON.map((group) => (
          <section key={group.title}>
            <h3 className="border-t border-border bg-muted/50 px-4 py-2 font-mono text-eyebrow font-medium uppercase tracking-eyebrow text-muted-foreground sm:px-6">
              {group.title}
            </h3>
            <dl>
              {group.rows.map((row) => (
                <PlateRow key={row.label} row={row} />
              ))}
            </dl>
          </section>
        ))}
      </div>

      <WhereYouLand />
    </div>
  );
}

/**
 * The plate's head: both prices over one rule.
 *
 * A shared grid with the rows below, not a separate card each — the columns
 * have to line up for the rest of the plate to read as a comparison rather than
 * as two lists that happen to be adjacent.
 */
function PlateHead({ cycle }: { cycle: Cycle }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 px-4 pt-5 pb-5 sm:grid-cols-[1fr_10rem_10rem] sm:gap-x-6 sm:px-6">
      {/* Deliberately empty: this cell is the label column's head, and the
          page's own subhead already says what both plans do. Repeating it here
          was the same sentence twice, forty pixels apart. */}
      <div className="hidden sm:block" />

      <PlanHead plan="free" cycle={cycle} />
      <PlanHead plan="pro" cycle={cycle} />
    </div>
  );
}

function PlanHead({ plan, cycle }: { plan: "free" | "pro"; cycle: Cycle }) {
  const info = PLANS[plan];
  const isPro = plan === "pro";
  const amount = isPro
    ? cycle === "monthly"
      ? info.priceMonthly
      : Math.round((info.priceYearly ?? 0) / 12)
    : 0;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="font-mono text-eyebrow font-medium uppercase tracking-eyebrow text-muted-foreground">
          {info.name}
        </p>
        <p className="mt-1 flex items-baseline gap-1">
          <span className="font-display text-3xl font-medium tabular-nums tracking-tight">
            ${amount}
          </span>
          <span className="text-xs text-muted-foreground">
            {isPro
              ? cycle === "monthly"
                ? "/mo"
                : "/mo, billed yearly"
              : "forever"}
          </span>
        </p>
      </div>
      {isPro ? <ProAction cycle={cycle} /> : <FreeAction />}
    </div>
  );
}

function FreeAction() {
  return (
    <>
      <Unauthenticated>
        <Button
          nativeButton={false}
          variant="outline"
          size="sm"
          className="w-full"
          render={<Link href="/sign-up" />}
        >
          {PLANS.free.cta.free}
        </Button>
      </Unauthenticated>
      <Authenticated>
        <CurrentPlanNote plan="free" />
      </Authenticated>
      <AuthLoading>
        <Skeleton className="h-8 w-full rounded-md" />
      </AuthLoading>
    </>
  );
}

function CurrentPlanNote({ plan }: { plan: "free" | "pro" }) {
  const { plan: current, isLoading } = useUserPlan();
  if (isLoading) return <Skeleton className="h-8 w-full rounded-md" />;
  if (current !== plan) return <span aria-hidden className="h-8" />;
  return (
    <span className="inline-flex h-8 items-center gap-1.5 text-xs text-muted-foreground">
      <HugeiconsIcon
        icon={Tick02Icon}
        strokeWidth={2.5}
        aria-hidden
        className="size-3.5 text-success-foreground"
      />
      Your plan
    </span>
  );
}

function ProAction({ cycle }: { cycle: Cycle }) {
  return (
    <>
      <Unauthenticated>
        <Button
          nativeButton={false}
          variant="primary"
          size="sm"
          className="w-full"
          render={<Link href="/sign-up" />}
        >
          {PLANS.pro.cta.free}
        </Button>
      </Unauthenticated>
      <Authenticated>
        <ProCheckout cycle={cycle} />
      </Authenticated>
      <AuthLoading>
        <Skeleton className="h-8 w-full rounded-md" />
      </AuthLoading>
    </>
  );
}

function ProCheckout({ cycle }: { cycle: Cycle }) {
  const { plan, isLoading } = useUserPlan();
  if (isLoading) return <Skeleton className="h-8 w-full rounded-md" />;

  if (plan === "pro") {
    return (
      <Button
        nativeButton={false}
        variant="outline"
        size="sm"
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
      <Button variant="primary" size="sm" className="w-full">
        {PLANS.pro.cta.upgrade}
      </Button>
    </CheckoutLink>
  );
}

/**
 * One row of the plate.
 *
 * Matching rows stay deliberately quiet — same words, same weight, no tick
 * contest. The whole argument is the three rows that do NOT match, so those get
 * the only emphasis on the plate: the Pro side goes solid, and an arrow points
 * at it from the free side. A pricing table where every row shouts is one where
 * the reader cannot find the decision.
 */
function PlateRow({ row }: { row: ComparisonRow }) {
  const marked = differs(row);

  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_auto] items-baseline gap-x-4 border-t border-border px-4 py-3 sm:grid-cols-[1fr_10rem_10rem] sm:gap-x-6 sm:px-6",
        marked && "bg-primary/[0.04]",
      )}
    >
      <dt className="col-span-2 sm:col-span-1">
        <span className={cn("text-sm", marked && "font-medium")}>
          {row.label}
        </span>
        {row.note ? (
          <span className="mt-0.5 block max-w-prose text-xs text-muted-foreground">
            {row.note}
          </span>
        ) : null}
      </dt>

      <PlateCell value={row.free} marked={marked} side="free" />
      <PlateCell value={row.pro} marked={marked} side="pro" />
    </div>
  );
}

function PlateCell({
  value,
  marked,
  side,
}: {
  value: ComparisonValue;
  marked: boolean;
  side: "free" | "pro";
}) {
  const isPro = side === "pro";
  return (
    <dd
      className={cn(
        "mt-1 flex items-center gap-1.5 text-sm sm:mt-0",
        marked && isPro ? "font-medium text-foreground" : "text-muted-foreground",
      )}
    >
      {/* The arrow is the plate's pointer: it sits on the free side of a
          differing row and aims across at the value that changes. Only on
          marked rows, and hidden below sm where the columns stack and
          "across" stops meaning anything. */}
      {marked && !isPro ? (
        <HugeiconsIcon
          icon={ArrowRight02Icon}
          strokeWidth={2}
          aria-hidden
          className="hidden size-3.5 shrink-0 text-primary sm:block"
        />
      ) : null}
      <span className="sm:hidden">
        <span className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
          {isPro ? "Pro " : "Free "}
        </span>
      </span>
      {typeof value === "boolean" ? (
        value ? (
          <>
            <HugeiconsIcon
              icon={Tick02Icon}
              strokeWidth={2.5}
              aria-hidden
              className="size-3.5 shrink-0"
            />
            <span className="sr-only">Included</span>
          </>
        ) : (
          <>
            <span aria-hidden>&mdash;</span>
            <span className="sr-only">Not included</span>
          </>
        )
      ) : (
        <span className="tabular-nums">{value}</span>
      )}
    </dd>
  );
}

/**
 * The self-locating line, which is what the assigned direction was for.
 *
 * A signed-in reader is shown their own watched count against the free limit —
 * the only number on this page that is about them rather than about the offer.
 * Signed-out readers get the limit stated plainly instead of a slider asking
 * them to guess; a guess is not evidence, and they can find out for free.
 */
function WhereYouLand() {
  const { isAuthenticated } = useConvexAuth();
  const watched = useQuery(
    api.bundles.countWatchedSkills,
    isAuthenticated ? {} : "skip",
  );

  if (!isAuthenticated || watched === undefined) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        Free covers {FREE_WATCHED_SKILLS} watched skills. Most personal setups
        never reach it.
      </p>
    );
  }

  const over = watched > FREE_WATCHED_SKILLS;
  const pct = Math.min(100, Math.round((watched / FREE_WATCHED_SKILLS) * 100));

  return (
    <div className="mx-auto max-w-md space-y-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium tabular-nums">
          You watch {watched} skill{watched === 1 ? "" : "s"}
        </span>
        <span className="text-muted-foreground tabular-nums">
          Free covers {FREE_WATCHED_SKILLS}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${watched} of ${FREE_WATCHED_SKILLS} watched skills used on the free plan`}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
            over ? "bg-warning-foreground" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {over
          ? "You're past what Free covers — Pro removes the limit."
          : "Comfortably inside Free. Upgrade if that changes."}
      </p>
    </div>
  );
}
