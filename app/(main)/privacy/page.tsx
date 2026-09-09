import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, LegalSection } from "@/components/legal-document";
import { OPERATOR, SUBPROCESSORS, SUPPORT_EMAIL } from "@/lib/legal";

/**
 * The privacy policy.
 *
 * Two things to keep true when editing, because both are load-bearing outside
 * this file:
 *
 *   1. **The subprocessor list is data, not prose.** It comes from
 *      `lib/legal.ts` so that adding a service that touches user data means
 *      adding a row there, beside the reason. Do not inline a service here.
 *   2. **This route shadows the `/[org]` catch-all.** `privacy` is registered
 *      in `RESERVED_ROOT_SEGMENTS` (`lib/sitemap-entries.ts`) so the sitemap
 *      never advertises a GitHub org of that name, whose page this page would
 *      win. Same for `/terms`.
 *
 * Fully static: no data fetching, no client components, nothing dynamic.
 */

export const metadata: Metadata = {
  title: "Privacy Policy - SkillBundle",
  description:
    "What SkillBundle collects, why, who processes it, and how to get it deleted.",
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      summary="What SkillBundle collects, why it collects it, who else processes it, and how to get it deleted."
    >
      <p>
        SkillBundle is operated by {OPERATOR} as an individual, not through a
        company. This policy explains what happens to your data when you use{" "}
        <a href="https://skillbundle.dev">skillbundle.dev</a>. Questions about
        anything here go to{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>

      <LegalSection id="what-we-collect" heading="1. What we collect">
        <p>
          You can browse the entire skill catalog without an account. Nothing in
          this section applies until you sign up.
        </p>
        <p>
          <strong>Account information.</strong> When you create an account, our
          authentication provider stores your email address, your display name,
          and a profile image if you set one. If you sign in with Google or
          GitHub, we receive the same fields from that provider instead of a
          password. Passwords, when used, are stored and verified by the
          authentication provider and are never visible to us.
        </p>
        <p>
          <strong>What you create.</strong> The bundles you build, the skills in
          them, whether each bundle is shared by link, and when you last opened
          each one. That last timestamp is how the app can tell you what changed
          since your previous visit.
        </p>
        <p>
          <strong>Contributions.</strong> If you add a skill to the public
          catalog, your account is recorded as the one that added it, so that a
          bad entry can be traced and removed.
        </p>
        <p>
          <strong>Subscription status.</strong> If you subscribe, we store which
          plan you are on and whether it is active. We never receive or store
          your card details. Payments are handled entirely by Polar, which acts
          as merchant of record.
        </p>
        <p>
          <strong>Usage analytics.</strong> We record which pages are viewed,
          using a privacy-focused analytics service that sets no cookies and
          does not build cross-site profiles of you. This is not tied to your
          account. These requests pass through our own servers, which strip your
          session before forwarding them, so the analytics provider receives the
          page and your IP address and nothing that identifies your account.
        </p>
        <p>
          <strong>Repositories you point us at.</strong> If you use repository
          matching, we read the public file listing of the repository you
          specify in order to work out which technologies it uses. We read
          public repository contents only, we do not store the file contents,
          and we never request write access.
        </p>
      </LegalSection>

      <LegalSection id="what-we-dont" heading="2. What we don't do">
        <p>
          We do not sell your data. We do not share it with advertisers. We do
          not send you marketing email. SkillBundle sends no email of its own at
          all: the only messages you will receive are account emails from our
          authentication provider, such as a sign-in code, and payment receipts
          from Polar. Change notifications for the skills you watch appear in
          the app, not in your inbox.
        </p>
      </LegalSection>

      <LegalSection id="why" heading="3. Why we're allowed to hold it">
        <p>
          For account data, bundles, and subscription status, the basis is
          performing the contract you entered into by signing up. The product
          cannot show you your bundles without storing your bundles. For
          analytics and abuse prevention, the basis is our legitimate interest
          in understanding whether the product works and in keeping the public
          catalog usable.
        </p>
      </LegalSection>

      <LegalSection id="processors" heading="4. Who else processes your data">
        <p>
          Running SkillBundle means using other companies for hosting,
          authentication, payment, and search. Each one is listed below with
          what it is used for and a link to its own privacy policy.
        </p>
        <ul>
          {SUBPROCESSORS.map((processor) => (
            <li key={processor.name}>
              <a href={processor.href}>{processor.name}</a>: {processor.purpose}
              .
            </li>
          ))}
        </ul>
        <p>
          One of these is worth calling out because it is unusual. Catalog
          search runs directly from your browser to our search provider rather
          than passing through our servers, which is what makes it fast. That
          means your search queries and your IP address reach that provider
          directly. It receives no account information with them.
        </p>
      </LegalSection>

      <LegalSection id="retention" heading="5. How long we keep it">
        <p>
          Account data and bundles are kept until you delete them or delete your
          account. Analytics are aggregate and not linked to your account.
          Records that we are required to keep for tax or accounting reasons,
          such as payment records held by Polar, are kept for as long as that
          obligation lasts, regardless of whether you close your account.
        </p>
      </LegalSection>

      <LegalSection id="your-rights" heading="6. Your rights">
        <p>
          You can access and correct your account details, and delete your
          account outright, from your{" "}
          <Link href="/settings">account settings</Link>. Deleting your account
          removes your profile and your bundles from our database. Skills you
          contributed to the public catalog remain in the catalog, because they
          describe someone else&apos;s public repository rather than you, but
          the link between those entries and your account is removed with it.
        </p>
        <p>
          Depending on where you live, you may also have the right to a copy of
          your data in a portable format, to object to certain processing, or to
          complain to a data protection authority. To exercise any of these,
          email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we
          will respond within 30 days.
        </p>
      </LegalSection>

      <LegalSection id="transfers" heading="7. Where your data is held">
        <p>
          Our providers operate in the United States and elsewhere, so your data
          may be processed outside your own country. Each provider linked in
          section 4 documents its own transfer safeguards.
        </p>
      </LegalSection>

      <LegalSection id="children" heading="8. Children">
        <p>
          SkillBundle is a tool for software developers and is not directed at
          children. We do not knowingly collect data from anyone under 16. If
          you believe a child has created an account, email us and we will
          remove it.
        </p>
      </LegalSection>

      <LegalSection id="changes" heading="9. Changes to this policy">
        <p>
          If this policy changes in a way that meaningfully affects you, we will
          update the date at the top of this page and, for significant changes,
          show a notice in the app. Continuing to use SkillBundle after a change
          means you accept the updated policy.
        </p>
      </LegalSection>

      <LegalSection id="contact" heading="10. Contact">
        <p>
          Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> for
          anything covered by this policy, including data access and deletion
          requests.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
