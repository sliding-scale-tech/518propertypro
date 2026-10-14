import type { ReactNode } from "react"
import Navbar from "@/components/simplr-landing/Navbar"
import ScrollManager from "@/components/simplr-landing/ScrollManager"
import Interactions from "@/components/simplr-landing/Interactions"
import "@/components/simplr-landing/styles/site.css"
import "@/components/simplr-landing/styles/demo.css"
import "@/components/simplr-landing/styles/globals.css"

/**
 * Wraps both routes of the simplr.pro marketing site (this page + /simplr-landing/demo). Mirrors
 * leaseops-landing-page's App.jsx, which mounted Navbar/ScrollManager/Interactions once, outside
 * react-router's <Routes>, so they persist (not remount) across the "/" <-> "/demo" navigation —
 * a Next nested layout is the direct equivalent of that "outside Routes" placement.
 *
 * The stylesheets are imported here (nested layout, not the root layout) so they only ship to
 * visitors on one of these two routes — same pattern @/components/landing/landing-page.tsx
 * already uses for landing.css. That alone does NOT stop them affecting other routes once
 * loaded, though: confirmed in testing, Next keeps this layout's <link> attached after a
 * client-side navigation away from it (e.g. clicking Sign In), so a bare `body{background:...}`
 * in site.css visibly bled onto /sign-in. The real fix is the .simplr-landing-root wrapper below
 * — site.css's own reset rules are scoped under that class instead of bare tag selectors, so
 * they can't apply outside this subtree regardless of when the stylesheet unloads.
 *
 * Reached at the public "/" and "/demo" paths on simplr.pro via a host-based rewrite in
 * proxy.ts; sarah.simplr.pro's "/" keeps rendering the existing root page unchanged.
 */
export default function SimplrLandingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="simplr-landing-root">
      <ScrollManager />
      <Interactions />
      <Navbar />
      {children}
    </div>
  )
}
