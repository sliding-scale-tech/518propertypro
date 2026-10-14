import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { PUBLIC_ROUTE_PATTERNS } from "@/lib/public-routes";

const isPublicRoute = createRouteMatcher(PUBLIC_ROUTE_PATTERNS);

// Hosts that get the simplr.pro marketing site (ported from the standalone leaseops-landing-page
// project, see components/simplr-landing/) at "/" and "/demo" instead of this app's own root
// page. sarah.simplr.pro is untouched — its "/" keeps rendering components/landing/landing-page.tsx
// as before. Both domains point at this same Vercel project and share every other route
// (/sign-in, /dashboard, ...) unchanged; only these two paths branch by hostname.
const SIMPLR_PRO_HOSTS = new Set(["simplr.pro", "www.simplr.pro"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) await auth.protect();

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
