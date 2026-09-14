/**
 * Which Polar subscriptions count as Pro (`planForSubscription`,
 * convex/lib/plans.ts). The component returns any subscription that hasn't
 * ended, whatever its status, so this rule is the only thing standing between
 * an unpaid subscription and Pro features.
 */
import { describe, expect, test } from "vitest";
import { planForSubscription } from "../convex/lib/plans";

describe("planForSubscription", () => {
  test.each(["active", "trialing", "past_due"])(
    "%s on a Pro product is pro",
    (status) => {
      expect(planForSubscription({ status, productKey: "proMonthly" })).toBe(
        "pro",
      );
      expect(planForSubscription({ status, productKey: "proYearly" })).toBe(
        "pro",
      );
    },
  );

  test.each(["incomplete", "incomplete_expired", "unpaid", "canceled"])(
    "%s is free even on a Pro product",
    (status) => {
      expect(planForSubscription({ status, productKey: "proMonthly" })).toBe(
        "free",
      );
    },
  );

  test("no subscription, or a product that isn't Pro, is free", () => {
    expect(planForSubscription(null)).toBe("free");
    expect(planForSubscription({ status: "active" })).toBe("free");
    expect(
      planForSubscription({ status: "active", productKey: "somethingElse" }),
    ).toBe("free");
  });
});
