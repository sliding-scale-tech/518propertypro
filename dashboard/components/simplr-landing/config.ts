// Shared content for the simplr.pro marketing site (nav sections, contact email). Ported from
// leaseops-landing-page/src/config/site.js — ROUTES and EXTERNAL are dropped here since this now
// lives inside the same Next app as /sign-in and /sign-up, so those become plain relative links
// instead of a separate site's URLs.

// In-page anchors on the home page.
export const SECTIONS = [
  { label: "Features", id: "features" },
  { label: "How it works", id: "how-it-works" },
  { label: "Contact Us", id: "contact" },
] as const

export const CONTACT_EMAIL = "Faarid@slidingscale.xyz"
