"use client"

import { useEffect, useRef } from "react"

// Ported 1:1 from leaseops-landing-page/src/pages/Demo.jsx (itself ported from
// reference/original/demo.html lines 438-691), minus the page's own <header class="nav">
// (redundant with the shared Navbar mounted in app/simplr-landing/layout.tsx) and minus the
// manual `document.title` effect the Vite SPA needed — Next sets the title server-side via
// app/simplr-landing/demo/page.tsx's metadata export instead.

// Audio files live in public/simplr-landing/audio/.
const AUDIO_BASE_PATH = "/simplr-landing/audio/"

// Each line: speaker, text, audio filename, optional checklist key it satisfies.
const SCRIPT = [
  { speaker: 'ai', text: 'Thanks for calling Parkview Apartments, this is the leasing assistant. How can I help you today?', file: '01.mp3' },
  { speaker: 'caller', text: 'Hey, um, I saw the two bedroom listing online, is it still available?', file: '02tenant.mp3', check: 'unit' },
  { speaker: 'ai', text: "It is. Happy to help you check it out. Can I grab a couple quick details first? What's your ideal move in date?", file: '03ai.mp3' },
  { speaker: 'caller', text: 'Probably early next month, maybe the first or so.', file: '04tenant.mp3', check: 'movein' },
  { speaker: 'ai', text: "Got it. And what's your budget range for monthly rent?", file: '05ai.mp3' },
  { speaker: 'caller', text: "Around sixteen hundred, maybe a bit more if it's nice.", file: '06tenant.mp3', check: 'budget' },
  { speaker: 'ai', text: 'That works for our two bedrooms. Last thing: any pets?', file: '07ai.mp3' },
  { speaker: 'caller', text: "Yeah, I've got a small dog.", file: '08tenant.mp3', check: 'pets' },
  { speaker: 'ai', text: "No problem, this building's pet friendly. Can I get your name and a callback number, just in case we get cut off?", file: '09ai.mp3' },
  { speaker: 'caller', text: "Sure, it's Sarah, and it's five five five, oh one four two.", file: '10tenant.mp3', check: 'contact' },
  { speaker: 'ai', text: "Perfect, Sarah. That unit fits your budget, your timeline, and the building takes pets, so let's get you in to see it. Does Thursday afternoon work for a tour?", file: '11ai.mp3' },
  { speaker: 'caller', text: 'Yeah, that could work.', file: '12tenant.mp3' },
  { speaker: 'ai', text: "Great, I've got you down for Thursday at 3 PM, and I'm sending a text confirmation right now. Anything else I can help with?", file: '13ai.mp3', check: 'tour' },
  { speaker: 'caller', text: "No, that's it. Thanks!", file: '14tenant.mp3' },
  { speaker: 'ai', text: 'Of course. Talk soon.', file: '15ai.mp3' },
] as const

const CHECKLIST_ITEMS = [
  { key: 'unit', label: 'Unit type' },
  { key: 'movein', label: 'Move in date' },
  { key: 'budget', label: 'Budget range' },
  { key: 'pets', label: 'Pet policy' },
  { key: 'contact', label: 'Contact info' },
  { key: 'tour', label: 'Tour booked' },
] as const

const BAR_COUNT = 24

