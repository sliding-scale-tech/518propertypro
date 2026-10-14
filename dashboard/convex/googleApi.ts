/**
 * Thin wrapper over Google's OAuth and Calendar REST APIs. Same style as twilioApi.ts and
 * elevenLabsApi.ts: fetch-based, no SDK, runs on Convex's default runtime.
 *
 * Also owns token encryption, so nothing outside this file ever handles a raw Google token
 * that is at rest.
 */

// Exactly what the privacy policy's "Google user data" section describes. Adding a scope here
// without updating app/privacy/page.tsx is what fails Google's OAuth verification.
export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events",
];
const SCOPES = ["openid", "email", ...CALENDAR_SCOPES];

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

function credentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing Google env vars. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET with: " +
        "npx convex env set <NAME> <value>",
    );
  }
  return { clientId, clientSecret };
}

/** Must match an Authorized redirect URI on the Google OAuth client, character for character. */
export function redirectUri(): string {
  const siteUrl = process.env.CONVEX_SITE_URL;
  if (!siteUrl) throw new Error("CONVEX_SITE_URL is not set on this deployment.");
  return `${siteUrl}/google/oauth/callback`;
}

/**
 * access_type=offline plus prompt=consent is what guarantees a refresh token. Without
 * prompt=consent, Google only returns one the first time a person ever connects, so someone
 * who disconnects and reconnects would come back with a connection that dies within the hour.
 */
export function authUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: credentials().clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_ENDPOINT}?${params}`;
}

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
};

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = credentials();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!res.ok) throw await googleError(res, "token exchange");
  return (await res.json()) as TokenResponse;
}

/**
 * The person revoked access, or the refresh token otherwise stopped working (a Testing-mode
 * app's tokens die after 7 days). Distinct from a network blip: this one needs them to
 * reconnect, and retrying will never fix it.
 */
export class GoogleAuthRevokedError extends Error {}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: number }> {
  const { clientId, clientSecret } = credentials();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) {
    const detail = await res.text();
    if (res.status === 400 && detail.includes("invalid_grant")) {
      throw new GoogleAuthRevokedError("Google Calendar access was revoked or has expired.");
    }
    throw new Error(`Google token refresh ${res.status}: ${detail.slice(0, 500)}`);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
}

/** Revoking a refresh token also revokes every access token issued from it. */
export async function revokeToken(token: string): Promise<void> {
  const res = await fetch(REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });
  // 400 here means Google no longer recognizes the token — already revoked, which is the goal.
  if (!res.ok && res.status !== 400) throw await googleError(res, "token revoke");
}

/**
 * Reads the email claim without verifying the signature. That is safe only because this token
 * came straight from Google's token endpoint over TLS in exchangeCode — never pass an id_token
 * that arrived from a browser through here.
 */
export function emailFromIdToken(idToken: string | undefined): string | undefined {
  const payload = idToken?.split(".")[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(atob(fromBase64Url(payload))) as { email?: string };
    return claims.email;
  } catch {
    return undefined;
  }
}

// --- Calendar -------------------------------------------------------------

export type BusyInterval = { start: string; end: string };

/** Busy blocks on the person's primary calendar. Never titles, attendees or anything else. */
export async function freeBusy(
  accessToken: string,
  timeMin: string,
  timeMax: string,
): Promise<BusyInterval[]> {
  const res = await fetch(`${CALENDAR_API}/freeBusy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: "primary" }] }),
  });
  if (!res.ok) throw await googleError(res, "freeBusy");

  const body = (await res.json()) as {
    calendars?: Record<string, { busy?: BusyInterval[]; errors?: Array<{ reason?: string }> }>;
  };
  const primary = body.calendars?.primary;
  // Google reports per-calendar failures inside a 200. Treating that as "no busy times" would
  // book a tour on top of whatever we could not see.
  if (!primary || primary.errors?.length) {
    throw new Error(
      `Google freeBusy could not read the calendar: ${primary?.errors?.map((e) => e.reason).join(", ") ?? "no result"}`,
    );
  }
  return primary.busy ?? [];
}

export type CalendarEvent =
  | { id: string; title: string; allDay: false; start: number; end: number; simplrTour: boolean }
  // All-day dates are calendar dates, not instants; endDate is exclusive, as Google returns it.
  | { id: string; title: string; allDay: true; startDate: string; endDate: string; simplrTour: boolean };

