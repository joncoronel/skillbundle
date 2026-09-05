---
version: 1
slug: "app-main-pricing-page-tsx"
primary_target: "app/(main)/pricing/page.tsx"
related_targets: ["app/(main)/pricing/pricing-cards.tsx"]
---

# /pricing

**Mode:** Persuade. The visitor decides between Free and Pro and acts.

**Audience and job:** A developer who already understands the product (they came from the app or the home page) deciding whether 25 watched skills is enough. The action is Pro's button; Free's is a sign-up.

**Proof / content:** Prices and limits come only from `lib/plans.ts`, which mirrors `convex/lib/plans.ts`. Nothing is claimed here that is not gated there.

**Direction (Sept 2026):** Two cards, Free first with its full list, Pro as "Everything in Free, plus" exactly the items Free lacks. Replaced a nine-row comparison plate whose rows were mostly two identical ticks. Both cards share one anatomy (name, price, action, list); Pro differs by one shadow level, the list heading, and the single blue action on the page.

**Memorable moment:** The billing toggle's indicator slides between labels, and the Pro price crossfades with a 2px blur when the cycle changes. One spring (0.2s, no bounce) for both. Reduced motion drops the movement and keeps the fade.

**Constraints:** Route must stay fully static; user data arrives over the Convex websocket (`e2e/instant-navigation.spec.ts` guards this and asserts the h1 copy). Keep Pro's list to what Free does not have; the heading already says the rest.

**Unresolved:** Whether the FAQ earns its length. Kept for now because every entry answers a question the cards raise.
