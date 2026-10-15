import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { randomToken, sha256 } from "./team";

/**
 * Public token links (F8): the no-login pages a tenant reaches from a text message (photo
 * upload after a call, later the payment page). Helpers only; there is deliberately no public
 * query/mutation here yet, because each page will expose its own narrow endpoint that calls
 * consumePublicLink first.
 *
 * Only the SHA-256 of the token is stored (the invites pattern), so a dump of the table can't
 * be replayed. The raw token is returned once, at creation, and goes straight into the SMS.
 */

export const MEDIA_LINK_TTL_MS = 72 * 60 * 60 * 1000;
export const MEDIA_LINK_MAX_USES = 20; // upload actions allowed per link

export async function createPublicLink(
  ctx: MutationCtx,
  input: {
    orgId: string;
    purpose: Doc<"publicLinks">["purpose"];
    targetId: string;
    ttlMs?: number;
    maxUses?: number;
  },
): Promise<{ token: string; expiresAt: number }> {
  const token = randomToken();
  const now = Date.now();
  const expiresAt = now + (input.ttlMs ?? MEDIA_LINK_TTL_MS);
  await ctx.db.insert("publicLinks", {
    orgId: input.orgId,
    purpose: input.purpose,
    tokenHash: await sha256(token),
    targetId: input.targetId,
    expiresAt,
    maxUses: input.maxUses ?? MEDIA_LINK_MAX_USES,
    useCount: 0,
    createdAt: now,
  });
  return { token, expiresAt };
}

/**
 * Same checks as consumePublicLink but spends nothing, for read-only screens (is this link
 * still good?) and for steps that only count once they succeed (handing out an upload URL).
 */
export async function peekPublicLink(
  ctx: QueryCtx | MutationCtx,
  token: string,
  purpose: Doc<"publicLinks">["purpose"],
): Promise<Doc<"publicLinks"> | null> {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 200) return null;
  const tokenHash = await sha256(trimmed);
  const link = await ctx.db
    .query("publicLinks")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!link || link.purpose !== purpose) return null;
  if (link.expiresAt <= Date.now() || link.useCount >= link.maxUses) return null;
  return link;
}

/**
 * Validates a raw token for `purpose` and spends one use. Returns the link row, or null for
 * every failure alike (unknown, wrong purpose, expired, exhausted) so a caller can't tell a
 * guessed token from a spent one.
 */
export async function consumePublicLink(
  ctx: MutationCtx,
  token: string,
  purpose: Doc<"publicLinks">["purpose"],
): Promise<Doc<"publicLinks"> | null> {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 200) return null;
  const tokenHash = await sha256(trimmed);
  const link = await ctx.db
    .query("publicLinks")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!link || link.purpose !== purpose) return null;
  if (link.expiresAt <= Date.now() || link.useCount >= link.maxUses) return null;

  const useCount = link.useCount + 1;
  await ctx.db.patch(link._id, {
    useCount,
    usedAt: useCount >= link.maxUses ? Date.now() : link.usedAt,
  });
  return { ...link, useCount };
}
