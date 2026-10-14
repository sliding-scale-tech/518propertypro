export default function Process() {
  return (
    <section id="how-it-works" className="process-section">
      <div className="process-bg-parallax" id="processBg"></div>
      <div className="container process-intro">
        <div className="section-head">
          <h2>Go From Call to Live</h2>
          <p>No long onboarding. No contract required to start, most pilots start running within a week.</p>
        </div>
      </div>
      <div className="process-pin-wrapper" id="processPinWrapper">
        <div className="process-sticky" id="processSticky">
          <div className="container">
            <div className="process-grid">
              <div className="p-step-unit" data-step="1">
                <div className="p-step-pin">
                  <div className="p-step" data-step="1">
                    <span className="step-tag">STEP 1</span>
                    <h3>Book a Demo Call</h3>
                    <p>Tell us about your portfolio. We&apos;ll show you exactly what a recovered lead looks like for your properties.</p>
                  </div>
                  <div className="p-step-media" data-panel="1">
                    <div className="p-step-media-inner">
                      <div className="intro-call-card">
                        <span className="ic-badge"><i></i>Ready to book</span>
                        <div className="ic-head">
                          <span className="ic-phone"><svg width="18" height="18" viewBox="0 0 24 24"><use href="#ic-phone"/></svg></span>
                          <strong>Intro Call: Sunridge Portfolio</strong>
                        </div>
                        <p className="ic-desc">Reviewing current leasing pipeline, tools, and biggest gaps.</p>
                        <div className="ic-list">
                          <div className="ic-list-item"><span className="ic-emoji">🏢</span><span>Portfolio size confirmed: <b>240 units</b></span></div>
                          <div className="ic-list-item"><span className="ic-emoji">🧩</span><span>Current tools: <b>Buildium, Google Sheets</b></span></div>
                          <div className="ic-list-item"><span className="ic-emoji">🎯</span><span>Pilot scope: <b>Lead Recovery</b></span></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-step-unit" data-step="2">
                <div className="p-step-pin">
                  <div className="p-step" data-step="2">
                    <span className="step-tag">STEP 2</span>
                    <h3>We Build Your Pilot Agent</h3>
                    <p>No months long setup, we configure and launch a working AI agent trained on your listings and workflows.</p>
                  </div>
                  <div className="p-step-media" data-panel="2">
                    <div className="p-step-media-inner">
                      <div className="robot-wrap">
                        <svg viewBox="0 0 400 280" width="100%">
                          <ellipse cx="200" cy="240" rx="90" ry="14" fill="#c7d5ea"/>
                          <rect x="60" y="120" width="90" height="80" rx="10" fill="#eef1f7" stroke="#dbe2ee" strokeWidth="2"/>
                          <circle cx="80" cy="140" r="4" fill="#9fb3d6"/><circle cx="80" cy="156" r="4" fill="#9fb3d6"/><circle cx="80" cy="172" r="4" fill="#9fb3d6"/>
                          <rect x="95" y="135" width="40" height="6" rx="3" fill="#c9d5ea"/>
                          <rect x="95" y="150" width="30" height="6" rx="3" fill="#c9d5ea"/>
                          <path d="M180 120 Q160 80 200 60" stroke="#8ba3d1" strokeWidth="4" fill="none" strokeLinecap="round"/>
                          <circle cx="200" cy="150" r="55" fill="#3b57d6"/>
                          <circle cx="200" cy="150" r="46" fill="#fff"/>
                          <circle cx="184" cy="146" r="7" fill="#26305c"/>
                          <circle cx="216" cy="146" r="7" fill="#26305c"/>
                          <path d="M186 165 Q200 176 214 165" stroke="#26305c" strokeWidth="4" fill="none" strokeLinecap="round"/>
                          <path d="M148 130 A55 55 0 0 1 252 130" stroke="#2338a8" strokeWidth="10" fill="none" strokeLinecap="round"/>
                          <circle cx="148" cy="132" r="9" fill="#2338a8"/>
                          <circle cx="252" cy="132" r="9" fill="#2338a8"/>
                          <circle cx="200" cy="98" r="5" fill="#2338a8"/>
                          <path d="M255 160 Q300 140 330 110" stroke="#a9bce4" strokeWidth="3" strokeDasharray="4 6" fill="none"/>
                          <path d="M320 95 L345 105 L325 125 Z" fill="#5a78e0"/>
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-step-unit" data-step="3">
                <div className="p-step-pin">
                  <div className="p-step" data-step="3">
                    <span className="step-tag">STEP 3</span>
                    <h3>Watch It Work, Live</h3>
                    <p>Every call, text, and lead shows up in your dashboard from day one, see it working before you commit to anything more.</p>
                  </div>
                  <div className="p-step-media" data-panel="3">
                    <div className="p-step-media-inner">
                      <div className="week-card">
                        <span className="week-badge"><i></i>Live in your dashboard</span>
                        <div className="week-head"><strong>This Week&apos;s Activity</strong><svg width="16" height="16" viewBox="0 0 24 24" style={{color:"#b7bcc7"}}><use href="#ic-chart"/></svg></div>
                        <div className="week-stats">
                          <div><strong>42</strong><span>inquiries answered</span></div>
                          <div><strong className="purple">9</strong><span>tours booked</span></div>
                          <div><strong className="green">0</strong><span>missed calls</span></div>
                        </div>
                        <div className="week-list">
                          <div className="week-list-item"><span>Avg. response time</span><b>38 sec</b></div>
                          <div className="week-list-item"><span>Coverage</span><b>24/7</b></div>
                          <div className="week-list-item"><span>Leads lost</span><b>0</b></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
