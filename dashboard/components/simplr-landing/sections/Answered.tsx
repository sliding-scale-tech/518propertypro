export default function Answered() {
  return (
    <section className="answered-section">
      <div className="container">
        <div className="section-head">
          <h2 className="reveal">From Answered to Booked</h2>
          <p className="reveal delay-1">Answering fast gets a lead&apos;s attention. These two workflows are what turn that into a tour on the calendar, and a system that&apos;s worth keeping.</p>
        </div>

        <div className="answered-row reveal">
          <div className="answered-text">
            <div className="dot-icon blue" data-pattern="diamond"></div>
            <h3>AI Powered Tour Scheduling</h3>
            <p>The moment a lead qualifies, the tour gets booked and confirmed by text, no back and forth, no cooling off overnight.</p>
            <span className="tagline">Instant Booking | Text Confirmation | Calendar Synced</span>
          </div>
          <div className="answered-visual">
            <div className="mock-card">
              <div className="mock-row head">
                <span className="ic"><svg width="18" height="18" viewBox="0 0 24 24"><use href="#ic-cal"/></svg></span>
                <div><strong>Tour Booked</strong><span>42 Oakwood Ave, Saturday, 2:00 PM</span></div>
              </div>
              <div className="mock-row">
                <span className="ic"><svg width="18" height="18" viewBox="0 0 24 24"><use href="#ic-home"/></svg></span>
                <div><strong>Saturday, 2:00 PM</strong><span>42 Oakwood Ave</span></div>
              </div>
              <div className="mock-list">
                <div className="mock-list-item"><span>Confirmation texted</span><b className="blue">Instant</b></div>
                <div className="mock-list-item"><span>Reminder scheduled</span><b className="purple">1 hour prior</b></div>
                <div className="mock-list-item"><span>Lead status</span><b className="green">Tour Confirmed</b></div>
              </div>
            </div>
          </div>
        </div>

        <div className="answered-row reverse reveal">
          <div className="answered-visual">
            <div className="mock-card inbox">
              <div className="mock-inbox-head">
                <span className="ic"><svg width="16" height="16" viewBox="0 0 24 24"><use href="#ic-chat"/></svg></span>
                <div className="grow"><strong>Today&apos;s Inbox</strong><span>42 leads across 6 platforms in the last 24 hours</span></div>
                <svg width="15" height="15" viewBox="0 0 24 24" style={{color:"#b7bcc7"}}><use href="#ic-filter"/></svg>
              </div>
              <div className="mock-sources">
                <span>Rent.ca</span><span>RF</span><span>Kijiji</span><span>FB</span><span>Zillow</span><span>Web</span>
              </div>
              <div className="mock-list">
                <div className="mock-list-item"><span>Duplicates removed</span><b>7</b></div>
                <div className="mock-list-item"><span>Top match</span><b className="green">2BR, $1,550 budget</b></div>
                <div className="mock-list-item"><span>Follow up status</span><b className="purple">In progress</b></div>
              </div>
            </div>
          </div>
          <div className="answered-text">
            <div className="dot-icon purple" data-pattern="diamond"></div>
            <h3>Multi Channel Lead Aggregation</h3>
            <p>Every lead from Rentals.ca, RentFaster, Kijiji, Facebook Marketplace, Zillow, and your own site, deduped, ranked, and tracked in one place.</p>
            <span className="tagline">Deduplicated | Auto Ranked</span>
          </div>
        </div>
      </div>
    </section>
  )
}
