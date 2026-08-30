"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/cubby-ui/accordion";
import { FREE_WATCHED_SKILLS, PLANS, yearlySavingsPercent } from "@/lib/plans";

const savings = yearlySavingsPercent(PLANS.pro);

/**
 * The questions the plate raises, in the order it raises them. Not a generic
 * SaaS FAQ — every entry here answers something a reader can only have wondered
 * after seeing the comparison above it.
 */
const FAQ = [
  {
    q: `What happens when I hit ${FREE_WATCHED_SKILLS} skills?`,
    a: `Nothing breaks and nothing stops being watched. You just can't add a ${FREE_WATCHED_SKILLS + 1}st until you upgrade or remove one. Everything already on the list keeps reporting.`,
  },
  {
    q: "Does a skill in two lists count twice?",
    a: "No. The limit counts distinct skills, so filing the same one in three lists still costs one. Organising isn't the thing being metered.",
  },
  {
    q: "Do I have to pay to hear about security problems?",
    a: "No, and we won't build that. If a skill you watch fails an audit it failed before, you're told on every plan, at the same time. Charging for that would make the warning worth less than the subscription.",
  },
  {
    q: "What does repo matching actually do?",
    a: "You point it at a GitHub repo and it reads what the project actually uses, then matches that against the catalog instead of making you guess at search terms. It costs real API and compute per run, which is why it's the one discovery feature behind the paywall. You can try it free on a demo repo.",
  },
  {
    q: "What's a GitHub-only skill?",
    a: "A SKILL.md that exists in a repo but isn't listed on skills.sh. Adding one makes us go discover, fetch and audit it, so free accounts get three. Adding skills that are already on skills.sh is unlimited on every plan.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel in billing settings and Pro stays active until the end of the period you've paid for. Nothing is deleted when it ends — you go back to the free limit and choose what to keep watching.",
  },
  ...(savings
    ? [
        {
          q: "Is yearly worth it?",
          a: `Yearly is $${PLANS.pro.priceYearly} instead of $${(PLANS.pro.priceMonthly ?? 0) * 12}, so ${savings}% off. Only worth it if you already know you'll keep it — the monthly price is low enough that guessing wrong costs more than waiting.`,
        },
      ]
    : []),
];

export function PricingFaq() {
  return (
    <div aria-labelledby="faq-heading" className="flex flex-col gap-6">
      <h2
        id="faq-heading"
        className="text-2xl font-semibold tracking-tight md:text-3xl"
      >
        Things people ask.
      </h2>

      <Accordion variant="outline">
        {FAQ.map((item) => (
          <AccordionItem key={item.q} value={item.q}>
            <AccordionTrigger
              indicatorType="plus"
              className="text-base font-medium"
            >
              {item.q}
            </AccordionTrigger>
            <AccordionContent>{item.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
