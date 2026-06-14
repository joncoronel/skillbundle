import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/cubby-ui/button";
import { PricingContent } from "./pricing-content";
import { PricingComparison } from "./pricing-comparison";
import { PricingFaq } from "./pricing-faq";

export const metadata: Metadata = {
  title: "Pricing - SkillBundle",
  description:
    "Pick a plan that fits how you build. Start free, upgrade when auto-detection and unlimited bundles start paying for themselves.",
};

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 pt-16 pb-24">
      <PricingHero />

      <section className="mt-16">
        <PricingContent />
      </section>

      <section className="mt-24">
        <PricingComparison />
      </section>

      <section className="mt-24">
        <PricingFaq />
      </section>

      <ClosingCta />
    </main>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-widest uppercase">
      <span aria-hidden className="bg-primary inline-block size-1.5 rounded-full" />
      <span>{children}</span>
    </div>
  );
}

function PricingHero() {
  return (
    <section className="grid gap-8 md:grid-cols-[1.4fr_1fr] md:items-end">
      <div className="flex flex-col gap-5">
        <SectionEyebrow>Pricing</SectionEyebrow>
        <h1 className="font-display text-5xl leading-hero font-medium tracking-tight text-balance md:text-6xl lg:text-7xl">
          Pay for the
          <br />
          parts that
          <br />
          <span className="text-primary">save you time.</span>
        </h1>
      </div>
      <p className="text-muted-foreground max-w-sm text-base md:justify-self-end md:text-right">
        Start free with manual stack selection and three saved bundles. Upgrade
        to Pro when auto-detection, unlimited bundles, and private bundles earn
        their keep.
      </p>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="border-border/60 bg-card mt-24 overflow-hidden rounded-3xl border p-10 md:p-14">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="flex max-w-xl flex-col gap-3">
          <SectionEyebrow>Start stacking</SectionEyebrow>
          <h2 className="font-display text-3xl leading-tight font-medium tracking-tight text-balance md:text-4xl">
            Three saved bundles are free.
            <br />
            You&apos;ll know when you want more.
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            nativeButton={false}
            variant="primary"
            size="lg"
            render={<Link href="/sign-up" />}
          >
            Start free
          </Button>
          <Button
            nativeButton={false}
            variant="ghost"
            size="lg"
            render={<Link href="/explore" />}
          >
            Browse community bundles
          </Button>
        </div>
      </div>
    </section>
  );
}
