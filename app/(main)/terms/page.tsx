import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, LegalSection } from "@/components/legal-document";
import { PLANS } from "@/lib/plans";
import { GOVERNING_LAW, OPERATOR, SUPPORT_EMAIL } from "@/lib/legal";

/**
 * The terms of service.
 *
 * The clause that matters most here is section 5, the catalog disclaimer. This
 * product displays security verdicts about OTHER PEOPLE'S code, indexed
 * automatically, and tells users which of their dependencies changed. If
 * someone installs a skill we called clean and it turns out not to be, the
 * question of what we promised is answered by that section and nowhere else.
 * Weakening it is a product decision, not an editing one.
 *
 * Prices come from `lib/plans.ts` rather than being written out, for the same
 * reason the pricing page reads them from there: two numbers that must agree
 * should have one source. Note `docs/polar-launch-checklist.md` still quotes an
 * older $8/$72 pair and is stale.
 *
 * Like `/privacy`, this route shadows the `/[org]` catch-all and is registered
 * in `RESERVED_ROOT_SEGMENTS` (`lib/sitemap-entries.ts`) for that reason.
 */

export const metadata: Metadata = {
  title: "Terms of Service - SkillBundle",
  description:
    "The rules for using SkillBundle, what we promise about the catalog, and how subscriptions work.",
};

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Service"
      summary="The rules for using SkillBundle, what we do and don't promise about the skill catalog, and how subscriptions work."
    >
      <p>
        These terms are an agreement between you and {OPERATOR}, who operates
        SkillBundle as an individual. By using skillbundle.dev you accept them.
        If you do not, please do not use the service.
      </p>

      <LegalSection id="service" heading="1. What SkillBundle is">
        <p>
          SkillBundle indexes AI coding assistant skills published on skills.sh
          and in public GitHub repositories. It lets you search them, compare
          them, group them into bundles, and see when a skill you depend on
          changes. It is a directory and a monitoring tool. It does not host,
          author, or distribute the skills themselves.
        </p>
      </LegalSection>

      <LegalSection id="accounts" heading="2. Your account">
        <p>
          You need an account to save bundles. You must give an accurate email
          address, keep your credentials secure, and you are responsible for
          what happens under your account. You must be at least 16 years old.
          One person, one account. Do not share an account with others.
        </p>
      </LegalSection>

      <LegalSection id="acceptable-use" heading="3. Acceptable use">
        <p>Do not use SkillBundle to:</p>
        <ul>
          <li>
            Submit skills you know to be malicious, deceptive, or misrepresented
            as something they are not.
          </li>
          <li>
            Scrape the catalog at scale, circumvent rate limits, or otherwise
            place an unreasonable load on the service. The catalog is also
            available from its original sources.
          </li>
          <li>
            Attempt to gain access to accounts, data, or systems that are not
            yours.
          </li>
          <li>Break the law, or infringe anyone&apos;s rights.</li>
        </ul>
        <p>
          We may remove content and suspend or close accounts that break these
          rules. Where it is practical and lawful to do so, we will tell you
          why.
        </p>
      </LegalSection>

      <LegalSection id="your-content" heading="4. Your content">
        <p>
          Your bundles are yours. You keep all rights to them. You grant us only
          the permission needed to operate the service: to store your bundles,
          show them back to you, and display a bundle to anyone holding its link
          if you have chosen to share it. That permission ends when you delete
          the content or your account.
        </p>
        <p>
          If you add a skill to the public catalog, you are stating that it
          points to a real, public repository and that you are not
          misrepresenting what it does. Catalog entries are visible to everyone
          and stay in the catalog if you close your account, though the record
          connecting them to you is removed.
        </p>
      </LegalSection>

      <LegalSection
        id="catalog-disclaimer"
        heading="5. The catalog, and what we don't promise about it"
      >
        <p>
          Please read this section even if you skip the rest. It describes the
          single biggest limit on what SkillBundle can do for you.
        </p>
        <p>
          Skills in the catalog are written and published by third parties. We
          do not write them, review them by hand, control them, or vouch for
          them. Metadata, install counts, and descriptions are indexed
          automatically from skills.sh and from public GitHub repositories, and
          may be out of date, incomplete, or wrong.
        </p>
        <p>
          <strong>Security verdicts are automated and advisory.</strong> Where a
          skill shows a security assessment, that assessment is generated
          automatically. It is not a professional security audit and it is not a
          guarantee. A skill marked as showing no problems may still be harmful.
          A skill flagged as risky may be perfectly safe. You are responsible
          for reviewing any code or instructions before you install or run them,
          and for the consequences of doing so.
        </p>
        <p>
          <strong>Change monitoring is best effort.</strong> We check watched
          skills on a schedule and report differences we detect. We do not
          promise to detect every change, to detect one within any particular
          time, or to remain available. Do not rely on SkillBundle as your only
          control against a supply chain risk.
        </p>
      </LegalSection>

      <LegalSection id="ip" heading="6. Intellectual property and takedowns">
        <p>
          Skills belong to their authors and remain subject to their own
          licences. SkillBundle&apos;s own name, design, and code are ours or
          our licensors&apos;.
        </p>
        <p>
          If material in the catalog infringes your copyright, email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with enough
          detail to identify the work and the entry, where in the catalog it
          appears, your contact details, and a statement that you believe in
          good faith that the use is not authorised. We remove infringing
          entries promptly on a valid notice. Because our entries point to
          public repositories we do not control, a takedown at the original
          source is usually the more effective remedy, and we are happy to help
          you identify it.
        </p>
      </LegalSection>

      <LegalSection id="billing" heading="7. Subscriptions and billing">
        <p>
          SkillBundle is free to use within the limits shown on the{" "}
          <Link href="/pricing">pricing page</Link>. Pro is $
          {PLANS.pro.priceMonthly} per month or ${PLANS.pro.priceYearly} per
          year.
        </p>
        <p>
          Payments are processed by Polar, which acts as merchant of record.
          Polar&apos;s own terms apply to the transaction, and your receipts and
          invoices come from Polar. We never see or store your card details.
        </p>
        <p>
          Subscriptions renew automatically until cancelled. You can cancel at
          any time from your account settings; cancelling stops the next renewal
          and you keep Pro access until the end of the period you have already
          paid for. We do not give partial refunds for unused time, but if
          something has gone wrong, email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we will
          sort it out. Where the law gives you a refund right, that right
          applies regardless of anything in this section.
        </p>
        <p>
          We may change prices. Existing subscribers get at least 30 days&apos;
          notice before a change takes effect on their subscription, and can
          cancel before it does.
        </p>
      </LegalSection>

      <LegalSection id="availability" heading="8. Availability and changes">
        <p>
          We may change, suspend, or discontinue any part of SkillBundle. It is
          provided without an uptime commitment. We will give reasonable notice
          before permanently discontinuing the service or a paid feature, and
          will refund the unused portion of a paid subscription if we do.
        </p>
      </LegalSection>

      <LegalSection id="termination" heading="9. Ending this agreement">
        <p>
          You can stop using SkillBundle and delete your account at any time
          from your account settings. We may suspend or close an account that
          breaks section 3, or that we are legally required to close. Sections
          5, 10, and 11 survive the end of this agreement.
        </p>
      </LegalSection>

      <LegalSection id="warranty" heading="10. Disclaimer">
        <p>
          SkillBundle is provided &quot;as is&quot; and &quot;as
          available&quot;, without warranties of any kind, whether express or
          implied, including any implied warranties of merchantability, fitness
          for a particular purpose, or non-infringement. We do not warrant that
          the service will be uninterrupted, secure, or error free, or that the
          information in the catalog is accurate or current.
        </p>
      </LegalSection>

      <LegalSection id="liability" heading="11. Limitation of liability">
        <p>
          To the fullest extent the law allows, we are not liable for indirect,
          incidental, special, consequential, or punitive damages, or for lost
          profits, lost data, or business interruption, arising from your use of
          SkillBundle. Our total liability for any claim relating to the service
          is limited to the greater of the amount you paid us in the twelve
          months before the claim, or fifty US dollars.
        </p>
        <p>
          Nothing here limits liability that cannot be limited by law, including
          liability for fraud, or for death or personal injury caused by
          negligence. Some jurisdictions do not allow certain limitations, in
          which case the limitations above apply only as far as that
          jurisdiction permits.
        </p>
      </LegalSection>

      <LegalSection id="governing-law" heading="12. Governing law">
        <p>
          These terms are governed by the laws of {GOVERNING_LAW}, without
          regard to its conflict of law rules, and the courts there have
          exclusive jurisdiction over any dispute. If you are a consumer, this
          does not deprive you of the protection of the mandatory law of the
          country where you live.
        </p>
      </LegalSection>

      <LegalSection id="changes" heading="13. Changes to these terms">
        <p>
          We may update these terms. The date at the top of this page shows the
          last revision, and we will give notice in the app of any change that
          materially reduces your rights. Continuing to use SkillBundle after a
          change takes effect means you accept the updated terms.
        </p>
      </LegalSection>

      <LegalSection id="contact" heading="14. Contact">
        <p>
          Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with any
          question about these terms. See also our{" "}
          <Link href="/privacy">privacy policy</Link>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
