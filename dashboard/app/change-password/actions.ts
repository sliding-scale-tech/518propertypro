"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";

/**
 * Clears the forced-password-change flag (convex/passwordGate.ts) once Clerk itself confirms the
 * password was changed. The browser calls this right after user.updatePassword(); nothing it sends is
 * trusted. The checks run here, server-side, against Clerk's Backend API:
 *
 *   - the caller is signed in (their own Clerk user id from the session, never from the request);
 *   - Clerk's password_last_updated_at is AFTER the moment the temporary password was issued
 *     (publicMetadata.tempPasswordIssuedAt, stamped from Clerk's own clock by the seed script), and
 *     within the last 15 minutes, i.e. it was changed just now.
 *
 * Only then is publicMetadata.mustChangePassword set to false. Clerk's user.updated webhook carries
 * that to Convex (users.mustChangePassword), and the session token claim follows on its next refresh.
 * When the flag is already false this re-writes it, which re-sends the webhook if an earlier one was
 * missed. Returns a sentence for the person, never Clerk's raw error.
 */

const RECENT_MS = 15 * 60 * 1000;

export type CompleteResult = { ok: true } | { ok: false; error: string };

export async function completePasswordChange(): Promise<CompleteResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Your session has ended. Sign in again with your temporary password." };

  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const meta = (user.publicMetadata ?? {}) as Record<string, unknown>;

    if (meta.mustChangePassword === true) {
      const changedAt = user.raw?.password_last_updated_at ?? null;
      const issuedAt = typeof meta.tempPasswordIssuedAt === "number" ? meta.tempPasswordIssuedAt : user.createdAt;
      const now = Date.now();
      if (!changedAt || changedAt <= issuedAt || changedAt < now - RECENT_MS) {
        return { ok: false, error: "We could not confirm your new password yet. Enter it again and select Save password." };
      }
    }

    await client.users.updateUserMetadata(userId, {
      publicMetadata: { mustChangePassword: false, tempPasswordIssuedAt: null },
    });
    return { ok: true };
  } catch (err) {
    // The cause goes to the server log (no request data in it); the person gets a plain sentence.
    console.error("change-password: could not finish", err instanceof Error ? err.message.slice(0, 200) : "unknown");
    return { ok: false, error: "We could not finish setting up your account. Try again in a moment." };
  }
}
