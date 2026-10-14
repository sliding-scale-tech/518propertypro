import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_COMPANY, LEGAL_CONTACT_EMAIL, LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Simplr collects, uses, shares and protects information, including data from Google APIs.",
};

// Keep this page true to what the code does. Google's OAuth verification compares the Google
// user data section against the scopes the app requests and how it uses them.
export default function PrivacyPolicyPage() {
  const mail = <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>;

  return (
    <LegalPage title="Privacy Policy" effectiveDate="September 14, 2026">
      <p>
        Simplr is an AI leasing assistant for residential property managers, available at simplr.pro and operated
        by {LEGAL_COMPANY} (&ldquo;Simplr&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). It answers calls and messages
        from prospective renters and residents, qualifies leads against the property manager&apos;s own criteria, logs
        maintenance issues, and books property tours onto team members&apos; calendars.
      </p>
      <p>
        This policy explains what information we collect, how we use and share it, and the choices you have. It
        covers people who use the Simplr dashboard, people who contact a property through Simplr&apos;s assistant,
        and visitors to our website.
      </p>

      <h2>1. Our role</h2>
      <p>
        For people who sign up for Simplr and visitors to our website, we decide how their information is used. When
        a renter or resident contacts a property that uses Simplr, we process their information on behalf of that
        property management company, our customer, to provide the service to them. If you contacted a property this
        way, you can also direct privacy requests to that property manager.
      </p>

      <h2>2. Information we collect</h2>
      <h3>Account and team information</h3>
      <ul>
        <li>Your name, email address and profile image, and whether you sign in with a password or with Google.</li>
        <li>The team you belong to, your role (admin or member), and invitations sent to or by you.</li>
        <li>
          Your tour availability settings: whether you take tours (which you or a team admin can switch), your
          working hours and the days you turn off.
        </li>
      </ul>

      <h3>Content our customers add</h3>
      <ul>
        <li>Property details such as the property&apos;s address, unit types, rents, pet policy and move-in windows.</li>
        <li>
          Knowledge base entries, including text extracted from PDF or Word files you upload. The uploaded file
          itself is deleted once its text has been extracted.
        </li>
        <li>
          Screening questions, assistant instructions and settings, tasks, comments and attachments, and staff
          notification phone numbers.
        </li>
      </ul>

      <h3>Information from calls and messages</h3>
      <p>
        When a prospective renter or resident talks to Simplr&apos;s assistant by phone, in the browser, by SMS or on
        WhatsApp, we collect:
      </p>
      <ul>
        <li>Their phone number, name and, if they provide it, email address.</li>
        <li>Text transcripts and summaries of the conversation.</li>
        <li>
          Answers to the property&apos;s screening questions, such as move-in date, budget, number of bedrooms and pets.
        </li>
        <li>Tour requests and bookings, and details and urgency of maintenance issues they report.</li>
      </ul>
      <p>
        We store text transcripts, not audio recordings. Our voice provider processes call audio to run the
        conversation and may retain it under its own terms.
      </p>

      <h3>Website demo</h3>
      <p>
        If you try the demo call on our website, we keep the transcript, any star rating you give and, if you ask
        for a copy of the transcript, your email address. A random identifier is kept in your browser tab&apos;s
        session storage for as long as the tab is open.
      </p>

      <h3>Cookies and technical information</h3>
      <p>
        We use cookies that are strictly necessary for signing in and keeping you signed in. We do not use
        advertising or analytics cookies. Our service providers record standard technical logs, such as IP address
        and browser type, to operate and secure the service.
      </p>

      <h2>3. Google user data</h2>
      <p>
        Simplr lets each team member connect a Google account so that tours can be booked only when they are free
        and added to their calendar. This section describes exactly what we do with information from Google.
      </p>
      <h3>What we access</h3>
      <p>With your permission, when you connect your Google account we access:</p>
      <ul>
        <li>Your Google account email address, to show which account is connected.</li>
        <li>Your calendar&apos;s free/busy information, meaning the times you are busy.</li>
        <li>
          When you open your own calendar in Simplr, the events on your primary Google Calendar for the week you
          are viewing, including their titles and times.
        </li>
        <li>The ability to create, update and delete the tour events that Simplr adds to your calendar.</li>
      </ul>
      <h3>How we use it</h3>
      <ul>
        <li>
          To work out when you can give a tour, together with the working hours and days off you set in Simplr,
          leaving at least 15 minutes between a tour and anything else in your calendar.
        </li>
        <li>To add a tour you are assigned to your Google Calendar, and to update or remove it if it changes.</li>
        <li>
          To show you your own events next to the tours booked for you on Simplr&apos;s calendar page. Only you see
          the titles and details of your events. Your team&apos;s admins can view your calendar in Simplr, where
          your other events appear only as busy times, alongside the tours booked for you.
        </li>
        <li>To show you whether your calendar is connected.</li>
      </ul>
      <h3>How we store it</h3>
      <p>
        We store the access tokens Google gives us, encrypted, so tours can be booked while you are offline. Free/busy
        information and the events shown on the calendar page are read from Google when they are needed and are not
        stored. We store the details of the tours we book, including the Google Calendar event identifier.
      </p>
      <h3>How we share it</h3>
      <p>
        We do not sell Google user data or use it for advertising. We do not use it to develop, improve or train
        artificial intelligence or machine learning models. We only transfer it to others when necessary to provide
        the tour booking feature (for example, to the database provider that hosts Simplr), to comply with the law,
        or as part of a merger or acquisition with notice to you. Your team&apos;s admins can see when you are busy
        and the tours booked for you, but never the titles or details of your other events. The renter who books a
        tour is told its date, time, address and the name of the team member giving it, not anything else from your
        calendar. People at
        Simplr do not read your Google data unless you ask us to, it is needed to investigate security or abuse, or
        the law requires it.
      </p>
      <p>
        Simplr&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>
      <h3>Disconnecting</h3>
      <p>
        You can disconnect your Google account in Simplr at any time, or remove Simplr&apos;s access at{" "}
        <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
          myaccount.google.com/permissions
        </a>
        . When you disconnect, we delete the stored tokens. Tour events already in your calendar stay there unless
        you delete them.
      </p>

      <h2>4. How we use information</h2>
      <ul>
        <li>To provide the service: answering calls and messages, applying the property&apos;s screening rules, booking tours, logging maintenance issues and alerting staff.</li>
        <li>To send messages the service needs, such as tour confirmations, team invitations and demo transcripts.</li>
        <li>To run your account and team, and to provide support when you ask for it.</li>
        <li>To keep the service secure, prevent abuse, and fix problems.</li>
        <li>To meet legal obligations and enforce our <Link href="/terms">Terms of Service</Link>.</li>
      </ul>
      <p>
        Whether a lead meets a property&apos;s criteria is decided by rules the property manager sets, not by the AI
        model. We do not sell personal information.
      </p>

      <h2>5. How we share information</h2>
      <p>We share information only as described here.</p>
      <h3>Service providers</h3>
      <ul>
        <li><strong>Clerk</strong>: sign-in and account management.</li>
        <li><strong>Convex</strong>: database and backend hosting.</li>
        <li><strong>ElevenLabs</strong>: the voice assistant, speech processing, transcription and knowledge base search.</li>
        <li><strong>Google</strong>: Google sign-in, Google Calendar, Google Maps Platform, which suggests and looks up property addresses as you type them, and the Gemini API, which writes SMS and WhatsApp replies.</li>
        <li><strong>Twilio</strong>: sending and receiving SMS.</li>
        <li><strong>Resend</strong>: sending email.</li>
        <li><strong>WhatsApp</strong>: messages sent and received through the property&apos;s linked WhatsApp number.</li>
        <li>Our website hosting provider.</li>
      </ul>
      <p>These providers may only use the information to provide their services to us.</p>
      <h3>Others</h3>
      <ul>
        <li>
          <strong>The property manager.</strong> Conversations, lead details and maintenance issues are shared with the
          property management company the person contacted and the members of its Simplr team.
        </li>
        <li>
          <strong>The renter who books a tour</strong> receives the tour details and the name of the team member giving it.
        </li>
        <li>
          <strong>Legal and safety.</strong> When required by law, or to protect the rights, property or safety of
          Simplr, our customers or others.
        </li>
        <li>
          <strong>Business transfers.</strong> As part of a merger, acquisition or sale of assets, subject to this policy.
        </li>
      </ul>

      <h2>6. SMS messaging</h2>
      <p>
        Mobile phone numbers and SMS consent are not shared with third parties or affiliates for marketing or
        promotional purposes. Message frequency varies. Message and data rates may apply. Reply STOP to opt out.
      </p>

      <h2>7. How long we keep information</h2>
      <p>
        We keep account, team and customer content for as long as the account is active. When an admin deletes their
        account, their team&apos;s data is deleted, including its assistant, property, knowledge base, conversations
        and bookings. When a member&apos;s account is deleted, their account and membership are deleted. We remove
        deleted data from backups on our providers&apos; normal backup cycles, and may keep some information longer
        where the law requires it.
      </p>

      <h2>8. Security</h2>
      <p>
        We use encryption in transit, encrypt stored Google access tokens, and limit access to data to what is needed
        to operate the service. No method of transmission or storage is completely secure, but we work to protect
        your information.
      </p>

      <h2>9. Your rights and choices</h2>
      <p>
        Depending on where you live, you may have the right to access, correct, delete or receive a copy of your
        personal information, or to object to or restrict how it is used. To make a request, email {mail}. If you
        contacted a property through Simplr, you can also ask that property manager. We will respond within the time
        the law requires and will not treat you differently for exercising your rights.
      </p>
      <p>
        California residents: we do not sell personal information or share it for cross-context behavioral
        advertising.
      </p>

      <h2>10. International users</h2>
      <p>
        Simplr&apos;s data is hosted in the United States. If you use it from elsewhere, your information will be
        transferred to and processed in the United States and other countries where we or our service providers
        operate.
      </p>

      <h2>11. Children</h2>
      <p>
        Simplr is intended for adults and is not directed to children. We do not knowingly collect personal
        information from children under 16. If you believe a child has provided us information, contact us and we
        will delete it.
      </p>

      <h2>12. Changes to this policy</h2>
      <p>
        We may update this policy. If we make material changes, we will notify account holders by email or in the
        dashboard before they take effect. The effective date at the top shows when it last changed.
      </p>

      <h2>13. Contact us</h2>
      <p>
        {LEGAL_COMPANY}
        <br />
        Email: {mail}
      </p>
    </LegalPage>
  );
}
