const FAQ_ITEMS = [
  {
    id: '1',
    open: true,
    question: 'What is Simplr?',
    answer:
      "Simplr is a done for you leasing operations service for residential property management companies, not software you have to run yourself. We answer, qualify, and schedule tours for every rental inquiry around the clock, with a live dashboard so you always see exactly what's happening with every lead.",
  },
  {
    id: '2',
    open: false,
    question: 'Are there any hidden setup or installation fees?',
    answer:
      'No. Setup pricing is a flat, one time fee agreed before we start, and monthly pricing is per unit. There are no surprise installation or integration charges added later.',
  },
  {
    id: '3',
    open: false,
    question: 'Is there a long term contract?',
    answer:
      'No long term contract is required to start. Most engagements begin as a short pilot on one package, so you see a working agent live in your dashboard before committing to anything further.',
  },
  {
    id: '4',
    open: false,
    question: 'How do I see what the AI is actually doing with my leads?',
    answer:
      'Every call, text, and inquiry shows up in your live dashboard as it happens, tracked from first contact through tour booked. You can see response times, conversation transcripts, and lead status at every stage without asking anyone for an update.',
  },
  {
    id: '5',
    open: false,
    question: 'Will this replace my leasing team?',
    answer:
      "No. It replaces the phones and inbox coverage your team can't physically maintain 24/7, so your leasing team spends their time running the tours and closing leases that are actually ready, instead of chasing every inquiry.",
  },
  {
    id: '6',
    open: false,
    question: 'What are the next steps if we want to move forward?',
    answer:
      "Book a demo call and tell us about your portfolio. We'll walk through what a recovered lead looks like for your properties, then configure and launch a working pilot agent, most start running within a week.",
  },
]

function FaqItem({ item }: { item: (typeof FAQ_ITEMS)[number] }) {
  return (
    <div className={`faq-item${item.open ? ' open' : ''}`} data-faq={item.id}>
      <button className="faq-header" type="button">
        {/* h3, not h4 (a11y fix, perf agent): the section heading above is an h2 ("Everything you
            need to know"), so FAQ questions at h4 skip a level (Lighthouse "heading-order"
            violation). Tag changed only; identical styling is restored via a mirrored
            `.faq-header h3` rule (base + 900px breakpoint) in globals.css since site.css's own
            `.faq-header h4` selectors are frozen — zero visual change. */}
        <h3>{item.question}</h3>
        <span className="faq-toggle">
          <svg viewBox="0 0 24 24">
            <use href="#ic-plus" />
          </svg>
        </span>
      </button>
      <div className="faq-panel">
        <div className="faq-panel-inner">
          <p>{item.answer}</p>
        </div>
      </div>
    </div>
  )
}

export default function Faq() {
  const col1 = FAQ_ITEMS.slice(0, 3)
  const col2 = FAQ_ITEMS.slice(3, 6)

  return (
    <section className="faq-section">
      <div className="container">
        <div className="section-head">
          <h2 className="reveal">Everything you need to know</h2>
          <p className="reveal delay-1">
            Whether you&apos;re creating content solo or collaborating with a team, there&apos;s a plan designed for your workflow.
          </p>
        </div>

        <div className="faq-grid reveal">
          <div className="faq-col">
            {col1.map((item) => (
              <FaqItem key={item.id} item={item} />
            ))}
          </div>

          <div className="faq-col">
            {col2.map((item) => (
              <FaqItem key={item.id} item={item} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
