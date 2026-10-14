export default function Cold() {
  return (
    <section className="cold-section">
      <div className="container">
        <div className="section-head">
          <h2 className="reveal">The best leads go cold while you sleep</h2>
          <p className="reveal delay-1">A vacant unit bleeds money. The math is simple and brutal. The damage goes deeper than the P&amp;L statement.</p>
        </div>

        <div className="cold-cards">
          <div className="cold-card reveal">
            <span className="x-icon"><svg width="14" height="14" viewBox="0 0 24 24"><use href="#ic-x" /></svg></span>
            <h3>$140K lost</h3>
            <ul>
              <li>200 unit portfolio loses roughly $140K</li>
              <li>one property manager&apos;s salary, gone</li>
              <li>Lost silently, in the gap between leases no one&apos;s tracking</li>
            </ul>
          </div>
          <div className="cold-card reveal delay-1">
            <span className="x-icon"><svg width="14" height="14" viewBox="0 0 24 24"><use href="#ic-x" /></svg></span>
            <h3>Team burnout</h3>
            <ul>
              <li>Team drowns in reactive triage</li>
              <li>Owners get overwhelmed instead of closing leases</li>
              <li>Lost to exhaustion, not to a better offer.</li>
            </ul>
          </div>
          <div className="cold-card featured reveal delay-2">
            <span className="x-icon"><svg width="14" height="14" viewBox="0 0 24 24"><use href="#ic-x" /></svg></span>
            <h3>Tenant gaps</h3>
            <ul>
              <li>Unorganized maintenance calls get missed</li>
              <li>Identifying damages after they&apos;ve already cost you</li>
              <li>Tenant leaves a review before you even hear about it</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
