import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_COMPANY, LEGAL_CONTACT_EMAIL, LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern use of Simplr, the AI leasing assistant for residential property managers.",
};

export default function TermsOfServicePage() {
  const mail = <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>;

  return (
    <LegalPage title="Terms of Service" effectiveDate="September 14, 2026">
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your use of Simplr, including the website at simplr.pro, the
        Simplr dashboard and the Simplr AI assistant (together, the &ldquo;Service&rdquo;), operated by {LEGAL_COMPANY}{" "}
        (&ldquo;Simplr&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). By creating an account or using the Service, you
        agree to these Terms. If you use the Service for a company, you agree on its behalf and confirm you have
        authority to do so; &ldquo;you&rdquo; then includes that company.
      </p>

      <h2>1. Eligibility</h2>
      <p>
        You must be at least 18 years old and use the Service for business purposes. You may not use the Service if
        the law prohibits you from doing so.
      </p>

      <h2>2. The Service</h2>
      <p>
        Simplr provides an AI assistant that answers calls and messages for residential properties, qualifies
        prospective renters against criteria you set, logs maintenance issues, and books property tours onto the
        calendars of team members you make available. We may change or improve the Service over time.
      </p>
      <p>
        The assistant uses artificial intelligence and can make mistakes, misunderstand callers or give incomplete
        answers. You are responsible for reviewing bookings, leads and issues, and for decisions you make about
        applicants and residents. The Service is not an emergency service. It does not replace emergency services
        or your own maintenance emergency procedures, and it does not provide legal advice.
      </p>

      <h2>3. Accounts and teams</h2>
      <ul>
        <li>You must give accurate information and keep your sign-in details secure.</li>
        <li>
          The person who creates a team is its admin. Admins can invite members, change who is available for tours and
          remove members. You are responsible for everything done through your account and team.
        </li>
        <li>Tell us promptly at {mail} if you believe your account has been accessed without permission.</li>
      </ul>

      <h2>4. Your responsibilities</h2>
      <p>Because the Service communicates with people on your behalf, you are responsible for:</p>
      <ul>
        <li>
          Giving any notices and getting any consents the law requires for calls and texts, for recording or
          transcribing conversations, and for using an AI assistant. This includes the Telephone Consumer Protection
          Act and state call recording and AI disclosure laws.
        </li>
        <li>
          Making sure the screening questions and criteria you configure comply with fair housing and
          anti-discrimination laws.
        </li>
        <li>
          The accuracy of your property details, prices, availability and knowledge base, which the assistant uses to
          answer questions.
        </li>
        <li>Having the right to upload and use any content you add to the Service.</li>
      </ul>

      <h2>5. Google Calendar and other services</h2>
      <p>
        When you connect a Google account, you allow Simplr to check when you are busy and to add, update and remove
        the tour events it books on your calendar, as described in our{" "}
        <Link href="/privacy">Privacy Policy</Link>. You can disconnect at any time, but you cannot be assigned tours
        while disconnected. The Service relies on third-party services such as Google, ElevenLabs, Twilio and
        WhatsApp. Your use of those services is subject to their own terms, and we are not responsible for their
        availability or conduct.
      </p>

      <h2>6. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service for anything unlawful, deceptive, harassing or discriminatory.</li>
        <li>Send spam or unsolicited messages, or contact people without the consent the law requires.</li>
        <li>Upload malware, or content that infringes someone else&apos;s rights.</li>
        <li>
          Try to access accounts or data that are not yours, disrupt or overload the Service, or get around its
          security or usage limits.
        </li>
        <li>Copy, reverse engineer or resell the Service, or use it to build a competing product.</li>
        <li>Misuse the demo on our website, including placing automated or abusive demo calls.</li>
      </ul>

      <h2>7. Your data</h2>
      <p>
        You own the content you and your callers provide through the Service (&ldquo;Customer Data&rdquo;). You give us
        permission to host, copy, process and display Customer Data only as needed to provide, secure and support the
        Service. We handle personal information as described in our <Link href="/privacy">Privacy Policy</Link>. We
        may use aggregated information that does not identify you, your callers or your team to operate and improve
        the Service. This never includes data received from Google APIs.
      </p>

      <h2>8. Fees</h2>
      <p>
        Some features may require a paid plan. If you buy one, you agree to pay the fees stated when you buy it, plus
        applicable taxes. Unless your plan says otherwise or the law requires it, fees are non-refundable. We will
        give notice before changing the price of a plan you are on.
      </p>

      <h2>9. Our intellectual property</h2>
      <p>
        The Service, including its software, design and the Simplr name and logo, belongs to {LEGAL_COMPANY} and is
        protected by law. These Terms give you a limited, non-exclusive, non-transferable right to use the Service
        while your account is active. If you send us feedback, we may use it without any obligation to you.
      </p>

      <h2>10. Suspension and termination</h2>
      <p>
        You may stop using the Service and delete your account at any time. We may suspend or end your access if you
        break these Terms, if your use creates legal or security risk, or if required by law. We will give notice where
        we reasonably can. When an account ends, its data is deleted as described in our{" "}
        <Link href="/privacy">Privacy Policy</Link>. Sections 4, 7, 9 and 11 to 15 continue after termination.
      </p>

      <h2>11. Disclaimers</h2>
      <p>
        The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the fullest extent the law allows,
        we disclaim all warranties, express or implied, including merchantability, fitness for a particular purpose
        and non-infringement. We do not promise that the Service will be uninterrupted or error-free, that the AI
        assistant will always be accurate, or that any lead will result in a lease.
      </p>

      <h2>12. Limitation of liability</h2>
      <p>
        To the fullest extent the law allows, Simplr will not be liable for any indirect, incidental, special,
        consequential or punitive damages, or for lost profits, revenue, leases or data. Our total liability for all
        claims relating to the Service is limited to the greater of the amount you paid us in the 12 months before the
        claim arose or US $100.
      </p>

      <h2>13. Indemnity</h2>
      <p>
        You will defend and indemnify Simplr against claims, losses and costs, including reasonable legal fees, arising
        from your Customer Data, your breach of these Terms, or your failure to meet the responsibilities in section 4.
      </p>

      <h2>14. Governing law</h2>
      <p>
        These Terms are governed by the laws of the State of Delaware, United States, without regard to its conflict of
        law rules. Any dispute relating to these Terms or the Service will be resolved exclusively in the state or
        federal courts located in Delaware, and you and Simplr consent to their jurisdiction.
      </p>

      <h2>15. General</h2>
      <ul>
        <li>
          We may update these Terms. If we make material changes, we will notify account holders before they take effect.
          Continuing to use the Service after that means you accept the updated Terms.
        </li>
        <li>These Terms and our Privacy Policy are the entire agreement between you and Simplr about the Service.</li>
        <li>If any part of these Terms cannot be enforced, the rest stays in effect.</li>
        <li>Not enforcing a term is not a waiver of it. You may not transfer these Terms without our consent.</li>
      </ul>

      <h2>16. Contact us</h2>
      <p>
        {LEGAL_COMPANY}
        <br />
        Email: {mail}
      </p>
    </LegalPage>
  );
}
