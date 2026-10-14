import Link from "next/link";

/**
 * The public site's header and footer, shared by the landing page and the legal pages.
 *
 * Google's OAuth verification checks that the homepage links to the privacy policy, so the
 * legal links live here rather than on any one page — every public page carries them.
 */

export const BOOK_A_CALL_URL = "https://calendar.app.google/t99M1z5e9BUTVe1K6";

export function SimplrLogo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={className ?? "brand-logo"} src="/brand/simplr-logo.png" alt="Simplr" />
  );
}

export function SiteNav() {
  return (
    <nav className="site-nav" aria-label="Primary navigation">
      <Link className="brand" href="/" aria-label="Simplr home">
        <SimplrLogo />
      </Link>
      <a className="nav-cta" href={BOOK_A_CALL_URL} target="_blank" rel="noopener noreferrer">
        Book a Call
      </a>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-container">
        <div className="footer-top">
          <div className="footer-brand">
            <Link className="brand" href="/" aria-label="Simplr home">
              <SimplrLogo />
            </Link>
            <p>
              Simplr answers, qualifies, and books tours for every rental inquiry, day or night, so residential
              property managers never lose a lead to a missed call.
            </p>
          </div>
          <div className="footer-right">
            <nav className="footer-nav" aria-label="Footer navigation">
              <ul>
                <li>
                  <a href={BOOK_A_CALL_URL} target="_blank" rel="noopener noreferrer">
                    Book a Call
                  </a>
                </li>
                <li>
                  <a href="https://www.linkedin.com/in/aleem-ansari/" target="_blank" rel="noopener noreferrer">
                    Chat with me on LinkedIn
                  </a>
                </li>
                <li>
                  <Link href="/sign-in">Login</Link>
                </li>
                <li>
                  <Link href="/privacy">Privacy Policy</Link>
                </li>
                <li>
                  <Link href="/terms">Terms of Service</Link>
                </li>
              </ul>
            </nav>
          </div>
        </div>
        <div className="footer-bottom">
          <span className="footer-legal">
            <span>© 2026 Simplr | All Rights Reserved</span>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
          </span>
          <span className="made">
            Created by <strong>Sliding Scale Technologies</strong>
          </span>
        </div>
      </div>
    </footer>
  );
}
