"use client";

const SESSION_ID_KEY = "ll_session_id";
const CALL_COUNT_KEY = "ll_call_count";
const SHOWN_KEY_PREFIX = "ll_shown_";

/**
 * A visit-scoped id for the landing page's "Try yourself" demo. Deliberately sessionStorage,
 * not localStorage or a cookie: it has to live only as long as this tab. Someone who closes
 * the browser and comes back two hours (or two minutes) later is a fresh visit with a fresh
 * set of tries — not someone who has "already used up" anything — exactly like a stranger
 * walking up to an in-person demo for the first time.
 */
export function getLandingSessionId(): string {
  if (typeof window === "undefined") return "";
  let id: string | null = null;
  try {
    id = window.sessionStorage.getItem(SESSION_ID_KEY);
  } catch {
    // Storage blocked (private mode, disabled site data) — fall back to an id that lives only
    // for this call, which just means the popup logic below never fires. Talking to the
    // agent matters more than the feedback prompts around it.
    return `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    try {
      window.sessionStorage.setItem(SESSION_ID_KEY, id);
    } catch {
      // Nothing to persist to — the id above still works for this one call.
    }
  }
  return id;
}

/** Call once per completed "Try yourself" call. Returns this visit's running count. */
export function recordLandingCallCompleted(): number {
  if (typeof window === "undefined") return 0;
  try {
    const next = Number(window.sessionStorage.getItem(CALL_COUNT_KEY) ?? "0") + 1;
    window.sessionStorage.setItem(CALL_COUNT_KEY, String(next));
    return next;
  } catch {
    return 0;
  }
}

// Only the rating popup is a once-per-visit thing — the signup nudge is meant to keep
// showing from the 3rd call onward, so it's driven straight off the call count instead.
export type LandingPopupKey = "rating";

/** Fires at most once per visit, regardless of how many more calls follow. */
export function landingPopupAlreadyShown(key: LandingPopupKey): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.sessionStorage.getItem(SHOWN_KEY_PREFIX + key) === "1";
  } catch {
    return true;
  }
}

export function markLandingPopupShown(key: LandingPopupKey): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SHOWN_KEY_PREFIX + key, "1");
  } catch {
    // Nothing to do — worst case the same popup can show again this visit.
  }
}
