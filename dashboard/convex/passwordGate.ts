/**
 * Forced password change on first login (production accounts are created by
 * scripts/prod/seedPeople.mjs with a temporary password).
 *
 * Where the flag lives:
 *   - Clerk publicMetadata.mustChangePassword (the source of truth). Only the backend can write
 *     publicMetadata: the seed script sets it to true, and the change-password server action
 *     (app/change-password/actions.ts) sets it to false after Clerk confirms the password changed.
 *   - users.mustChangePassword in this database, a mirror kept by the seed and the Clerk webhook
 *     (user.created / user.updated carry public_metadata). It is what Convex enforces when the Convex
 *     JWT template does not carry the claim.
 *   - Optionally the claim `mustChangePassword` in the Convex JWT template ("convex" template in Clerk,
 *     `"mustChangePassword": "{{user.public_metadata.mustChangePassword}}"`). When present it is signed
 *     by Clerk, so an explicit `true` always blocks and an explicit `false` overrides a mirror the
 *     webhook has not updated yet.
 *
 * Rule: blocked = claim === true || (claim !== false && users.mustChangePassword === true).
 *
 * authz.ts applies it in currentUser / requireUserId / requireOrgId, the helpers every data function
 * goes through, so a flagged person gets PASSWORD_CHANGE_REQUIRED from Convex whatever page or client
 * they call it from. users.passwordGate (a boolean about the caller only) is the one function exempt.
 *
 * Pure: no Convex imports, so the node tests load it directly.
 */

export const PASSWORD_CHANGE_REQUIRED =
  "Set a new password before you continue. Open the Set your new password page to finish signing in.";

/** The claim name in the Convex JWT template and the key in Clerk publicMetadata. */
export const MUST_CHANGE_PASSWORD_KEY = "mustChangePassword";

/** true / false when the token explicitly carries the claim; undefined when it does not. */
export function claimOf(identity: unknown): boolean | undefined {
  if (!identity || typeof identity !== "object") return undefined;
  const raw = (identity as Record<string, unknown>)[MUST_CHANGE_PASSWORD_KEY];
  if (raw === true || raw === "true") return true;
  if (raw === false || raw === "false") return false;
  return undefined;
}

export function passwordChangeRequired(
  user: { mustChangePassword?: boolean | null } | null | undefined,
  identity: unknown,
): boolean {
  const claim = claimOf(identity);
  if (claim === true) return true;
  if (claim === false) return false;
  return user?.mustChangePassword === true;
}

/** The flag as Clerk's user payload (webhook `public_metadata`) states it; undefined when it does not say. */
export function flagFromPublicMetadata(meta: unknown): boolean | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const raw = (meta as Record<string, unknown>)[MUST_CHANGE_PASSWORD_KEY];
  if (raw === true) return true;
  if (raw === false) return false;
  return undefined;
}
