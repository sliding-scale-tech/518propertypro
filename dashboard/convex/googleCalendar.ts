import type { GenericActionCtx } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { appBaseUrl } from "./appUrl";
import { currentUser, requireUserId } from "./authz";
import * as google from "./googleApi";
import { randomToken, sha256 } from "./team";

/**
 * Each team member's own Google Calendar connection: connecting, disconnecting, and the token
 * handling every calendar call goes through.
 *
 * Per person, not per team. Tours are booked into the calendar of whoever gives them, and only
 * when that person is free, so there is no team calendar to connect.
 */

const STATE_TTL_MS = 10 * 60 * 1000;
// Refresh a little early so a token cannot expire between being read here and used at Google.
const ACCESS_TOKEN_MARGIN_MS = 60 * 1000;

// --- Reads ----------------------------------------------------------------

/** What the Availability page shows. Never includes a token, sealed or otherwise. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return null;

    const connection = await ctx.db
      .query("googleCalendarConnections")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (!connection) return { connected: false as const };

    return {
      connected: true as const,
      googleEmail: connection.googleEmail,
      connectedAt: connection.connectedAt,
      needsReconnect: connection.invalidAt !== undefined,
    };
  },
});

// --- Connecting -----------------------------------------------------------

/**
 * Returns Google's consent URL for the signed-in person.
 *
 * The state parameter is what ties Google's redirect back to this person. Only its hash is
 * stored, it works once, and it expires in 10 minutes — the callback URL is public, so without
 * it anyone could attach their own Google calendar to someone else's account.
 */
export const startConnect = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const userId = await requireUserId(ctx);
    const state = randomToken();
    await ctx.runMutation(internal.googleCalendar.recordState, {
      userId,
      stateHash: await sha256(state),
      expiresAt: Date.now() + STATE_TTL_MS,
    });
    return { url: google.authUrl(state) };
  },
});

/**
 * Google redirects the browser here after the consent screen. Always ends by sending the
 * person back to the Availability page with a `google=` result the page turns into a message,
 * so no outcome leaves them staring at a bare Convex URL.
 */
export async function handleOAuthCallback(
  ctx: GenericActionCtx<DataModel>,
  request: Request,
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const back = (result: string) =>
    new Response(null, {
      status: 302,
      headers: {
        Location: `${appBaseUrl()}/calendar?google=${result}`,
      },
    });

  const state = params.get("state");
  if (!state) return back("error");

  // Consumed before anything else, including the "denied" case, so a state is single-use no
  // matter how the attempt ended.
  const userId = await ctx.runMutation(internal.googleCalendar.consumeState, {
    stateHash: await sha256(state),
  });
  if (!userId) return back("expired");

  if (params.get("error")) return back("denied");
  const code = params.get("code");
  if (!code) return back("error");

  let tokens: google.TokenResponse;
  try {
    tokens = await google.exchangeCode(code);
  } catch (err) {
    console.error("[google oauth] code exchange failed:", err);
    return back("error");
  }

  // Google's consent screen lets people untick individual permissions. A connection that can
  // see free/busy but not add events, or the reverse, would half-work in a way nobody notices
  // until a tour goes missing — so refuse it outright and give the token back.
  const granted = tokens.scope.split(" ");
  if (!google.CALENDAR_SCOPES.every((scope) => granted.includes(scope))) {
    await google.revokeToken(tokens.refresh_token ?? tokens.access_token).catch(() => {});
    return back("missing_scopes");
  }

  if (!tokens.refresh_token) {
    // prompt=consent should make this impossible; if it happens, a connection without one
    // would silently stop working within the hour.
    console.error("[google oauth] token response had no refresh_token");
    await google.revokeToken(tokens.access_token).catch(() => {});
    return back("error");
  }

  const previous = await ctx.runMutation(internal.googleCalendar.saveConnection, {
    userId,
    googleEmail: google.emailFromIdToken(tokens.id_token) ?? "Google account",
    refreshToken: await google.encryptToken(tokens.refresh_token),
    accessToken: await google.encryptToken(tokens.access_token),
    accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
    scopes: granted,
  });

  // Reconnecting issues a new refresh token but leaves the old one valid at Google. Revoke it,
  // or every reconnect leaves another working token behind that nothing here knows about.
  if (previous) {
    await revokeSealed(previous).catch((err) =>
      console.warn("[google oauth] could not revoke the replaced token:", err),
    );
  }

  return back("connected");
}

export const recordState = internalMutation({
  args: { userId: v.id("users"), stateHash: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    // Sweep this person's stale attempts while we are here, so abandoned consent screens do
    // not pile up. Live ones stay — they may have started connecting in another tab.
    for (const old of await ctx.db
      .query("googleOAuthStates")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()) {
      if (old.expiresAt < Date.now()) await ctx.db.delete(old._id);
    }
    await ctx.db.insert("googleOAuthStates", args);
  },
});

export const consumeState = internalMutation({
  args: { stateHash: v.string() },
  handler: async (ctx, args): Promise<Id<"users"> | null> => {
    const row = await ctx.db
      .query("googleOAuthStates")
      .withIndex("by_state_hash", (q) => q.eq("stateHash", args.stateHash))
      .unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    return row.expiresAt < Date.now() ? null : row.userId;
  },
});

