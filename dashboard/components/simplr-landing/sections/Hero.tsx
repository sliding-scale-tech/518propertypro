import Link from "next/link"

export default function Hero() {
  return (
    <section className="hero" id="top">
      <div className="hero-bg">
        <div className="cross cross1">+</div>
        <div className="cross cross2">+</div>
        <div className="cloud cloud1"></div>
        <div className="cloud cloud2"></div>
      </div>
      <div className="hero-inner">
        <h1 className="reveal">Every after hours call you miss is a signed lease you lost</h1>
        <p className="lead reveal delay-1">Answer, qualify, and book around the clock, so no lead goes cold just because it came in out of hours.</p>
        <div className="hero-ctas reveal delay-2">
          <Link href="/sign-in" className="btn btn-outline">Try Demo</Link>
          <a href="#contact" className="btn btn-black">Book a Call</a>
        </div>
      </div>

      <div className="hero-card-wrap reveal delay-3">
        <div className="prompt-bar">
          <div className="prompt-text-row">
            <svg width="14" height="14" viewBox="0 0 24 24"><use href="#ic-star" /></svg>
            <span>Organize all my qualified leads of this week.</span>
          </div>
          <div className="prompt-tags-row">
            <div className="prompt-tags">
              <span className="tag tag-blue"><svg viewBox="0 0 24 24"><use href="#ic-filter" /></svg>Lead Qualifier</span>
              <span className="tag"><svg viewBox="0 0 24 24"><use href="#ic-phone" /></svg>AI Receptionist</span>
              <span className="tag"><svg viewBox="0 0 24 24"><use href="#ic-star" /></svg>Tenant Management</span>
            </div>
            <button className="mic-btn" type="button" aria-label="Voice input"><svg viewBox="0 0 24 24"><use href="#ic-wave" /></svg></button>
          </div>
        </div>

        <div className="activity-card">
          <div className="activity-head">
            {/* h2, not h3 (a11y fix, perf agent): the source jumps h1 -> h3 here with no h2 in
                between (Lighthouse "heading-order" violation). Tag changed only; identical font
                size/weight is restored via a mirrored `.activity-head h2` rule in globals.css
                since site.css's own `.activity-head h3` selector is frozen — zero visual change. */}
            <h2>Live activity</h2>
            <span className="badge-live"><i></i>Updating now</span>
          </div>
          <div className="activity-grid">
            <div className="stat-tile blue"><strong>12</strong><span>new replies</span></div>
            <div className="stat-tile purple text-only"><strong>Appointment</strong><span>booked for today</span></div>
            <div className="stat-tile orange"><strong>20</strong><span>new leads recovered</span></div>
            <div className="stat-tile green"><strong>53</strong><span>leads qualified</span></div>
          </div>
        </div>
      </div>
    </section>
  )
}
