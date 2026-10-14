"use client";

import { CallDemoWidget } from "./call-demo-widget";
import { SiteFooter, SiteNav } from "./site-chrome";
import "./landing.css";

export function LandingPage({ className }: { className?: string }) {
  return (
    <div className={`landing-root${className ? ` ${className}` : ""}`}>
      <div className="page-shell">
        <SiteNav />

        <main className="hero" id="demo">
          <div className="eyebrow">
            <span className="eyebrow-dot" /> Live after hours leasing demo
          </div>
          <h1>Watch Sarah answer a renter call</h1>
          <p className="hero-copy">
            A calm, realistic walkthrough of how Simplr answers, qualifies, and books a tour while your leasing team
            is offline.
          </p>
          <CallDemoWidget />
        </main>

        <SiteFooter />
      </div>
    </div>
  );
}