/** Upserts the connection. Returns the sealed refresh token it replaced, if any, for revoking. */
export const saveConnection = internalMutation({
  args: {
    userId: v.id("users"),
    googleEmail: v.string(),
    refreshToken: v.string(),
    accessToken: v.string(),
    accessTokenExpiresAt: v.number(),
    scopes: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<string | null> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("googleCalendarConnections")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        connectedAt: now,
        updatedAt: now,
        invalidAt: undefined,
      });
      return existing.refreshToken === args.refreshToken ? null : existing.refreshToken;
    }

    await ctx.db.insert("googleCalendarConnections", { ...args, connectedAt: now, updatedAt: now });
    return null;
  },
});

// --- Disconnecting --------------------------------------------------------

/**
 * Deletes the stored tokens, then revokes them at Google. In that order on purpose: if Google
 * is unreachable the person is still disconnected on our side, which is what they asked for.
 * Tour events already in their calendar are left alone, as the privacy policy says.
 */
export const disconnect = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    const userId = await requireUserId(ctx);
    await forget(ctx, userId);
  },
});

/** Account teardown's entry point — see team.purgeUser. */
export const forgetUser = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<void> => {
    await forget(ctx, args.userId);
  },
});

async function forget(ctx: ActionCtx, userId: Id<"users">): Promise<void> {
  const sealed = await ctx.runMutation(internal.googleCalendar.removeConnection, { userId });
  if (!sealed) return;
  await revokeSealed(sealed).catch((err) =>
    console.warn("[google calendar] disconnected, but revoking at Google failed:", err),
  );
}

export const removeConnection = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<string | null> => {
    const connection = await ctx.db
      .query("googleCalendarConnections")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (!connection) return null;
    await ctx.db.delete(connection._id);
    return connection.refreshToken;
  },
});

async function revokeSealed(sealedRefreshToken: string): Promise<void> {
  await google.revokeToken(await google.decryptToken(sealedRefreshToken));
}

// --- Access tokens --------------------------------------------------------

export const connectionForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: (ctx, args) =>
    ctx.db
      .query("googleCalendarConnections")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique(),
});

export const storeAccessToken = internalMutation({
  args: {
    connectionId: v.id("googleCalendarConnections"),
    accessToken: v.string(),
    accessTokenExpiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    // They may have disconnected while the refresh was in flight; writing now would recreate
    // nothing, but patching a deleted row throws.
    if (!(await ctx.db.get(args.connectionId))) return;
    await ctx.db.patch(args.connectionId, {
      accessToken: args.accessToken,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      updatedAt: Date.now(),
    });
  },
});

export const markInvalid = internalMutation({
  args: { connectionId: v.id("googleCalendarConnections") },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.connectionId))) return;
    await ctx.db.patch(args.connectionId, { invalidAt: Date.now(), updatedAt: Date.now() });
  },
});

/**
 * A usable access token for this person, refreshing it when the cached one is about to expire.
 *
 * When Google rejects the refresh token the connection is marked for reconnecting rather than
 * deleted: the page can then say "reconnect" instead of quietly looking like they never
 * connected, and booking skips them until they do.
 */
export async function accessTokenFor(ctx: ActionCtx, userId: Id<"users">): Promise<string> {
  const connection = await ctx.runQuery(internal.googleCalendar.connectionForUser, { userId });
  if (!connection) throw new Error("This team member has not connected Google Calendar.");
  if (connection.invalidAt) {
    throw new google.GoogleAuthRevokedError("This team member needs to reconnect Google Calendar.");
  }

  if (
    connection.accessToken &&
    connection.accessTokenExpiresAt &&
    connection.accessTokenExpiresAt - ACCESS_TOKEN_MARGIN_MS > Date.now()
  ) {
    return google.decryptToken(connection.accessToken);
  }

  try {
    const fresh = await google.refreshAccessToken(await google.decryptToken(connection.refreshToken));
    await ctx.runMutation(internal.googleCalendar.storeAccessToken, {
      connectionId: connection._id,
      accessToken: await google.encryptToken(fresh.accessToken),
      accessTokenExpiresAt: fresh.expiresAt,
    });
    return fresh.accessToken;
  } catch (err) {
    if (err instanceof google.GoogleAuthRevokedError) {
      await ctx.runMutation(internal.googleCalendar.markInvalid, { connectionId: connection._id });
    }
    throw err;
  }
}

// --- Calendar operations (used by tour booking) ---------------------------
//
// Internal only: each takes a userId with no caller check, so exposing any of them publicly
// would let any client read anyone's busy times or write into their calendar.

export const busyTimes = internalAction({
  args: { userId: v.id("users"), timeMin: v.string(), timeMax: v.string() },
  handler: async (ctx, args): Promise<google.BusyInterval[]> =>
    google.freeBusy(await accessTokenFor(ctx, args.userId), args.timeMin, args.timeMax),
});

export const createEvent = internalAction({
  args: {
    userId: v.id("users"),
    summary: v.string(),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    start: v.string(),
    end: v.string(),
    timeZone: v.optional(v.string()),
  },
  handler: async (ctx, { userId, ...event }): Promise<{ eventId: string }> => {
    const { id } = await google.insertEvent(await accessTokenFor(ctx, userId), event);
    return { eventId: id };
  },
});

export const updateEvent = internalAction({
  args: {
    userId: v.id("users"),
    eventId: v.string(),
    summary: v.optional(v.string()),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    start: v.optional(v.string()),
    end: v.optional(v.string()),
    timeZone: v.optional(v.string()),
  },
  handler: async (ctx, { userId, eventId, ...changes }): Promise<void> => {
    await google.patchEvent(await accessTokenFor(ctx, userId), eventId, changes);
  },
});

export const deleteEvent = internalAction({
  args: { userId: v.id("users"), eventId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    await google.deleteEvent(await accessTokenFor(ctx, args.userId), args.eventId);
  },
});
