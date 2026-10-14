const ACC_ITEMS = [
  {
    step: '1',
    num: '001',
    title: 'For Owners/President',
    winLabel: 'FOR OWNERS/PRESIDENT',
    text: "You're already wearing the ops hat because the company's too lean for a dedicated layer. This covers your leasing pipeline without pulling you further into the weeds.",
  },
  {
    step: '2',
    num: '002',
    title: 'For Project Managers',
    winLabel: 'FOR PROJECT MANAGERS',
    text: 'You were hired to keep the machine running. This adds 24/7 coverage and a real dashboard for owner reporting, without adding headcount.',
  },
  {
    step: '3',
    num: '003',
    title: 'For Leasing Managers/Team',
    winLabel: 'FOR LEASING MANAGERS/TEAM',
    text: "A 1 to 3 person team can't cover phones after hours. This catches every after hours lead, qualifies it, and books the tour, so your team only handles showings that are actually ready.",
  },
]

export default function Everyone() {
  return (
    <section id="everyone" className="everyone-section">
      <div className="container">
        <div className="section-head">
          <h2 className="reveal">Built for everyone</h2>
          <p className="reveal delay-1">Whether you&apos;re the management company owner, project manager or just a member in the lease management team, manage freely without any hassle.</p>
        </div>

        <div className="acc-list reveal" id="accList">
          {ACC_ITEMS.map((item) => (
            <div className="acc-item" data-acc={item.step} key={item.step}>
              <button className="acc-header" type="button">
                <span className="acc-num">{item.num}</span>
                <h3>{item.title}</h3>
                <span className="acc-plus"><svg viewBox="0 0 24 24"><use href="#ic-plus"/></svg></span>
              </button>
              <div className="acc-panel">
                <div className="acc-panel-inner">
                  <div className="acc-window">
                    <div className="acc-window-bar">
                      <span className="traffic"><span></span><span></span><span></span></span>
                      <span className="win-label">{item.winLabel}</span>
                    </div>
                    <div className="acc-window-body">
                      <span className="acc-window-num">{item.num}</span>
                      <div className="acc-window-icon"><div className="dot-icon purple" data-pattern="diamond" style={{margin:0}}></div></div>
                      <div className="acc-window-text">
                        <h4>{item.title}</h4>
                        <p>{item.text}</p>
                      </div>
                      <button className="acc-window-close" type="button" aria-label={`Close ${item.title}`}><svg viewBox="0 0 24 24"><use href="#ic-plus"/></svg></button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
