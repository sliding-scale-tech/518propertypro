/**
 * Forced password change on first login: the web side of convex/passwordGate.ts.
 *
 * Pure (no Next or Clerk imports) so proxy.ts, the app chrome and the node tests share one
 * definition of "where may a person on a temporary password go".
 */

/** The page that asks for the new password. */
export const CHANGE_PASSWORD_PATH = "/change-password";

/**
 * Signed-in routes a flagged person may still open: the change page itself (its server action posts
 * back to the same path) and Clerk's own sign-in pages (to sign out and back in). Everything else
 * that needs sign-in is redirected to CHANGE_PASSWORD_PATH by proxy.ts.
 */
const ALLOWED_PREFIXES = [CHANGE_PASSWORD_PATH, "/sign-in", "/sso-callback", "/__clerk"];

export function allowedWhileFlagged(pathname: string): boolean {
  return ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Data routes answer 403 rather than an HTML redirect. */
export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/") || pathname === "/trpc" || pathname.startsWith("/trpc/");
}

/**
 * The flag from Clerk session claims. Needs the session token customised in the Clerk dashboard
 * (Sessions, Customize session token): `{ "metadata": "{{user.public_metadata}}" }`. Without that the
 * claim is absent and this returns false; the app chrome and Convex still enforce the gate.
 */
export function mustChangePasswordFromClaims(claims: unknown): boolean {
  if (!claims || typeof claims !== "object") return false;
  const c = claims as Record<string, unknown>;
  const meta = c.metadata ?? c.publicMetadata ?? c.public_metadata;
  if (meta && typeof meta === "object" && (meta as Record<string, unknown>).mustChangePassword === true) return true;
  return c.mustChangePassword === true;
}

/** The flag on a Clerk user object's publicMetadata (client side: useUser().user.publicMetadata). */
export function mustChangePasswordFromMetadata(meta: unknown): boolean {
  return !!meta && typeof meta === "object" && (meta as Record<string, unknown>).mustChangePassword === true;
}

// --- Field checks for the change form (client) --------------------------------------------------------

export type PasswordFields = { currentPassword: string; newPassword: string; confirmPassword: string };
export type PasswordErrors = Partial<Record<keyof PasswordFields, string>>;

export const DEFAULT_MIN_PASSWORD_LENGTH = 8;

/** Every problem with the form, by field, with the sentence to show under it. Empty = good to send. */
export function checkPasswordFields(f: PasswordFields, minLength = DEFAULT_MIN_PASSWORD_LENGTH): PasswordErrors {
  const errors: PasswordErrors = {};
  if (!f.currentPassword) errors.currentPassword = "Enter the temporary password you signed in with.";
  if (!f.newPassword) errors.newPassword = "Enter a new password.";
  else if (f.newPassword.length < minLength) errors.newPassword = `Use at least ${minLength} characters for your new password.`;
  else if (f.currentPassword && f.newPassword === f.currentPassword) {
    errors.newPassword = "Choose a new password that is different from your temporary one.";
  }
  if (!f.confirmPassword) errors.confirmPassword = "Type your new password again to confirm it.";
  else if (f.newPassword && f.confirmPassword !== f.newPassword) errors.confirmPassword = "The two new passwords do not match.";
  return errors;
}
