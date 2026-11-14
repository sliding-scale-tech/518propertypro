import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { PUBLIC_ROUTE_PATTERNS } from "@/lib/public-routes";
import {
  CHANGE_PASSWORD_PATH,
  allowedWhileFlagged,
  isApiPath,
  mustChangePasswordFromClaims,
} from "@/lib/password-gate";

const isPublicRoute = createRouteMatcher(PUBLIC_ROUTE_PATTERNS);

// Hosts that get the simplr.pro marketing site (ported from the standalone leaseops-landing-page
// project, see components/simplr-landing/) at "/" and "/demo" instead of this app's own root
// page. sarah.simplr.pro is untouched — its "/" keeps rendering components/landing/landing-page.tsx
// as before. Both domains point at this same Vercel project and share every other route
// (/sign-in, /dashboard, ...) unchanged; only these two paths branch by hostname.
const SIMPLR_PRO_HOSTS = new Set(["simplr.pro", "www.simplr.pro"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    const { sessionClaims } = await auth.protect();
    // Forced password change on first login (lib/password-gate.ts, convex/passwordGate.ts): someone
    // still on their temporary password reaches only the change page. Reads the session token's
    // metadata claim, so it needs the Clerk session token customisation in docs/PROD-RUNBOOK.md; the
    // app chrome and every Convex function enforce the same rule without it.
    const { pathname } = req.nextUrl;
    if (mustChangePasswordFromClaims(sessionClaims) && !allowedWhileFlagged(pathname)) {
      if (isApiPath(pathname)) {
        return NextResponse.json({ error: "Set a new password before you continue." }, { status: 403 });
      }
      return NextResponse.redirect(new URL(CHANGE_PASSWORD_PATH, req.url));
    }
  }

  const host = req.headers.get("host")?.split(":")[0] ?? "";
  if (SIMPLR_PRO_HOSTS.has(host)) {
    const { pathname } = req.nextUrl;
    // A rewrite, not a redirect: the browser's URL bar keeps showing "/" or "/demo" on
    // simplr.pro, it just gets served from a different internal route.
    if (pathname === "/") {
      return NextResponse.rewrite(new URL("/simplr-landing", req.url));
    }
    if (pathname === "/demo") {
      return NextResponse.rewrite(new URL("/simplr-landing/demo", req.url));
    }
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp3)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
