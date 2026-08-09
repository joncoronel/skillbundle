import type { Metadata } from "next";
import { FREE_WATCHED_SKILLS, PLANS } from "@/lib/plans";
import { PricingPlate } from "./pricing-plate";
import { PricingFaq } from "./pricing-faq";

export const metadata: Metadata = {
  title: "Pricing - SkillBundle",
  description: `Watch up to ${FREE_WATCHED_SKILLS} skills free, forever, security warnings included. Pro is $${PLANS.pro.priceMonthly}/month for unlimited watching and repo matching.`,
};

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 pt-16 pb-24">
      <header className="mx-auto max-w-2xl text-center">
        <h1 className="font-display text-[clamp(2.5rem,6vw,4rem)] font-medium leading-hero tracking-tight text-balance">
          Two plans. One product.
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">
          Both watch the skills you depend on and tell you the day one changes.
          The difference is how many you can watch.
        </p>
      </header>

      <section className="mt-12">
        <PricingPlate />
      </section>

      <section className="mt-20">
        <PricingFaq />
      </section>
    </main>
  );
}
