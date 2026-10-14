/**
 * Thin wrapper over the WAHA REST API (self-hosted WhatsApp). Mirrors the style of
 * elevenLabsApi.ts: fetch-based, no SDK, runs on Convex's default runtime.
 *
 * WAHA is an *unofficial* WhatsApp API — it drives WhatsApp Web, so it behaves like a linked
 * device rather than a cloud API. The quirks that follow from that are documented at each
 * call site and collected in infra/waha/README.md.
 */

/** One number for the whole property; this app is deliberately single-tenant. */
export const SESSION_NAME = "leaseline";

function config(): { baseUrl: string; apiKey: string } {
  const baseUrl = process.env.WAHA_BASE_URL;
  const apiKey = process.env.WAHA_API_KEY;
  if (!baseUrl?.trim() || !apiKey?.trim()) {
    throw new Error(
      "WhatsApp is not configured. Set both with: npx convex env set WAHA_BASE_URL <url> " +
        "and npx convex env set WAHA_API_KEY <key>. See infra/waha/README.md.",
    );
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey };
}

/** True when the deployment has WAHA credentials at all, so callers can degrade gracefully. */
export function isConfigured(): boolean {
  return Boolean(process.env.WAHA_BASE_URL?.trim() && process.env.WAHA_API_KEY?.trim());
}

async function request(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const { baseUrl, apiKey } = config();
  return fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "X-Api-Key": apiKey,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
}

// --- Session lifecycle ----------------------------------------------------

export type SessionStatus =
  | "STARTING"
  | "SCAN_QR_CODE"
  | "WORKING"
  | "FAILED"
  | "STOPPED"
  | "UNKNOWN";

/** Current status, or null when WAHA has never heard of this session. */
export async function getSession(): Promise<{ status: SessionStatus; me?: { id?: string } } | null> {
  const res = await request(`/api/sessions/${SESSION_NAME}`);
  if (!res.ok) return null;
  return (await res.json()) as { status: SessionStatus; me?: { id?: string } };
}

/**
 * Brings the session up, whatever state it is currently in.
 *
 * The important case is a session sitting in FAILED or STOPPED: calling /start on it returns
 * 422 and leaves it dead, which makes the UI poll for a QR code that never arrives. Such a
 * session has to be /restart-ed instead. This cost real debugging time in a previous project;
 * see infra/waha/README.md.
 */
export async function startSession(webhookUrl: string): Promise<void> {
  const { apiKey } = config();
  const existing = await getSession();

  if (existing) {
    const alive = ["WORKING", "SCAN_QR_CODE", "STARTING"].includes(existing.status);
    if (alive) return;

    const restart = await request(`/api/sessions/${SESSION_NAME}/restart`, { method: "POST" });
    if (!restart.ok) {
      throw new Error(`WAHA could not restart the session: ${await restart.text()}`);
    }
    return;
  }

  const res = await request("/api/sessions/start", {
    method: "POST",
    body: {
      name: SESSION_NAME,
      config: {
        webhooks: [
          {
            url: webhookUrl,
            events: ["message"],
            // Our webhook rejects anything without this header — otherwise anyone who knows
            // the deployment URL could inject fake WhatsApp messages into the inbox.
            customHeaders: [{ name: "X-Api-Key", value: apiKey }],
          },
        ],
      },
    },
  });

  // 422 means the session already exists and is running. Not an error.
  if (!res.ok && res.status !== 422) {
    throw new Error(`WAHA could not start the session: ${await res.text()}`);
  }
}

/** Raw QR payload to render as a code, or null if the session isn't waiting for a scan. */
export async function getQr(): Promise<string | null> {
  const res = await request(`/api/${SESSION_NAME}/auth/qr?format=raw`);
  if (!res.ok) return null;
  const data = (await res.json()) as { value?: string };
  return data.value ?? null;
}

export async function stopSession(): Promise<void> {
  await request(`/api/sessions/${SESSION_NAME}/stop`, { method: "POST" });
}

/** Removes the session entirely, so the next connect starts from a fresh QR scan. */
export async function logoutSession(): Promise<void> {
  await request(`/api/sessions/${SESSION_NAME}/logout`, { method: "POST" });
}

// --- Messaging ------------------------------------------------------------

/**
 * WhatsApp wants a full JID. A stored chatId is either bare digits (append the suffix) or
 * already a full JID such as "…@lid" (leave it alone — re-suffixing it makes it undeliverable).
 */
export function toJid(chatId: string): string {
  return chatId.includes("@") ? chatId : `${chatId}@c.us`;
}

export async function sendText(chatId: string, text: string): Promise<boolean> {
  const res = await request("/api/sendText", {
    method: "POST",
    body: { session: SESSION_NAME, chatId: toJid(chatId), text },
  });
  return res.ok;
}

/** Shows the typing indicator, so a considered reply doesn't look like a dead chat. */
export async function startTyping(chatId: string): Promise<void> {
  await request("/api/startTyping", {
    method: "POST",
    body: { session: SESSION_NAME, chatId: toJid(chatId) },
  }).catch(() => {
    /* cosmetic only — never let this break a reply */
  });
}

export async function stopTyping(chatId: string): Promise<void> {
  await request("/api/stopTyping", {
    method: "POST",
    body: { session: SESSION_NAME, chatId: toJid(chatId) },
  }).catch(() => {
    /* cosmetic only */
  });
}

/**
 * Resolves a LID identifier to a real phone number.
 *
 * WhatsApp is migrating to LIDs, so an inbound `from` can be "123456@lid" rather than a phone
 * number. Returning null is normal and callers must handle it by keeping the full JID.
 */
export async function resolveLid(lidJid: string): Promise<string | null> {
  try {
    const res = await request(
      `/api/${SESSION_NAME}/lids/${encodeURIComponent(lidJid)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { pn?: string | null };
    const digits = data.pn?.replace(/@.*/, "").trim();
    return digits || null;
  } catch {
    return null;
  }
}
