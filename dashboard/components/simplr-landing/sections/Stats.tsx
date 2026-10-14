export default function Stats() {
  return (
    <section className="stats-section">
      <div className="container">
        <div className="section-head">
          <h2 className="reveal">The silence is costing you a property a year</h2>
        </div>

        <div className="stats-row">
          <div className="stat-card reveal">
            <h3>67%</h3>
            <p>of rental inquiries go unanswered within 24 hours.</p>
          </div>
          <div className="stat-card reveal delay-1">
            <h3>73 to 78%</h3>
            <p>of inquiries arrive after business hours, when no one is watching.</p>
          </div>
          <div className="stat-card featured reveal delay-2">
            <h3>21×</h3>
            <p>more likely to convert with a five minute response than a 30 minute response.</p>
          </div>
        </div>

        <div className="timeline-block reveal">
          <h3>Every unanswered minute makes the next call less likely to land.</h3>
          <div className="timeline">
            <div className="tl-item"><span className="dot black"></span>Inquiry lands</div>
            <div className="tl-item"><span className="dot green"></span>5 min · high intent</div>
            <div className="tl-item"><span className="dot orange"></span>30 min · cooling</div>
            <div className="tl-item"><span className="dot red"></span>Next morning · gone</div>
          </div>
          <p className="muted">This isn&apos;t a software failure. Sheets, VAs, and basic property automation weren&apos;t built to orchestrate an immediate, persistent response across every lead source. The gap is the workflow between the inquiry and the first real conversation.</p>
        </div>
      </div>
    </section>
  )
}
