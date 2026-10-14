import Link from "next/link"

export default function Impact() {
  return (
    <section className="impact-section">
      <div className="container">
        <div className="section-head">
          <h2 className="reveal">See the impact instantly</h2>
          <p className="reveal delay-1">Create content faster, stay consistent across every channel, and achieve better results with less effort.</p>
        </div>

        <div className="impact-grid reveal">
          <div className="impact-card-left">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <div className="mini-logo"><img src="/simplr-landing/Logo.png" alt="Simplr" /></div>
            <h3>Never let a lead go cold</h3>
            <p>Every call and text gets answered the moment it comes in, day or night.</p>
            <span className="tagline">No more voicemails nobody hears until Monday.</span>
            <Link href="/demo" className="btn btn-black">See It In Action</Link>
          </div>
          <div className="impact-card-right">
            <div className="impact-head">
              <div className="dot-icon purple" data-pattern="diamond"></div>
              <div>
                <h4>Built to Perform</h4>
                <span className="tagline">Every lead, tour, and lease, tracked automatically in your dashboard.</span>
              </div>
            </div>
            <div className="impact-stats">
              <div className="impact-stat">
                <span className="label">RESPONSE TIME</span>
                <span className="big-num" data-count-to="60" data-suffix=" SEC">0 SEC</span>
                <span className="caption">Every inquiry gets answered in under a minute, any hour.</span>
              </div>
              <div className="impact-stat">
                <span className="label">COVERAGE</span>
                <span className="big-num" data-count-to="100" data-suffix="%">0%</span>
                <span className="caption">Every channel, one dashboard</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
