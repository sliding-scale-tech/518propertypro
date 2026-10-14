import { CONTACT_EMAIL } from "../config"

const CTA_FLOATS = [
  { top: '-18px', left: '38%', color: '#e0b34d', animationDelay: '.3s' },
  { top: '28px', left: '4%', color: '#7fbf8e', animationDelay: '0s' },
  { top: '18px', right: '2%', color: '#a99bd6', animationDelay: '.6s' },
  { bottom: '-6px', left: '10%', color: '#a99bd6', animationDelay: '.9s' },
  { bottom: '-16px', right: '12%', color: '#7fbf8e', animationDelay: '.4s' },
]

export default function Contact() {
  return (
    <section id="contact" className="contact-section">
      <div className="contact-clouds" aria-hidden="true">
        <span className="c1"></span>
        <span className="c2"></span>
        <span className="c3"></span>
      </div>
      <span className="contact-cross x1" aria-hidden="true">+</span>
      <span className="contact-cross x2" aria-hidden="true">+</span>
      <div className="container">
        <div className="section-head">
          {CTA_FLOATS.map((style, i) => (
            <div className="cta-float" style={style} key={i}>
              <svg viewBox="0 0 24 24">
                <use href="#ic-logo" />
              </svg>
            </div>
          ))}
          <h2 className="reveal">
            Your next lead is coming in right now.
            <br />
            Who&apos;s answering it?
          </h2>
          <p className="reveal delay-1">Book a demo call. See a working pilot agent live in your dashboard within a week.</p>
        </div>

        <div className="contact-shell reveal delay-2">
          <div className="contact-card">
            <div className="contact-copy">
              <h3>Tell us what you&apos;re building</h3>
              <p>
                Share a few details and the Simplr team will point you toward the fastest way to recover leads, qualify
                renters, and book more tours.
              </p>
              <div className="contact-email-block">
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              </div>
            </div>

            <form className="contact-form" id="contactForm" noValidate>
              <div className="contact-field">
                <label htmlFor="contactName">Full Name</label>
                <input id="contactName" name="name" type="text" placeholder="Jane Smith" autoComplete="name" required />
              </div>
              <div className="contact-field">
                <label htmlFor="contactEmail">Email Address</label>
                <input id="contactEmail" name="email" type="email" placeholder="jane@email.com" autoComplete="email" required />
              </div>
              <div className="contact-field">
                <label htmlFor="contactSubject">Subject</label>
                <input id="contactSubject" name="subject" type="text" placeholder="How can we help?" required />
              </div>
              <div className="contact-field">
                <label htmlFor="contactMessage">Message</label>
                <textarea id="contactMessage" name="message" placeholder="Tell us a little about what you need..." required></textarea>
              </div>
              <button className="contact-submit" type="submit">
                Submit
              </button>
              <div className="contact-form-note" id="contactFormNote" aria-live="polite"></div>
            </form>
          </div>
        </div>
      </div>
    </section>
  )
}
