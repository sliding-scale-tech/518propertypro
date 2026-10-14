"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { SECTIONS } from "./config"

/**
 * Site nav. Markup mirrors leaseops-landing-page's Navbar.jsx 1:1 so the global stylesheet
 * applies unchanged. Ported from react-router's <Link>/useLocation to next/link and
 * usePathname. Sign In / Sign Up now point at this same app's /sign-in and /sign-up (they used
 * to be an external https://www.simplr.pro/... link back when this was a separate deployment —
 * see PORTING_RULES.md's original Navbar.jsx for that history).
 *
 * SECTIONS are in-page anchors on the home page; from any other route (/demo) they need to
 * navigate back to "/" first, so every link goes through next/link to "/#id".
 * Scroll-shadow + mobile toggle + smooth-anchor-scroll behaviour lives in ./Interactions — this
 * component only renders the markup it attaches to.
 */
export default function Navbar() {
  const onDemo = usePathname() === "/demo"

  return (
    <header className={onDemo ? "nav nav--demo" : "nav"} id="nav">
      <div className="nav-inner">
        <Link href="/#top" className="logo" aria-label="Simplr home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/simplr-landing/Logo.png" alt="Simplr" />
        </Link>
        <nav className="nav-links" id="navLinks">
          {SECTIONS.map((s) => (
            <Link key={s.id} href={`/#${s.id}`}>
              {s.label}
            </Link>
          ))}
        </nav>
        <div className="nav-actions">
          <Link href="/sign-in" className="btn btn-outline btn-sm">
            Sign In
          </Link>
          <Link href="/sign-up" className="btn btn-black btn-sm">
            Sign Up
          </Link>
          <button className="nav-toggle" id="navToggle" type="button" aria-label="Toggle menu">
            <span></span>
          </button>
        </div>
      </div>
    </header>
  )
}
