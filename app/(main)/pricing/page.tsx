import type { Metadata } from "next";
import { FREE_WATCHED_SKILLS, PLANS } from "@/lib/plans";
import { PricingCards } from "./pricing-cards";
import { PricingFaq } from "./pricing-faq";

export const metadata: Metadata = {
  title: "Pricing - SkillBundle",
  description: `Watch up to ${FREE_WATCHED_SKILLS} skills free, forever, security warnings included. Pro is $${PLANS.pro.priceMonthly}/month for unlimited watching and repo matching.`,
};

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 pt-16 pb-24">
      <header className="mx-auto max-w-2xl text-center">
        <h1 className="text-hero">Watch for free. Pay for scale.</h1>
        <p className="mx-auto mt-5 max-w-md text-sm text-muted-foreground">
          Free covers {FREE_WATCHED_SKILLS} skills and sees every change,
          security warnings included. Pro is for setups that depend on more.
        </p>
      </header>

      <section className="mt-12" aria-label="Plans">
        <PricingCards />
      </section>

      <section className="mt-20">
        <PricingFaq />
      </section>
    </div>
  );
}