/**
 * The events on someone's primary calendar, titles included. Only ever called for the person
 * looking at their own calendar (see calendarView.week) — teammates get freeBusy, never this.
 */
export async function listEvents(
  accessToken: string,
  timeMin: string,
  timeMax: string,
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true", // expands recurring events into the individual occurrences
    orderBy: "startTime",
    maxResults: "250",
    fields: "items(id,summary,status,start,end,extendedProperties)",
  });
  const res = await fetch(`${CALENDAR_API}/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw await googleError(res, "event list");

  type GoogleTime = { dateTime?: string; date?: string };
  const body = (await res.json()) as {
    items?: Array<{
      id: string;
      summary?: string;
      status?: string;
      start?: GoogleTime;
      end?: GoogleTime;
      extendedProperties?: { private?: Record<string, string> };
    }>;
  };

  const events: CalendarEvent[] = [];
  for (const e of body.items ?? []) {
    if (e.status === "cancelled" || !e.start || !e.end) continue;
    const title = e.summary || "(No title)";
    const simplrTour = e.extendedProperties?.private?.simplr === "tour";
    if (e.start.dateTime && e.end.dateTime) {
      events.push({ id: e.id, title, allDay: false, start: Date.parse(e.start.dateTime), end: Date.parse(e.end.dateTime), simplrTour });
    } else if (e.start.date && e.end.date) {
      events.push({ id: e.id, title, allDay: true, startDate: e.start.date, endDate: e.end.date, simplrTour });
    }
  }
  return events;
}

export type EventInput = {
  summary: string;
  description?: string;
  location?: string;
  start: string; // RFC 3339
  end: string; // RFC 3339
  timeZone?: string; // IANA, e.g. "America/Chicago"
};

export async function insertEvent(accessToken: string, input: EventInput): Promise<{ id: string }> {
  const res = await fetch(`${CALENDAR_API}/calendars/primary/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...eventBody(input),
      // Marks the event as one Simplr created, so it is recognizable in the calendar data and
      // nothing ever mistakes someone's own event for a tour.
      extendedProperties: { private: { simplr: "tour" } },
    }),
  });
  if (!res.ok) throw await googleError(res, "event insert");
  const body = (await res.json()) as { id: string };
  return { id: body.id };
}

export async function patchEvent(
  accessToken: string,
  eventId: string,
  input: Partial<EventInput>,
): Promise<void> {
  const res = await fetch(
    `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(eventBody(input)),
    },
  );
  if (!res.ok) throw await googleError(res, "event update");
}

export async function deleteEvent(accessToken: string, eventId: string): Promise<void> {
  const res = await fetch(
    `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  // 404/410: the person already deleted it themselves, which is the outcome we wanted.
  if (!res.ok && res.status !== 404 && res.status !== 410) throw await googleError(res, "event delete");
}

function eventBody(input: Partial<EventInput>) {
  return {
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
    ...(input.start !== undefined ? { start: { dateTime: input.start, timeZone: input.timeZone } } : {}),
    ...(input.end !== undefined ? { end: { dateTime: input.end, timeZone: input.timeZone } } : {}),
  };
}

async function googleError(res: Response, what: string): Promise<Error> {
  const detail = await res.text();
  return new Error(`Google ${what} ${res.status}: ${detail.slice(0, 500)}`);
}

// --- Token encryption -----------------------------------------------------

/**
 * AES-256-GCM with a key that lives only in the deployment's environment, so a copy of the
 * database alone does not hand anyone a working Google token. The "v1." prefix leaves room to
 * rotate the scheme without guessing what an old row was sealed with.
 */
async function encryptionKey(usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "GOOGLE_TOKEN_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` " +
        "and set it with: npx convex env set GOOGLE_TOKEN_ENCRYPTION_KEY <value>",
    );
  }
  const bytes = toBytes(raw);
  if (bytes.length !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, [usage]);
}

export async function encryptToken(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey("encrypt"),
    new TextEncoder().encode(plain),
  );
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(sealed))}`;
}

export async function decryptToken(sealed: string): Promise<string> {
  const [version, iv, data] = sealed.split(".");
  if (version !== "v1" || !iv || !data) throw new Error("Unrecognized encrypted token format.");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toBytes(iv) },
    await encryptionKey("decrypt"),
    toBytes(data),
  );
  return new TextDecoder().decode(plain);
}

// Convex's default runtime is a V8 isolate, not Node — no Buffer, so base64 goes through btoa/atob.
function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function toBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function fromBase64Url(value: string): string {
  return value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
}
