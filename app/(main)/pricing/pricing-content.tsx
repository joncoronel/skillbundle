"use client";

import { useState } from "react";
import Link from "next/link";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { CheckoutLink } from "@convex-dev/polar/react";
import { api } from "@/convex/_generated/api";
import { PLANS, type Plan, yearlySavingsPercent } from "@/lib/plans";
import { useUserPlan } from "@/hooks/use-user-plan";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/cubby-ui/button";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/cubby-ui/tabs";
import { cn } from "@/lib/utils";

const PLAN_KEYS: Plan[] = ["free", "pro"];
// Must match convex/polar.ts product IDs
const PRO_MONTHLY_PRODUCT_ID = "81f91b1c-5b5b-464e-8be2-d925e3652c59";
const PRO_YEARLY_PRODUCT_ID = "5a16b4c6-bcd2-4f50-980f-3239c1fea660";

type Cycle = "monthly" | "yearly";

export function PricingContent() {
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const proSavings = yearlySavingsPercent(PLANS.pro);

  return (
    <div className="flex flex-col gap-10">
      <BillingToggle
        cycle={cycle}
        onChange={setCycle}
        savingsLabel={proSavings ? `Save ${proSavings}%` : null}
      />

      <div className="grid gap-6 md:grid-cols-2 md:items-stretch">
        {PLAN_KEYS.map((key) => (
          <TierCard key={key} planKey={key} cycle={cycle} />
        ))}
      </div>

      <p className="text-muted-foreground text-xs">
        Prices in USD. Cancel anytime from billing settings.
      </p>
    </div>
  );
}

function BillingToggle({
  cycle,
  onChange,
  savingsLabel,
}: {
  cycle: Cycle;
  onChange: (c: Cycle) => void;
  savingsLabel: string | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <Tabs
        value={cycle}
        onValueChange={(v) => onChange(v as Cycle)}
        aria-label="Billing cycle"
      >
        <TabsList>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="yearly">Yearly</TabsTrigger>
        </TabsList>
      </Tabs>

      {savingsLabel && cycle === "yearly" && (
        <span className="text-primary bg-primary/10 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium tracking-wide uppercase">
          {savingsLabel}
        </span>
      )}
    </div>
  );
}

function TierCard({ planKey, cycle }: { planKey: Plan; cycle: Cycle }) {
  const plan = PLANS[planKey];
  const isPro = planKey === "pro";

  const monthly = plan.priceMonthly ?? 0;
  const yearly = plan.priceYearly ?? 0;
  const isFree = monthly === 0 && yearly === 0;

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-2xl border p-8 transition-colors",
        isPro
          ? "border-primary/40 bg-card ring-primary/20 ring-1"
          : "bg-card border-border/60",
      )}
    >
      <div className="relative flex flex-1 flex-col gap-8">
        <header className="flex items-baseline justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-xl font-semibold tracking-tight">
              {plan.name}
            </h2>
            <p className="text-muted-foreground text-sm">{plan.tagline}</p>
          </div>
          {isPro && (
            <span className="border-primary/30 text-primary inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wider uppercase">
              Popular
            </span>
          )}
        </header>

        <div className="flex flex-col gap-1">
          <Price monthly={monthly} yearly={yearly} cycle={cycle} />
          <p className="text-muted-foreground text-sm">{plan.description}</p>
        </div>

        <div className="bg-border/60 h-px w-full" />

        <ul className="flex flex-col gap-3 text-sm">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                  isPro
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <Check className="size-3" strokeWidth={3} />
              </span>
              <span className="text-foreground/90">{feature}</span>
            </li>
          ))}
        </ul>

        <div className="mt-auto pt-4">
          {isFree ? (
            <Button
              nativeButton={false}
              variant="outline"
              size="lg"
              className="w-full"
              render={<Link href="/sign-up" />}
            >
              Start free
            </Button>
          ) : (
            <>
              <AuthLoading>
                <Skeleton className="h-11 w-full rounded-md" />
              </AuthLoading>
              <Unauthenticated>
                <Button
                  nativeButton={false}
                  variant="primary"
                  size="lg"
                  className="w-full"
                  render={<Link href="/sign-up" />}
                >
                  Get started
                </Button>
              </Unauthenticated>
              <Authenticated>
                <ProCardAction cycle={cycle} />
              </Authenticated>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Price({
  monthly,
  yearly,
  cycle,
}: {
  monthly: number;
  yearly: number;
  cycle: Cycle;
}) {
  if (monthly === 0 && yearly === 0) {
    return (
      <div className="flex items-baseline gap-2">
        <span className="font-display text-5xl font-semibold tracking-tight tabular-nums">
          $0
        </span>
        <span className="text-muted-foreground text-sm">forever</span>
      </div>
    );
  }

  const amount = cycle === "monthly" ? monthly : Math.round(yearly / 12);
  const suffix = cycle === "monthly" ? "/mo" : "/mo, billed yearly";

  return (
    <div className="flex items-baseline gap-2">
      <span className="font-display text-5xl font-semibold tracking-tight tabular-nums">
        ${amount}
      </span>
      <span className="text-muted-foreground text-sm">{suffix}</span>
    </div>
  );
}

function ProCardAction({ cycle }: { cycle: Cycle }) {
  const { plan, isLoading } = useUserPlan();

  if (isLoading) return <Skeleton className="h-11 w-full rounded-md" />;

  if (plan === "pro") {
    return (
      <Button
        nativeButton={false}
        variant="outline"
        size="lg"
        className="w-full"
        render={<Link href="/settings/custom?tab=billing" />}
      >
        Manage subscription
      </Button>
    );
  }

  const productId =
    cycle === "yearly" ? PRO_YEARLY_PRODUCT_ID : PRO_MONTHLY_PRODUCT_ID;

  return (
    <CheckoutLink
      polarApi={{ generateCheckoutLink: api.polar.generateCheckoutLink }}
      productIds={[productId]}
      className="w-full"
      embed={false}
      lazy
    >
      <Button variant="primary" size="lg" className="w-full">
        Upgrade to Pro
      </Button>
    </CheckoutLink>
  );
}
