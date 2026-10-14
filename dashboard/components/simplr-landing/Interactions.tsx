"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { CONTACT_EMAIL } from "./config"

/**
 * Mount point for the site's shared vanilla-JS behaviours, ported 1:1 from
 * leaseops-landing-page/src/interactions/Interactions.jsx (itself ported from
 * reference/original/index.html lines 1677-1961 and demo.html's shared nav bits). Renders
 * nothing. Only change from the source: react-router's useLocation().pathname -> next/navigation's
 * usePathname().
 *
 * Split into two groups of effects:
 *  - Route-independent: nav scroll-shadow + mobile toggle, same-page smooth anchor scroll.
 *    Navbar is a permanent, never-unmounted component, so these run once on mount via event
 *    delegation, no re-init needed.
 *  - Route-dependent: dot-icon grid builder, reveal-on-scroll, count-up numbers, the two
 *    accordions, the contact form, and the process-section scroll-jacking. These all depend on
 *    DOM nodes owned by whichever page is currently routed (home vs /demo), so they re-run (with
 *    teardown) whenever `pathname` changes, mirroring the source's per-page <script> block.
 */
export default function Interactions() {
  const pathname = usePathname()

  /* ============ NAV: scroll shadow + mobile toggle (route-independent) ============ */
  useEffect(() => {
    const navEl = document.getElementById("nav")
    if (!navEl) return

    const onScroll = () => {
      navEl.classList.toggle("scrolled", window.scrollY > 8)
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    onScroll()

    const navToggle = document.getElementById("navToggle")
    const navLinks = document.getElementById("navLinks")

    const onToggleClick = () => {
      navLinks?.classList.toggle("open")
    }
    navToggle?.addEventListener("click", onToggleClick)

    // Delegate: closing the mobile menu on any nav link click works even though Navbar's
    // links are re-rendered (new <Link> elements) across route changes.
    const onNavLinksClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("a")) navLinks?.classList.remove("open")
    }
    navLinks?.addEventListener("click", onNavLinksClick)

    return () => {
      window.removeEventListener("scroll", onScroll)
      navToggle?.removeEventListener("click", onToggleClick)
      navLinks?.removeEventListener("click", onNavLinksClick)
    }
  }, [])

  /* ============ SMOOTH ANCHOR SCROLL WITH NAV OFFSET (route-independent, delegated) ============ */
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a[href^="#"]')
      if (!a) return
      const id = a.getAttribute("href")!.slice(1)
      const target = document.getElementById(id)
      if (target) {
        e.preventDefault()
        const y = target.getBoundingClientRect().top + window.scrollY - 80
        window.scrollTo({ top: y, behavior: "smooth" })
      }
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [])

  /* ============ DOT-GRID ICON PATTERN (route-dependent, re-scans on new .dot-icon mounts) ============ */
  useEffect(() => {
    // diamond pattern on a 5x5 grid
    const filled = [
      [2, 0],
      [1, 1], [3, 1],
      [0, 2], [2, 2], [4, 2],
      [1, 3], [3, 3],
      [2, 4],
    ]

    const buildOne = (el: HTMLElement) => {
      if (el.dataset.dotBuilt) return
      el.dataset.dotBuilt = "true"
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const isFilled = filled.some((p) => p[0] === c && p[1] === r)
          const i = document.createElement("i")
          if (!isFilled) i.className = "blank"
          el.appendChild(i)
        }
      }
    }

    const buildAll = () => {
      document.querySelectorAll<HTMLElement>(".dot-icon").forEach(buildOne)
    }
    buildAll()

    // Re-scan if more .dot-icon elements mount later on this route (e.g. lazy content).
    const observer = new MutationObserver(() => buildAll())
    observer.observe(document.body, { childList: true, subtree: true })

    return () => observer.disconnect()
  }, [pathname])

  /* ============ REVEAL ON SCROLL (route-dependent) ============ */
  useEffect(() => {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view")
            revealObserver.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" },
    )

    const observeAll = () => {
      document.querySelectorAll(".reveal").forEach((el) => {
        if (!el.classList.contains("in-view")) revealObserver.observe(el)
      })
    }
    observeAll()

    // Re-scan for .reveal elements that mount after the initial pass on this route.
    const mo = new MutationObserver(() => observeAll())
    mo.observe(document.body, { childList: true, subtree: true })

    return () => {
      mo.disconnect()
      revealObserver.disconnect()
    }
  }, [pathname])

  /* ============ COUNT-UP NUMBERS (route-dependent) ============ */
  useEffect(() => {
    function animateCount(el: Element) {
      const to = parseFloat(el.getAttribute("data-count-to")!)
      const suffix = el.getAttribute("data-suffix") || ""
      let start: number | null = null
      const duration = 1400
      function step(ts: number) {
        if (!start) start = ts
        const progress = Math.min((ts - start) / duration, 1)
        const eased = 1 - Math.pow(1 - progress, 3)
        const val = Math.round(eased * to)
        el.textContent = val + suffix
        if (progress < 1) requestAnimationFrame(step)
        else el.textContent = to + suffix
      }
      requestAnimationFrame(step)
    }

    const countObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animateCount(entry.target)
            countObserver.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.5 },
    )

    // Track "already handed to an observer" per effect run (a local Set, not a DOM dataset flag) —
    // a dataset flag would persist on the element across React StrictMode's dev-mode double-invoke
    // (mount -> cleanup -> mount), so the second, actually-live observer would see the flag already
    // set from the first (torn-down) one and skip observing the element entirely, permanently
    // stuck at "0". This bit us in testing: counts never animated. A Set scoped to this effect
    // closure is naturally fresh on every run, matching reveal-on-scroll's safer pattern above
    // (which checks real completion state — the `.in-view` class — instead of an attempt flag).
    const claimed = new WeakSet<Element>()
    const observeAll = () => {
      document.querySelectorAll(".big-num[data-count-to]").forEach((el) => {
        if (!claimed.has(el)) {
          claimed.add(el)
          countObserver.observe(el)
        }
      })
    }
    observeAll()

    const mo = new MutationObserver(() => observeAll())
    mo.observe(document.body, { childList: true, subtree: true })

    return () => {
      mo.disconnect()
      countObserver.disconnect()
    }
  }, [pathname])

  /* ============ ACCORDIONS: "Built for everyone" + FAQ (route-dependent) ============ */
  useEffect(() => {
    const teardowns: Array<() => void> = []

    function wireAccordion(itemSelector: string) {
      document.querySelectorAll(itemSelector).forEach((item) => {
        const header = item.querySelector(":scope > .acc-header, :scope > .faq-header")
        if (!header) return
        const onHeaderClick = () => {
          const wasOpen = item.classList.contains("open")
          document.querySelectorAll(itemSelector).forEach((i) => i.classList.remove("open"))
          if (!wasOpen) item.classList.add("open")
        }
        header.addEventListener("click", onHeaderClick)
        teardowns.push(() => header.removeEventListener("click", onHeaderClick))

        const close = item.querySelector(":scope > .acc-window-body .acc-window-close, :scope .acc-window-close")
        if (close) {
          const onCloseClick = (e: Event) => {
            e.stopPropagation()
            item.classList.remove("open")
          }
          close.addEventListener("click", onCloseClick)
          teardowns.push(() => close.removeEventListener("click", onCloseClick))
        }
      })
    }

    wireAccordion("#accList .acc-item")
    wireAccordion(".faq-item")

    return () => teardowns.forEach((fn) => fn())
  }, [pathname])

  /* ============ CONTACT FORM (route-dependent) ============ */
  useEffect(() => {
    const form = document.getElementById("contactForm") as HTMLFormElement | null
    const note = document.getElementById("contactFormNote")
    if (!form) return
    const submitBtn = form.querySelector<HTMLButtonElement>(".contact-submit")

    const onSubmit = (e: Event) => {
      e.preventDefault()
      const name = ((form.elements.namedItem("name") as HTMLInputElement)?.value || "").trim()
      const email = ((form.elements.namedItem("email") as HTMLInputElement)?.value || "").trim()
      const subject = ((form.elements.namedItem("subject") as HTMLInputElement)?.value || "").trim()
      const message = ((form.elements.namedItem("message") as HTMLTextAreaElement)?.value || "").trim()

      if (!note) return

      if (!name || !email || !subject || !message) {
        note.textContent = "Please fill in all fields."
        note.style.color = "var(--red-text)"
        return
      }

      if (submitBtn) submitBtn.disabled = true
      note.style.color = "var(--ink-soft)"
      note.textContent = "Sending…"

      fetch("https://formsubmit.co/ajax/" + CONTACT_EMAIL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name,
          email,
          _subject: "Simplr contact: " + subject,
          subject,
          message,
          _template: "table",
        }),
      })
        .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
        .then((result) => {
          // FormSubmit.co returns HTTP 200 even when it DIDN'T deliver the message (e.g. the
          // "this form needs activation" case hit in testing) — the real signal is the JSON
          // body's own `success` field, not the HTTP status. Checking only `result.ok` would mean
          // a visitor can be told "message sent" while nothing arrives.
          if (!result.ok || result.data?.success !== "true") {
            throw new Error((result.data && result.data.message) || "Send failed")
          }
          note.style.color = "var(--green-text)"
          note.textContent = "Thanks, your message was sent. We'll get back to you soon."
          form.reset()
        })
        .catch(() => {
          // Fallback: open the visitor's mail client addressed to the Simplr inbox
          const body = "Name: " + name + "\nEmail: " + email + "\n\n" + message
          const mailto =
            "mailto:" + CONTACT_EMAIL + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body)
          note.style.color = "var(--ink-soft)"
          note.textContent = "Opening your email client…"
          window.location.href = mailto
        })
        .finally(() => {
          if (submitBtn) submitBtn.disabled = false
        })
    }

    form.addEventListener("submit", onSubmit)
    return () => form.removeEventListener("submit", onSubmit)
  }, [pathname])

  /* ============ PROCESS SECTION: scroll-jacked steps + parallax (route-dependent) ============ */
  useEffect(() => {
    const steps = document.querySelectorAll<HTMLElement>(".p-step")
    const mediaPanels = document.querySelectorAll<HTMLElement>(".p-step-media")
    const stepUnits = document.querySelectorAll<HTMLElement>(".p-step-unit")
    if (!steps.length) return

    let currentStep = 0
    let processManualUntil = 0

    function setActiveStep(n: number) {
      n = Number(n)
      if (n === currentStep) return
      currentStep = n
      steps.forEach((s) => s.classList.toggle("active", Number(s.getAttribute("data-step")) === n))
      mediaPanels.forEach((p) => p.classList.toggle("active", Number(p.getAttribute("data-panel")) === n))
      stepUnits.forEach((u) => {
        const on = Number(u.getAttribute("data-step")) === n
        u.classList.toggle("active", on)
        const pin = u.querySelector(".p-step-pin")
        if (pin) pin.classList.toggle("is-active", on)
      })
    }
    setActiveStep(1)

    const stepClickTeardowns: Array<() => void> = []
    steps.forEach((step) => {
      step.style.cursor = "pointer"
      const onClick = () => {
        setActiveStep(Number(step.getAttribute("data-step")))
        processManualUntil = Date.now() + 1800
      }
      step.addEventListener("click", onClick)
      stepClickTeardowns.push(() => step.removeEventListener("click", onClick))
    })

    // setupProcessPin
    const wrapper = document.getElementById("processPinWrapper")
    const sticky = document.getElementById("processSticky")
    const bg = document.getElementById("processBg")
    const navEl = document.getElementById("nav")

    let cleanupPin = () => {}
    if (wrapper && sticky && bg) {
      const mq = window.matchMedia("(max-width:900px)")

      function layout() {
        if (mq.matches) {
          sticky!.style.top = ""
          return
        }
        sticky!.style.top = (navEl ? navEl.offsetHeight : 80) + "px"
      }
      layout()
      window.addEventListener("resize", layout)

      function updateDesktop() {
        if (Date.now() < processManualUntil) return

        const navH = navEl ? navEl.offsetHeight : 80
        const rect = wrapper!.getBoundingClientRect()
        const stickyH = sticky!.offsetHeight
        const denom = wrapper!.offsetHeight - stickyH
        const scrolledIntoPin = navH - rect.top
        let progress = denom > 0 ? scrolledIntoPin / denom : 0
        progress = Math.max(0, Math.min(1, progress))

        bg!.style.transform = "translateY(" + progress * -16 + "%)"

        let step = 1
        if (progress >= 0.667) step = 3
        else if (progress >= 0.333) step = 2
        setActiveStep(step)
      }

      function updateMobile() {
        bg!.style.transform = "translateY(0)"
        if (Date.now() < processManualUntil) return
        if (!stepUnits.length) return

        const navH = navEl ? navEl.offsetHeight : 80
        const probe = navH + Math.min(140, window.innerHeight * 0.22)
        let best = Number(stepUnits[0].getAttribute("data-step")) || 1

        stepUnits.forEach((unit) => {
          const rect = unit.getBoundingClientRect()
          if (rect.top <= probe && rect.bottom > probe + 40) {
            best = Number(unit.getAttribute("data-step"))
          }
        })

        // If past the last unit, keep last step active
        const last = stepUnits[stepUnits.length - 1]
        if (last) {
          const lastRect = last.getBoundingClientRect()
          if (lastRect.top <= probe) best = Number(last.getAttribute("data-step"))
        }

        setActiveStep(best)
      }

      function update() {
        if (mq.matches) updateMobile()
        else updateDesktop()
      }

      let ticking = false
      function onScroll() {
        if (!ticking) {
          requestAnimationFrame(() => {
            update()
            ticking = false
          })
          ticking = true
        }
      }
      window.addEventListener("scroll", onScroll, { passive: true })
      window.addEventListener("resize", onScroll)
      update()

      cleanupPin = () => {
        window.removeEventListener("resize", layout)
        window.removeEventListener("scroll", onScroll)
        window.removeEventListener("resize", onScroll)
      }
    }

    return () => {
      stepClickTeardowns.forEach((fn) => fn())
      cleanupPin()
    }
  }, [pathname])

  return null
}
