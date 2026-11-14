/**
 * Invite-only dashboard access.
 *
 * Clerk sign-up stays open (Clerk's own invite-only mode would block our invitees, who sign
 * themselves up after clicking the link we email them), so this database decides who is in:
 * a person gets a team membership only by
 *   - redeeming a live invite addressed to their own email (team.redeemInvite / acceptPendingInvite),
 *   - being created by the production seed (prodSeed.seedPerson), or
 *   - already having one.
 * A sign-up with none of those gets no membership, no role and never a new team
 * (team.ensureTeamForUser), and every data function refuses them with INVITE_REQUIRED through
 * the central helpers in authz.ts, the same way the password gate works.
 *
 * ALLOW_OPEN_SIGNUP=true (Convex env var, default off) brings back the old open self-join for a
 * demo or scratch deployment: a new account joins the one team as a role-less member, or creates
 * the team on an empty deployment. Never set it in production.
 *
 * Pure: no Convex imports, so the node tests load it directly.
 */

export const INVITE_REQUIRED =
  "You need an invite from 518 Property Pro to use this dashboard. If you were invited, open the link in your invite email, or ask your admin to send a new one.";

/** True only when the deployment explicitly opts in with ALLOW_OPEN_SIGNUP=true. */
export function openSignupAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return (env.ALLOW_OPEN_SIGNUP ?? "").trim().toLowerCase() === "true";
}
