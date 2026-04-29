"use client";

import { useState } from "react";
import Link from "next/link";
import { useAction } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { useUserPlan } from "@/hooks/use-user-plan";
import { PLANS } from "@/lib/plans";
import { Badge } from "@/components/ui/cubby-ui/badge";
import { Button } from "@/components/ui/cubby-ui/button";
import { Separator } from "@/components/ui/cubby-ui/separator";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { SettingsSection } from "./settings-section";

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function BillingSkeleton() {
  return (
    <div className="flex flex-col gap-10">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-10">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-44" />
        </div>
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-9 w-40" />
        </div>
      </div>
    </div>
  );
}

export function BillingTab() {
  const { plan, isLoading: planLoading } = useUserPlan();
  const { data: subscription, isPending: subPending } = useQuery(
    convexQuery(api.subscriptions.currentSubscription, {}),
  );
  const isLoading = planLoading || subPending;

  if (isLoading) return <BillingSkeleton />;

  return (
    <div className="flex flex-col gap-10">
      <SettingsSection
        title="Current plan"
        description="Your active subscription plan"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold">{PLANS[plan].name}</span>
            <Badge variant={plan === "pro" ? "default" : "outline"}>
              {plan === "pro" ? "Pro" : "Free"}
            </Badge>
            {subscription?.cancelAtPeriodEnd && (
              <Badge variant="warning">Canceling</Badge>
            )}
          </div>

          {subscription ? (
            <p className="text-sm text-muted-foreground">
              {subscription.amount != null && subscription.currency
                ? `${(subscription.amount / 100).toLocaleString("en-US", { style: "currency", currency: subscription.currency })}/${subscription.recurringInterval}`
                : PLANS[plan].priceMonthly
                  ? `$${PLANS[plan].priceMonthly}/month`
                  : "Free"}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No active subscription
            </p>
          )}

          {plan === "free" ? (
            <Button
              nativeButton={false}
              variant="primary"
              className="w-fit"
              render={<Link href="/pricing" />}
            >
              Upgrade to Pro
            </Button>
          ) : (
            <ManageSubscriptionButton />
          )}
        </div>
      </SettingsSection>

      {subscription && (
        <>
          <Separator />

          <SettingsSection
            title="Billing period"
            description="Your current billing cycle and renewal info"
          >
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm text-muted-foreground">
                  Current period
                </span>
                <span className="text-sm font-medium">
                  {formatDate(subscription.currentPeriodStart)} —{" "}
                  {formatDate(subscription.currentPeriodEnd)}
                </span>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm text-muted-foreground">
                  {subscription.cancelAtPeriodEnd ? "Access until" : "Renews on"}
                </span>
                <span className="text-sm font-medium">
                  {subscription.cancelAtPeriodEnd ? (
                    <span className="text-warning-foreground">
                      {formatDate(subscription.currentPeriodEnd)}
                    </span>
                  ) : (
                    formatDate(subscription.currentPeriodEnd)
                  )}
                </span>
              </div>

              {subscription.startedAt && (
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <span className="text-sm text-muted-foreground">
                    Member since
                  </span>
                  <span className="text-sm font-medium">
                    {formatDate(subscription.startedAt)}
                  </span>
                </div>
              )}

              {subscription.cancelAtPeriodEnd && (
                <p className="text-sm text-muted-foreground">
                  Your subscription has been canceled. You&apos;ll retain access
                  to Pro features until the end of your current billing period.
                </p>
              )}
            </div>
          </SettingsSection>
        </>
      )}
    </div>
  );
}

function ManageSubscriptionButton() {
  const generatePortalUrl = useAction(api.polar.generateCustomerPortalUrl);
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const result = await generatePortalUrl({});
      if (result?.url) {
        window.open(result.url, "_blank");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="outline"
      className="w-fit"
      onClick={handleClick}
      loading={loading}
    >
      {loading ? "Opening…" : "Manage subscription"}
    </Button>
  );
}
