/**
 * What a tool result tells Sarah to say. Pure and free of Convex imports, so
 * scripts/probes/sarah_replies.test.mjs can run it directly.
 *
 * Sarah says it was logged once, when she closes the call. Only a life-safety result carries a say
 * line to speak straight away. A routine or urgent result carries closing_line instead: a say line
 * on an urgent result made her repeat "I've logged this" mid-intake
 * (conv_7301m6e31kq8fs8razf5mys7t6wj, request #1012).
 */
import type { SeverityLevel } from "./severity";

/**
 * ElevenLabs runs another LLM generation after every tool result, whether or not the caller has
 * spoken. Sent on results that can land after Sarah asked something, so she does not carry on and
 * answer her own question (conv_9001m6dzykqte399btbs28d2z4ss). It says nothing about skip_turn so it
 * also reads correctly on an agent that was published before skip_turn existed.
 */
export const WAIT_FOR_CALLER =
  "This result is not the caller's answer. If you have already asked something they have not answered, say nothing and wait for them.";

/** send_photo_link. Keeps the meaning (nothing is texted, the asset manager follows up) as a brief acknowledgement. */
export const PHOTO_SAY = "Thanks, your asset manager will follow up about photos.";

const EMERGENCY_ALERTED_SAY = "I've logged this as an emergency and alerted the team right away.";
const FOLLOW_UP_SOON = "I've logged this and the team will follow up with you as soon as possible.";
const OUT_OF_SCOPE_SAY =
  "I've noted that. This one is the resident's responsibility, so we won't be sending a technician for it.";

export type MaintenanceLogOutcome = {
  severity: SeverityLevel;
  /** True only when an emergency text was actually queued: Sarah may not claim it otherwise. */
  emergencyAlerted: boolean;
  /** The saved request, or null when there is no request row to report (the team was not resolved). */
  saved: { routedToAm: boolean; closedOutOfScope: boolean } | null;
};

export type MaintenanceLogLines =
  | { say: string; message: string }
  | { closing_line: string; message: string };

const speakNow = (say: string): MaintenanceLogLines => ({
  say,
  message: `Say the say line once. ${WAIT_FOR_CALLER}`,
});

const atClose = (closingLine: string): MaintenanceLogLines => ({
  closing_line: closingLine,
  message: `Logged. Keep going with the next step. Say closing_line once, only when you close the call. ${WAIT_FOR_CALLER}`,
});

/** The spoken part of a logged:true log_maintenance_request result. */
export function maintenanceLogLines({ severity, emergencyAlerted, saved }: MaintenanceLogOutcome): MaintenanceLogLines {
  if (saved?.closedOutOfScope) return speakNow(OUT_OF_SCOPE_SAY);
  if (severity === "emergency") return speakNow(emergencyAlerted ? EMERGENCY_ALERTED_SAY : FOLLOW_UP_SOON);
  if (!saved) return atClose("I've logged that and the team will follow up with you.");
  if (severity === "urgent") return atClose(FOLLOW_UP_SOON);
  return atClose(
    saved.routedToAm
      ? "I've logged that and sent it to the asset manager for your building to review. They'll follow up with you about next steps."
      : "I've logged that and the team will match it to your unit and follow up with you.",
  );
}

/**
 * The confirmed-number part of a log_maintenance_request result (confirmed_phone). Only a number the
 * caller said yes to after Sarah read it back is saved; one that cannot be a phone number is refused
 * with a line telling her to ask again. Neither ever fails the request itself. Nothing is texted to
 * the number yet, so no line here mentions a text.
 */
export type ConfirmedPhoneInput = {
  /** Sarah sent confirmed_phone. */
  given: boolean;
  /** It normalised to E.164 (phone.ts toE164). */
  valid: boolean;
  /** confirmed_phone_yes was true: the caller said yes to the read-back. */
  confirmed: boolean;
  /** The request row was saved with the number on it (false when the team was not resolved). */
  stored: boolean;
};

export type ConfirmedPhoneLines =
  | Record<string, never>
  | { confirmed_phone_saved: boolean; confirmed_phone_message: string };

export const CONFIRMED_PHONE_INVALID =
  "That number doesn't look complete; ask the tenant again. Ask for the full 10-digit number, read it back " +
  "digit by digit, and call log_maintenance_request again with it once they say yes. The request itself is logged.";
export const CONFIRMED_PHONE_UNCONFIRMED =
  "Number not saved: the caller has not confirmed it. Read it back digit by digit, wait for their yes, then call " +
  "log_maintenance_request again with it and confirmed_phone_yes true.";
export const CONFIRMED_PHONE_SAVED =
  "Number saved. Do not read it back again and do not say anything will be texted or sent to it.";
export const CONFIRMED_PHONE_NOT_STORED =
  "The request is logged; carry on with the next step. Do not say anything will be texted or sent to this number.";

