import type { ReactNode } from "react";
import { landingInter } from "@/components/landing/fonts";
import { SiteFooter, SiteNav } from "@/components/landing/site-chrome";
import "@/components/landing/landing.css";

export const LEGAL_CONTACT_EMAIL = "info@slidingscale.xyz";
export const LEGAL_COMPANY = "Sliding Scale Technologies";

/** Shared frame for /privacy and /terms: the public site's header and footer around plain prose. */
export function LegalPage({
  title,
  effectiveDate,
  children,
}: {
  title: string;
  effectiveDate: string;
  children: ReactNode;
}) {
  return (
    <div className={`landing-root ${landingInter.className}`}>
      <div className="page-shell">
        <SiteNav />
        <main className="legal">
          <h1>{title}</h1>
          <p className="legal-updated">Effective {effectiveDate}</p>
          {children}
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}
