/**
 * The public origin of the Next.js app, for links that leave the backend and land in a
 * browser: the OAuth callback's final redirect and invitation emails.
 *
 * Convex cannot infer this — CONVEX_SITE_URL is the backend's own .convex.site domain, not
 * the app's. It throws rather than falling back to localhost, because a missing value used to
 * silently send people in production to http://localhost:3000.
 */
export function appBaseUrl(): string {
  const base = process.env.APP_BASE_URL;
  if (!base) {
    throw new Error(
      "APP_BASE_URL is not set on this deployment. Set it to the app's public origin, " +
        "with no trailing slash: npx convex env set APP_BASE_URL https://www.simplr.pro",
    );
  }
  return base.replace(/\/+$/, "");
}
