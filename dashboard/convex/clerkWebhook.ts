import type { GenericActionCtx } from "convex/server";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

type ClerkEmail = { id?: string; email_address?: string };
type ClerkUserPayload = {
  id?: string;
  primary_email_address_id?: string | null;
  email_addresses?: ClerkEmail[];
  first_name?: string | null;
  last_name?: string | null;
  image_url?: string | null;
  last_sign_in_at?: number | null;
};
type ClerkSessionPayload = {
  user_id?: string;
  last_active_at?: number | null;
  created_at?: number | null;
};
type ClerkEvent = {
  type?: string;
  data?: ClerkUserPayload & ClerkSessionPayload & { id?: string };
};

const TIMESTAMP_TOLERANCE_SEC = 5 * 60;

export async function handleClerkWebhook(
  ctx: GenericActionCtx<DataModel>,
  request: Request,
): Promise<Response> {
  const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    console.error("[clerk webhook] CLERK_WEBHOOK_SIGNING_SECRET is not set");
    return new Response("webhook not configured", { status: 500 });
  }

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("missing svix headers", { status: 400 });
  }

  const body = await request.text();
  const valid = await verifySvixSignature({
    secret,
    body,
    svixId,
    svixTimestamp,
    svixSignature,
  });
  if (!valid) return new Response("invalid signature", { status: 400 });

  let event: ClerkEvent;
  try {
    event = JSON.parse(body) as ClerkEvent;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  switch (event.type) {
    case "user.created":
    case "user.updated": {
      const user = event.data ?? {};
      if (!user.id) return new Response("missing user id", { status: 400 });
      const userId = await ctx.runMutation(internal.users.upsertFromClerk, {
        clerkId: user.id,
        email: primaryEmail(user),
        firstName: user.first_name ?? undefined,
        lastName: user.last_name ?? undefined,
        imageUrl: user.image_url ?? undefined,
        lastSignInAt: user.last_sign_in_at ?? undefined,
      });
      // Every account needs a team before the dashboard means anything. Single-tenant: joins the
      // one shared team (or creates it on a fresh install). A no-op when they already have one,
      // and skipped when a live invitation is waiting — the invite carries the role.
      await ctx.runMutation(internal.team.ensureTeamForUser, { userId });
      break;
    }
    case "session.created": {
      const session = event.data ?? {};
      const clerkId = session.user_id;
      if (!clerkId) return new Response("missing user id", { status: 400 });
      const sessionUserId = await ctx.runMutation(internal.users.upsertFromClerk, {
        clerkId,
        lastSignInAt: session.last_active_at ?? session.created_at ?? Date.now(),
      });
      // Safety net for accounts that predate this webhook, or whose user.created event was
      // missed — without it they would sign in to a dashboard with no team behind it.
      await ctx.runMutation(internal.team.ensureTeamForUser, { userId: sessionUserId });
      break;
    }
    case "user.deleted": {
      const clerkId = event.data?.id;
      if (clerkId) {
        // Removes only this person's seat (membership, calendar, availability). The shared
        // team, its data and its ElevenLabs agent stay.
        await ctx.runAction(internal.team.purgeByClerkId, { clerkId });
      }
      break;
    }
    default:
      break;
  }

  return new Response("ok", { status: 200 });
}

function primaryEmail(user: ClerkUserPayload): string | undefined {
  const emails = user.email_addresses ?? [];
  const primary = emails.find((email) => email.id === user.primary_email_address_id);
  return primary?.email_address ?? emails[0]?.email_address;
}

async function verifySvixSignature({
  secret,
  body,
  svixId,
  svixTimestamp,
  svixSignature,
}: {
  secret: string;
  body: string;
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
}): Promise<boolean> {
  const timestamp = Number(svixTimestamp);
  if (!Number.isFinite(timestamp)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > TIMESTAMP_TOLERANCE_SEC) return false;

  const secretBytes = decodeBase64(secret.startsWith("whsec_") ? secret.slice(6) : secret);
  const payload = `${svixId}.${svixTimestamp}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
  );

  return svixSignature.split(" ").some((part) => {
    const [version, signature] = part.split(",", 2);
    if (version !== "v1" || !signature) return false;
    try {
      return timingSafeEqual(signatureBytes, new Uint8Array(decodeBase64(signature)));
    } catch {
      return false;
    }
  });
}

function decodeBase64(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}