export default function DemoWidget() {
  const transcriptRef = useRef<HTMLDivElement>(null)
  const checklistRefs = useRef<Record<string, HTMLDivElement>>({})
  const barsRef = useRef<HTMLDivElement[]>([])
  const timerRef = useRef<HTMLDivElement>(null)
  const statusTextRef = useRef<HTMLSpanElement>(null)
  const dotRef = useRef<HTMLSpanElement>(null)
  const startBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const transcriptEl = transcriptRef.current
    const timerEl = timerRef.current
    const statusTextEl = statusTextRef.current
    const dotEl = dotRef.current
    const startBtn = startBtnRef.current
    const bars = barsRef.current
    if (!transcriptEl || !timerEl || !statusTextEl || !dotEl || !startBtn) return

    let waveInterval: ReturnType<typeof setInterval> | undefined
    function startWave() {
      waveInterval = setInterval(() => {
        bars.forEach((b) => {
          const h = 6 + Math.random() * 36
          b.style.height = h + 'px'
          b.classList.add('active')
        })
      }, 120)
    }
    function stopWave() {
      clearInterval(waveInterval)
      bars.forEach((b) => {
        b.style.height = '6px'
        b.classList.remove('active')
      })
    }

    let seconds = 0
    let timerInterval: ReturnType<typeof setInterval> | undefined
    function startTimer() {
      timerInterval = setInterval(() => {
        seconds++
        const m = Math.floor(seconds / 60)
        const s = String(seconds % 60).padStart(2, '0')
        timerEl!.textContent = m + ':' + s
      }, 1000)
    }

    function estimateDurationMs(text: string) {
      // rough fallback pacing if audio file isn't available yet: ~2.7 words/sec
      const words = text.split(/\s+/).length
      return Math.max(900, (words / 2.7) * 1000)
    }

    function playLine(index: number) {
      if (index >= SCRIPT.length) {
        finishCall()
        return
      }
      const line = SCRIPT[index]

      // reveal transcript line
      const lineEl = document.createElement('div')
      lineEl.className = 'cdw-line ' + line.speaker
      lineEl.innerHTML =
        '<div class="cdw-speaker">' +
        (line.speaker === 'ai' ? 'AI receptionist' : 'Caller') +
        '</div>' +
        line.text
      transcriptEl!.appendChild(lineEl)
      requestAnimationFrame(() => lineEl.classList.add('show'))
      transcriptEl!.scrollTop = transcriptEl!.scrollHeight

      // tick checklist if this line satisfies one
      if ('check' in line && line.check) {
        const checkEl = checklistRefs.current[line.check]
        if (checkEl) checkEl.classList.add('done')
      }

      startWave()

      const audio = new Audio(AUDIO_BASE_PATH + line.file)
      let advanced = false
      const advance = () => {
        if (advanced) return
        advanced = true
        stopWave()
        playLine(index + 1)
      }

      audio.addEventListener('ended', advance)
      audio.addEventListener('error', () => {
        // fallback: audio file missing/not ready, use estimated timing instead
        setTimeout(advance, estimateDurationMs(line.text))
      })

      audio.play().catch(() => {
        // autoplay blocked or file missing, fallback to estimated timing
        setTimeout(advance, estimateDurationMs(line.text))
      })
    }

    function finishCall() {
      stopWave()
      clearInterval(timerInterval)
      dotEl!.classList.remove('live')
      statusTextEl!.textContent = 'Call ended'
      startBtn!.disabled = false
      startBtn!.innerHTML = '▶ Watch it again'
    }

    function handleStart() {
      transcriptEl!.innerHTML = ''
      CHECKLIST_ITEMS.forEach((item) => {
        checklistRefs.current[item.key]?.classList.remove('done')
      })
      seconds = 0
      timerEl!.textContent = '0:00'
      dotEl!.classList.add('live')
      statusTextEl!.textContent = 'Live'
      startBtn!.disabled = true
      startBtn!.innerHTML = '▶ Playing…'
      clearInterval(timerInterval)
      startTimer()
      playLine(0)
    }

    startBtn.addEventListener('click', handleStart)

    return () => {
      startBtn.removeEventListener('click', handleStart)
      clearInterval(waveInterval)
      clearInterval(timerInterval)
    }
  }, [])

  return (
    <div className="demo-page">
    <div className="page-shell">
      <div className="demo-bg" aria-hidden="true">
        <div className="cross cross1">+</div>
        <div className="cross cross2">+</div>
        <div className="cloud cloud1"></div>
        <div className="cloud cloud2"></div>
      </div>

      <main className="hero" id="demo">
        <div className="eyebrow">
          <span className="eyebrow-dot"></span> Live after hours leasing demo
        </div>
        <h1>Watch Simplr answer a renter call</h1>
        <p className="hero-copy">
          A calm, realistic walkthrough of how Simplr answers, qualifies, and books a tour while
          your leasing team is offline.
        </p>
        <div className="cdw-controls hero-controls">
          <button className="cdw-start-btn" id="cdwStartBtn" type="button" ref={startBtnRef}>
            ▶ Watch it answer a call
          </button>
        </div>

        <div className="demo-stage">
          <div className="call-demo-widget">
            <div className="cdw-header">
              <div className="cdw-header-left">
                <div className="cdw-phone-icon">📞</div>
                <div>
                  <div className="cdw-title">Parkview Apartments</div>
                  <div className="cdw-subtitle">Incoming call · 2:13 AM</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div className="cdw-status">
                  <span className="cdw-dot" id="cdwDot" ref={dotRef}></span>
                  <span id="cdwStatusText" ref={statusTextRef}>
                    Ready
                  </span>
                </div>
                <div className="cdw-timer" id="cdwTimer" ref={timerRef}>
                  0:00
                </div>
              </div>
            </div>

            <div className="cdw-waveform" id="cdwWaveform">
              {Array.from({ length: BAR_COUNT }).map((_, i) => (
                <div
                  key={i}
                  className="cdw-bar"
                  ref={(el) => {
                    if (el) barsRef.current[i] = el
                  }}
                ></div>
              ))}
            </div>

            <div className="cdw-body">
              <div className="cdw-transcript" id="cdwTranscript" ref={transcriptRef}>
                <div className="empty-state">
                  <strong>Ready to answer the next call</strong>
                  Press play to hear Simplr qualify the renter, capture the details, and book the
                  tour.
                </div>
              </div>
              <div className="cdw-checklist">
                {/* h2, not h4 (a11y fix, perf agent): follows the page's h1 directly, so h4 skips
                    two levels (Lighthouse "heading-order"). Tag only — identical styling is
                    restored via a mirrored `.cdw-checklist h2` rule in globals.css since demo.css's
                    own `.cdw-checklist h4` rule is frozen. Markup-only change, nothing touched in
                    the audio-widget's playback/DOM-ref logic below. */}
                <h2>Qualification</h2>
                <div id="cdwChecklist">
                  {CHECKLIST_ITEMS.map((item) => (
                    <div
                      className="cdw-check-item"
                      id={`check-${item.key}`}
                      key={item.key}
                      ref={(el) => {
                        if (el) checklistRefs.current[item.key] = el
                      }}
                    >
                      <span className="cdw-check-circle">✓</span>
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
    </div>
  )
}
