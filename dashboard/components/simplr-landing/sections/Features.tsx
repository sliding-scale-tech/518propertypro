export default function Features() {
  return (
    <section id="features" className="cards4-section">
      <div className="container">
        <div className="section-head">
          <h2 className="reveal">Everything you need, and better</h2>
          <p className="reveal delay-1">Recover the leads you are losing today. The rest comes when you are ready.</p>
        </div>

        <div className="cards4">
          <div className="feature-card reveal">
            <div className="dot-icon black" data-pattern="diamond"></div>
            <h3>Lead Recovery</h3>
            <p>24/7 voice receptionist, sub 60 second SMS response, lead scoring, and AI powered tour scheduling.</p>
            <span className="tagline">Score lead while you sleep</span>
          </div>
          <div className="feature-card reveal delay-1">
            <div className="dot-icon green" data-pattern="diamond"></div>
            <h3>Tenant Operations</h3>
            <p>Maintenance triage and vendor coordination to stop the 5 PM Friday panic.</p>
            <span className="tagline">No more hidden damages</span>
          </div>
          <div className="feature-card reveal delay-2">
            <div className="dot-icon orange" data-pattern="diamond"></div>
            <h3>Lead Qualification</h3>
            <p>Score every inquiry in real time, so your team only chases the leads ready to tour.</p>
            <span className="tagline">Secure potential leads</span>
          </div>
          <div className="feature-card reveal delay-3">
            <div className="dot-icon purple" data-pattern="diamond"></div>
            <h3>Revenue Optimization</h3>
            <p>Dynamic pricing, renewal automation, and owner ready reporting on autopilot.</p>
            <span className="tagline">Streamline the process</span>
          </div>
        </div>
      </div>
    </section>
  )
}
