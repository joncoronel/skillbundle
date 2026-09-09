/**
 * Shared constants for the legal pages and anything that links to them.
 *
 * These live in one place because they appear in more than one document and a
 * privacy policy that names a different contact address than the terms is a
 * real problem, not a typo. `SUPPORT_EMAIL` is also what the footer links.
 *
 * Dependency-free on purpose (same reasoning as `lib/bundle-limits.ts`): the
 * footer is a Server Component, the legal pages are static, and nothing here
 * should ever pull a client module into either graph.
 */

export const SUPPORT_EMAIL = "support@skillbundle.dev";

/** The operator named in both documents. Sole operator, no company entity. */
export const OPERATOR = "Jonathan Coronel";

/**
 * The jurisdiction whose law governs the terms, and whose courts hear a
 * dispute. Phrased as "the State of X, United States" or "England and Wales".
 *
 * PLACEHOLDER — fill this in before launch. A governing-law clause naming
 * nowhere is worse than no clause: it reads as boilerplate that was never
 * reviewed, which is the impression it exists to prevent. This is the only
 * value in either document that is not already true of the app.
 */
export const GOVERNING_LAW = "[YOUR STATE OR COUNTRY]";

/**
 * Last substantive revision, shown at the top of each document.
 *
 * A literal string rather than a `Date`, and that is load-bearing under Cache
 * Components: `new Date()` in a prerendered Server Component is uncached
 * dynamic IO, so building this from the clock would take the whole route (and
 * anything sharing its shell) out of the static prerender. It also would not
 * mean what it says — a deploy timestamp is not a revision date.
 *
 * Update by hand when the text changes in a way that affects users. Changing a
 * typo is not that.
 */
export const LEGAL_LAST_UPDATED = "8 September 2026";

/**
 * The third parties that process user data, listed in the privacy policy.
 *
 * Kept as data rather than prose so adding a service means adding a row here,
 * next to the reason it is in the graph. If you wire up a new provider that
 * touches user data and this list does not grow, the policy has become false.
 */
export const SUBPROCESSORS = [
  {
    name: "Vercel",
    purpose: "Website hosting and delivery",
    href: "https://vercel.com/legal/privacy-policy",
  },
  {
    name: "Convex",
    purpose: "Application database and backend functions",
    href: "https://www.convex.dev/legal/privacy",
  },
  {
    name: "Clerk",
    purpose: "Account creation, sign-in, and session management",
    href: "https://clerk.com/legal/privacy",
  },
  {
    name: "Polar",
    purpose: "Subscription payments, as merchant of record",
    href: "https://polar.sh/legal/privacy",
  },
  {
    name: "Typesense (Railway)",
    purpose: "Catalog search. Receives your search queries, not your identity",
    href: "https://typesense.org/privacy",
  },
  {
    name: "OpenPanel",
    purpose: "Privacy-focused, cookieless product analytics",
    href: "https://openpanel.dev/privacy",
  },
  {
    name: "GitHub",
    purpose:
      "Reading public repository contents to index skills, and optional sign-in",
    href: "https://docs.github.com/en/site-policy/privacy-policies",
  },
  {
    name: "Voyage AI",
    purpose:
      "Generating embeddings of public skill text for search and matching",
    href: "https://www.voyageai.com/privacy-policy",
  },
] as const;
