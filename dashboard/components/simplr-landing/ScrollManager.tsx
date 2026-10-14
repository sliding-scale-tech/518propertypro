"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"

const MAX_MS = 3000
const POLL_MS = 50

/**
 * On a route or hash change: scroll to the #hash target (e.g. a cross-page nav link back to
 * "/#features") once it exists in the DOM, offset by the fixed nav's height, or to the top when
 * there's no hash.
 *
 * Ported from leaseops-landing-page's ScrollManager.jsx, which read {pathname, hash} off
 * react-router's useLocation(). Next's usePathname() has no hash equivalent (hash is never part
 * of the App Router's route state), so this reads window.location.hash directly and also listens
 * for hashchange — clicking a same-page "/#id" link while already on "/" changes the hash without
 * a pathname change, which the pathname-only effect below would otherwise miss.
 */
export default function ScrollManager() {
  const pathname = usePathname()

  useEffect(() => {
    function scrollToHash() {
      const hash = window.location.hash
      if (!hash) {
        window.scrollTo(0, 0)
        return
      }
      const id = hash.slice(1)
      let elapsed = 0
      const timer = setInterval(() => {
        const el = document.getElementById(id)
        if (el) {
          const nav = document.getElementById("nav")
          const offset = nav ? nav.offsetHeight : 80
          window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset })
          clearInterval(timer)
          return
        }
        elapsed += POLL_MS
        if (elapsed >= MAX_MS) clearInterval(timer)
      }, POLL_MS)
      return () => clearInterval(timer)
    }

    const cleanup = scrollToHash()
    window.addEventListener("hashchange", scrollToHash)
    return () => {
      cleanup?.()
      window.removeEventListener("hashchange", scrollToHash)
    }
  }, [pathname])

  return null
}