export function confirmedPhoneLines(i: ConfirmedPhoneInput): ConfirmedPhoneLines {
  const out = (saved: boolean, message: string) => ({ confirmed_phone_saved: saved, confirmed_phone_message: message });
  if (!i.given) return {};
  if (!i.valid) return out(false, CONFIRMED_PHONE_INVALID);
  if (!i.confirmed) return out(false, CONFIRMED_PHONE_UNCONFIRMED);
  if (!i.stored) return out(false, CONFIRMED_PHONE_NOT_STORED);
  return out(true, CONFIRMED_PHONE_SAVED);
}

// --- Where to email photos (send_photo_link) -------------------------------------------------

/**
 * Strict on purpose: only addresses Sarah can dictate unambiguously (letters, digits, dot, dash,
 * underscore and plus before the @; letters, digits and dashes in each domain label). Anything
 * else is never read out, so a mistyped or odd address falls back to PHOTO_SAY. The server uses
 * the same check when an admin saves the address (assetManagers.updateProfile).
 */
const SPEAKABLE_EMAIL_RE = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

/** Shown when an admin saves a photo email Sarah could not read out (client and server alike). */
export const PHOTO_EMAIL_INVALID =
  "Enter a valid photo email address, like goldteam@518propertypro.com. Use only letters, numbers, dots, dashes, underscores or plus signs.";

/** The address lowercased and trimmed when Sarah may read it out, otherwise null. */
export function speakablePhotoEmail(raw: string | null | undefined): string | null {
  const email = (raw ?? "").trim().toLowerCase();
  if (email.length === 0 || email.length > 254 || !SPEAKABLE_EMAIL_RE.test(email)) return null;
  if (email.includes("..")) return null;
  return email;
}

/**
 * Words a mailbox name may be made of to be said as words ("gold team, all one word"). Anything
 * that is not made only of these is spelled letter by letter, because a name such as "ncermak"
 * would otherwise be guessed at by the voice.
 */
const MAILBOX_WORDS = new Set([
  "gold", "silver", "team", "make", "up", "makeup", "photo", "photos", "video", "office", "info",
  "maintenance", "repair", "repairs", "property", "pro", "service", "help", "admin", "rentals",
  "management", "contact", "support",
]);

/** "goldteam" -> ["gold", "team"]; null when it is not made only of MAILBOX_WORDS. */
function mailboxWords(part: string): string[] | null {
  if (!/^[a-z]+$/.test(part)) return null;
  // best[i] = fewest words covering part.slice(0, i)
  const best: Array<string[] | null> = [[]];
  for (let i = 1; i <= part.length; i++) {
    best[i] = null;
    for (let j = 0; j < i; j++) {
      const prev = best[j];
      const word = part.slice(j, i);
      if (prev && MAILBOX_WORDS.has(word) && (!best[i] || prev.length + 1 < best[i]!.length)) best[i] = [...prev, word];
    }
  }
  return best[part.length];
}

const SPOKEN_SYMBOL: Record<string, string> = { ".": "dot", "-": "dash", _: "underscore", "+": "plus" };

/** Letter by letter, capitals so the voice says letter names: "ncermak" -> "N C E R M A K". */
function spell(part: string): string {
  return [...part].map((ch) => SPOKEN_SYMBOL[ch] ?? ch.toUpperCase()).join(" ");
}

/**
 * How Sarah says an address on the phone. Pure and deterministic:
 *   goldteam@518propertypro.com  -> "gold team, all one word, at 518propertypro dot com"
 *   ncermak@518propertypro.com   -> "N C E R M A K at 518propertypro dot com"
 * Returns null for an address that is not speakable (see speakablePhotoEmail).
 */
export function dictateEmail(raw: string | null | undefined): string | null {
  const email = speakablePhotoEmail(raw);
  if (!email) return null;
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).split(".").join(" dot ");
  const words = mailboxWords(local);
  const mailbox = words ? (words.length === 1 ? words[0] : `${words.join(" ")}, all one word,`) : spell(local);
  return `${mailbox} at ${domain}`;
}

export type PhotoReplyLines = {
  say: string;
  /** The plain address Sarah dictated, or null when she gave none (fallback). */
  photo_email: string | null;
  /** Only with an address: what to say if the caller asks to hear it again. */
  repeat_line?: string;
  message: string;
};

/**
 * The spoken part of a send_photo_link result. With the property's photo address (the unit's asset
 * manager's photoEmail) Sarah dictates it and asks for name and unit in the email; without one
 * (unmatched caller, no unit, no address set, or an address that cannot be spoken) she says
 * PHOTO_SAY and never makes an address up.
 */
export function photoReplyLines(photoEmail: string | null | undefined): PhotoReplyLines {
  const email = speakablePhotoEmail(photoEmail);
  const spoken = dictateEmail(email);
  if (!email || !spoken) {
    return {
      say: PHOTO_SAY,
      photo_email: null,
      message: `Say the say line once. Do not give an email address or make one up. ${WAIT_FOR_CALLER}`,
    };
  }
  return {
    say: `Please email them to ${spoken}, with your name and unit number. Want me to repeat that?`,
    photo_email: email,
    repeat_line: `Sure. It's ${spoken}.`,
    message:
      "Say the say line once, word for word, then wait for their answer. If they want the address again, say " +
      "repeat_line once, word for word, then carry on. Never say any other email address and never change this one. " +
      WAIT_FOR_CALLER,
  };
}
