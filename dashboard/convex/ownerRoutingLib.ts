/**
 * Owner call routing (Sarah Configuration section 13): the pure rules behind the phone menu that
 * puts an EXISTING property owner through to a staff member. Pure (only phone.ts is imported) so the
 * /sarah editor, the save mutations, the prompt composer, the agent push and the mid-call tool all
 * use one set of rules.
 *
 *   - Hours: a small parseable format in America/New_York, e.g. "Mon-Fri 09:00-17:00; Sat 10:00-14:00".
 *     Empty means no restriction (Sarah may put the caller through at any time). An end time at or
 *     before the start time runs overnight into the next day ("Fri 22:00-02:00").
 *   - Numbers: a transfer needs a real, dialable E.164 number. An extension goes in its own field and
 *     is dialled after the call connects (ElevenLabs post_dial_digits, native Twilio numbers only).
 *   - Keys: the key is the entry's position in the directory (1 = first). Entries without a number
 *     keep their key but are never transferred to: Sarah takes a message for them instead.
 */

import { toE164 } from "./phone";

export const ROUTING_TIME_ZONE = "America/New_York";
/** Keys 1 to 9 on a phone keypad. */
export const MAX_ROUTING_ENTRIES = 9;
export const MAX_RULES_PER_ENTRY = 14;
export const MAX_ROUTING_TEXT = 1000;

/** Monday first, matching how people write office hours. Index 0 = Monday ... 6 = Sunday. */
export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** A prefix on every staff-message callback row, so the unmatched-caller upsert never overwrites one. */
export const STAFF_MESSAGE_PREFIX = "Message for ";

export type HoursRule = { days: number[]; start: string; end: string };

// --- Hours -------------------------------------------------------------------------------------

const START_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const END_TIME = /^(([01]\d|2[0-3]):([0-5]\d)|24:00)$/;

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function dayIndex(token: string): number {
  const t = token.trim().slice(0, 3).toLowerCase();
  return DAY_NAMES.findIndex((d) => d.toLowerCase() === t);
}

function parseDays(spec: string): number[] | null {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const p = part.trim();
    if (!p) return null;
    const range = p.split("-");
    if (range.length === 1) {
      const d = dayIndex(range[0]);
      if (d < 0 || range[0].trim().length < 3) return null;
      out.add(d);
    } else if (range.length === 2) {
      const a = dayIndex(range[0]);
      const b = dayIndex(range[1]);
      if (a < 0 || b < 0) return null;
      // A range can wrap the week ("Sat-Mon").
      for (let d = a; ; d = (d + 1) % 7) {
        out.add(d);
        if (d === b) break;
      }
    } else {
      return null;
    }
  }
  return out.size ? [...out].sort((x, y) => x - y) : null;
}

/**
 * Parses stored hours. Empty (or null) is [] = no restriction. Anything that is not exactly the
 * format the editor writes is null, so a free-text value is never guessed at.
 */
export function parseHours(raw: string | null | undefined): HoursRule[] | null {
  const s = (raw ?? "").trim();
  if (!s) return [];
  const parts = s.split(";").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > MAX_RULES_PER_ENTRY) return null;
  const rules: HoursRule[] = [];
  for (const part of parts) {
    const m = /^([A-Za-z][A-Za-z,\- ]*?)\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/.exec(part);
    if (!m) return null;
    const days = parseDays(m[1]);
    if (!days) return null;
    const [, , start, end] = m;
    if (!START_TIME.test(start) || !END_TIME.test(end)) return null;
    if (toMinutes(start) === toMinutes(end)) return null;
    rules.push({ days, start, end });
  }
  return rules;
}

function formatDays(days: number[]): string {
  const sorted = [...new Set(days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    runs.push(j > i ? `${DAY_NAMES[sorted[i]]}-${DAY_NAMES[sorted[j]]}` : DAY_NAMES[sorted[i]]);
    i = j + 1;
  }
  return runs.join(",");
}

/** The canonical stored form. formatHours(parseHours(x)) is stable. */
export function formatHours(rules: HoursRule[]): string {
  return rules
    .filter((r) => r.days.length > 0)
    .map((r) => `${formatDays(r.days)} ${r.start}-${r.end}`)
    .join("; ");
}

function clock(t: string): string {
  const mins = toMinutes(t) % (24 * 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function describeDays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return "Every day";
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    runs.push(j - i >= 2 ? `${DAY_LONG[sorted[i]]} to ${DAY_LONG[sorted[j]]}` : sorted.slice(i, j + 1).map((d) => DAY_LONG[d]).join(", "));
    i = j + 1;
  }
  return runs.join(", ");
}

/** "Monday to Friday, 9:00 AM to 5:00 PM". For the editor and the say lines. */
export function describeHours(rules: HoursRule[]): string {
  if (rules.length === 0) return "Any time";
  return rules
    .map((r) => {
      const midnight = r.end === "24:00" || r.end === "00:00";
      const overnight = !midnight && toMinutes(r.end) <= toMinutes(r.start);
      return `${describeDays(r.days)}, ${clock(r.start)} to ${midnight ? "midnight" : clock(r.end)}${overnight ? " (next day)" : ""}`;
    })
    .join("; ");
}

/** Day of the week (0 = Monday) and minutes since local midnight, in `timeZone`. */
export function localDayAndMinutes(ms: number, timeZone: string = ROUTING_TIME_ZONE): { day: number; minutes: number } {
  let weekday = "";
  let hour = 0;
  let minute = 0;
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(ms)) {
    if (p.type === "weekday") weekday = p.value;
    else if (p.type === "hour") hour = Number(p.value) % 24;
    else if (p.type === "minute") minute = Number(p.value);
  }
  return { day: dayIndex(weekday), minutes: hour * 60 + minute };
}

/**
 * Whether `ms` falls inside the hours, in America/New_York (DST included, since the local clock
 * comes from Intl). No rules = always. An overnight rule belongs to the day it starts on.
 */
export function isWithinHours(rules: HoursRule[], ms: number, timeZone: string = ROUTING_TIME_ZONE): boolean {
  if (rules.length === 0) return true;
  const { day, minutes } = localDayAndMinutes(ms, timeZone);
  const yesterday = (day + 6) % 7;
  for (const r of rules) {
    const s = toMinutes(r.start);
    const e = toMinutes(r.end);
    if (e > s) {
      if (r.days.includes(day) && minutes >= s && minutes < e) return true;
    } else {
      if (r.days.includes(day) && minutes >= s) return true;
      if (r.days.includes(yesterday) && minutes < e) return true;
    }
  }
  return false;
}

// --- Numbers -----------------------------------------------------------------------------------

/**
 * A number Sarah can transfer to, as E.164, or null. Stricter than toE164 for North America: a
 * real area code and exchange (no 0/1 start, no N11 such as 911 or 411).
 */
export function dialableNumber(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s || /[a-z]/i.test(s)) return null;
  const e164 = toE164(s);
  if (!e164) return null;
  if (e164.startsWith("+1")) {
    const m = /^\+1([2-9]\d{2})([2-9]\d{2})\d{4}$/.exec(e164);
    if (!m) return null;
    if (/^[2-9]11$/.test(m[1]) || /^[2-9]11$/.test(m[2])) return null;
  }
  return e164;
}

/** Digits of an extension ("ext. 204" -> "204"), "" when empty, null when not an extension. */
export function normalizeExtension(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().replace(/^(ext\.?|extension|x|#)\s*/i, "");
  if (!s) return "";
  return /^\d{1,8}$/.test(s) ? s : null;
}

/** What Twilio dials after the transfer connects: a one-second pause, then the extension. */
export function postDialDigits(extension: string): string {
  return `ww${extension}`;
}

/** Last four digits, for messages that must not echo a whole number. */
function last4(e164: string): string {
  return e164.replace(/\D/g, "").slice(-4);
}

// --- Labels ------------------------------------------------------------------------------------

/** The role in brackets, if the client wrote one: "Delia (Accounting)" -> "Accounting". */
export function roleOf(label: string): string | null {
  const m = /\(([^)]+)\)/.exec(label);
  return m ? m[1].trim() || null : null;
}

/** The name without the bracketed role: "Delia (Accounting)" -> "Delia". */
export function nameOf(label: string): string {
  return label.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim() || label.trim();
}

/** How Sarah says it, in the client's own words: "Delia (Accounting)" -> "Delia in Accounting". */
export function spokenName(label: string): string {
  const role = roleOf(label);
  return role ? `${nameOf(label)} in ${role}` : nameOf(label);
}

function firstName(label: string): string {
  return nameOf(label).split(" ")[0] || nameOf(label);
}

// --- The directory as edited and validated -----------------------------------------------------

export type RoutingEntryInput = {
  label: string;
  phone: string;
  extension?: string | null;
  hours?: string | null;
  userId?: string | null;
};

export type RoutingInput = {
  enabled: boolean;
  entries: RoutingEntryInput[];
  mainOfficeNumber?: string | null;
  fallback?: string | null;
  afterHours?: string | null;
};

/** `field` is "enabled", "mainOfficeNumber", "fallback", "afterHours", "entries" or "entries.<i>.<label|phone|extension|hours>". */
export type RoutingProblem = { field: string; message: string };

export type RoutingCheckOptions = {
  /** Sarah's own phone line(s). A transfer there rings straight back to her. */
  ownLines?: Array<string | null | undefined>;
};

/**
 * Every problem with a routing directory, each tied to the field it belongs to, in the order the
 * editor shows them. The client and the server run this same function, so their messages match.
 */
export function routingProblems(d: RoutingInput, opts: RoutingCheckOptions = {}): RoutingProblem[] {
  const out: RoutingProblem[] = [];
  const own = (opts.ownLines ?? []).map((n) => dialableNumber(n)).filter((n): n is string => !!n);
  const main = dialableNumber(d.mainOfficeNumber);

  if ((d.mainOfficeNumber ?? "").trim() && !main) {
    out.push({ field: "mainOfficeNumber", message: "Main office number: enter a full 10-digit number, like 518-555-0100." });
  }
  if (d.entries.length > MAX_ROUTING_ENTRIES) {
    out.push({ field: "entries", message: `The menu can have at most ${MAX_ROUTING_ENTRIES} people, one per key from 1 to 9.` });
  }

  let dialable = 0;
  d.entries.forEach((e, i) => {
    const label = e.label.trim();
    const who = label || `Key ${i + 1}`;
    const first = label ? firstName(label) : "this person";
    const f = (k: string) => `entries.${i}.${k}`;
    if (!label) out.push({ field: f("label"), message: `Key ${i + 1} needs a name.` });
    else if (label.length > 100) out.push({ field: f("label"), message: `${who}: the name can be at most 100 characters.` });

    const phoneRaw = e.phone.trim();
    const phone = dialableNumber(phoneRaw);
    if (phoneRaw && !phone) {
      const looksLikeExt = /^(ext\.?|extension|x|#)/i.test(phoneRaw) || phoneRaw.replace(/\D/g, "").length <= 6;
      out.push({
        field: f("phone"),
        message: looksLikeExt
          ? `${who}: enter the full phone number to dial, like 518-555-0123, and put the extension in the Extension field.`
          : `${who}: "${phoneRaw.slice(0, 30)}" is not a phone number Sarah can dial. Use a full 10-digit number, like 518-555-0123.`,
      });
    } else if (phone) {
      if (own.includes(phone)) {
        out.push({
          field: f("phone"),
          message: `${who}: that is Sarah's own phone line (ending ${last4(phone)}). A transfer there would ring straight back to Sarah. Enter ${first}'s direct number.`,
        });
      } else if (main && phone === main) {
        out.push({
          field: f("phone"),
          message: `${who}: that is the main office number, which forwards to Sarah. A transfer there would loop back to her. Enter ${first}'s direct number.`,
        });
      } else {
        // Several people may share one number (a test setup, or a shared desk line): Sarah picks who
        // to put through by the person, and the transfer number comes from check_staff_availability.
        // routingWarnings says so on the editor and in the missing-items list.
        dialable++;
      }
    }

    const ext = normalizeExtension(e.extension);
    if (ext === null) {
      out.push({ field: f("extension"), message: `${who}: the extension can only be digits, like 204 (up to 8 digits).` });
    } else if (ext && !phoneRaw) {
      out.push({ field: f("extension"), message: `${who}: add the phone number to dial before the extension.` });
    }

    if ((e.hours ?? "").trim() && parseHours(e.hours) === null) {
      out.push({ field: f("hours"), message: `${who}: the hours could not be read. Set them with the day and time controls.` });
    } else {
      const rules = parseHours(e.hours) ?? [];
      if (rules.some((r) => r.days.length === 0)) {
        out.push({ field: f("hours"), message: `${who}: pick at least one day for each set of hours.` });
      }
    }
  });

  if ((d.fallback ?? "").length > MAX_ROUTING_TEXT) {
    out.push({ field: "fallback", message: `"If nobody answers" can be at most ${MAX_ROUTING_TEXT} characters.` });
  }
  if ((d.afterHours ?? "").length > MAX_ROUTING_TEXT) {
    out.push({ field: "afterHours", message: `"After hours" can be at most ${MAX_ROUTING_TEXT} characters.` });
  }
  if (d.enabled && dialable === 0) {
    out.push({
      field: "enabled",
      message: "Add a phone number for at least one person before switching the routing directory on.",
    });
  }
  return out;
}

/** "+17542795559" -> "+1 754-279-5559", for messages. */
export function displayNumber(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+1 ${m[1]}-${m[2]}-${m[3]}` : e164;
}

/**
 * Things that are allowed but should not reach production unnoticed. Today: several people sharing
 * one number (the B36 test setup puts every person on one spare phone). Shown on the routing editor
 * and in the "Missing from Pat" list; never blocks a save.
 */
export function routingWarnings(d: Pick<RoutingInput, "entries">): string[] {
  const byPhone = new Map<string, string[]>();
  for (const [i, e] of d.entries.slice(0, MAX_ROUTING_ENTRIES).entries()) {
    const phone = dialableNumber(e.phone);
    if (!phone) continue;
    byPhone.set(phone, [...(byPhone.get(phone) ?? []), e.label.trim() || `Key ${i + 1}`]);
  }
  const out: string[] = [];
  for (const [phone, who] of byPhone) {
    if (who.length < 2) continue;
    out.push(
      `Test setup: ${who.length === d.entries.length ? "everyone in the menu shares" : `${who.join(", ")} share`} one number (${displayNumber(phone)}). Replace with real numbers before production.`,
    );
  }
  return out;
}

/**
 * Tidies a directory for storage: trimmed names, numbers as E.164 when they are dialable (left as
 * typed otherwise, so the validation message can quote them), extensions as digits, hours in the
 * canonical form. Optional fields that are empty are dropped.
 */
export function normalizeRoutingEntry<E extends RoutingEntryInput>(e: E): E {
  const phone = e.phone.trim();
  const ext = normalizeExtension(e.extension);
  const rules = parseHours(e.hours);
  const hours = rules === null ? (e.hours ?? "").trim() : formatHours(rules);
  const next: RoutingEntryInput = {
    ...e,
    label: e.label.trim(),
    phone: dialableNumber(phone) ?? phone,
  };
  delete next.extension;
  delete next.hours;
  delete next.userId;
  const extension = ext === null ? (e.extension ?? "").trim() : ext;
  if (extension) next.extension = extension;
  if (hours) next.hours = hours;
  if (e.userId) next.userId = e.userId;
  return next as E;
}

// --- The menu on a live call -------------------------------------------------------------------

export type MenuEntry = {
  /** The keypad key: the entry's position in the directory, from 1. */
  key: number;
  label: string;
  /** "Delia in Accounting". */
  spoken: string;
  role: string | null;
  /** E.164, or null when this person cannot be put through by phone. */
  phone: string | null;
  extension: string | null;
  rules: HoursRule[];
  userId: string | null;
};

/** Every directory entry with its key. `blocked` numbers (Sarah's own line, the main office) are never dialled. */
export function menuOf(d: RoutingInput, blocked: Array<string | null | undefined> = []): MenuEntry[] {
  const stop = new Set(blocked.map((n) => dialableNumber(n)).filter((n): n is string => !!n));
  const main = dialableNumber(d.mainOfficeNumber);
  if (main) stop.add(main);
  return d.entries.slice(0, MAX_ROUTING_ENTRIES).map((e, i) => {
    let phone = dialableNumber(e.phone);
    if (phone && stop.has(phone)) phone = null;
    const ext = normalizeExtension(e.extension);
    return {
      key: i + 1,
      label: e.label.trim(),
      spoken: spokenName(e.label),
      role: roleOf(e.label),
      phone,
      extension: phone && ext ? ext : null,
      rules: parseHours(e.hours) ?? [],
      userId: e.userId || null,
    };
  });
}

const NUMBER_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

function keyFrom(text: string): number | null {
  const m = /^(?:press|key|number|option|extension)?\s*([1-9])$/.exec(text);
  if (m) return Number(m[1]);
  const w = /^(?:press|key|number|option)?\s*([a-z]+)$/.exec(text);
  if (w) {
    const i = NUMBER_WORDS.indexOf(w[1]);
    if (i >= 0) return i + 1;
  }
  return null;
}

/** The person a caller asked for: a key ("3", "press three"), a name ("Nina", "Pat Fiore") or a role ("accounting"). */
export function findMenuEntry(menu: MenuEntry[], person: string): MenuEntry | null {
  const text = person.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const key = keyFrom(text);
  if (key !== null) return menu.find((m) => m.key === key) ?? null;

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const unique = (list: MenuEntry[]) => (list.length === 1 ? list[0] : null);
  const exact = menu.filter((m) => norm(m.label) === text || norm(m.spoken) === text || norm(nameOf(m.label)) === text);
  if (exact.length) return unique(exact);
  const words = new Set(text.split(" "));
  const byName = menu.filter((m) => norm(nameOf(m.label)).split(" ").some((w) => w.length > 1 && words.has(w)));
  if (byName.length) return unique(byName);
  // A role, matched loosely so "accounts" or "the accounting department" reach "Accounting".
  const byRole = menu.filter((m) => {
    if (!m.role) return false;
    const r = norm(m.role);
    return [...words].some((w) => w.length >= 4 && (r.startsWith(w.slice(0, 5)) || w.startsWith(r.slice(0, 5))));
  });
  return unique(byRole);
}

export type AvailabilityStatus = "available" | "after_hours" | "no_number" | "not_found";

export type AvailabilityResult = {
  status: AvailabilityStatus;
  entry: MenuEntry | null;
  /** What Sarah says next. For "available" it is the transfer's client message. */
  say: string;
};

function sentence(s: string | null | undefined): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** The people who can be put through, as Sarah would list them: "Pat Fiore, Nina or Delia in Accounting". */
export function reachableList(menu: MenuEntry[]): string {
  const names = menu.filter((m) => m.phone).map((m) => m.spoken);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/**
 * The phone menu Sarah reads to an existing owner, in the client's wording (Sarah Configuration
 * section 13), in directory order and only for people with a number. Keys stay the directory
 * position, so a gap is possible ("Press 1 for Pat Fiore. Press 4 for Nina. Or you can just say the name.").
 * One short sentence per option, so the voice pauses between them. "" when nobody can be reached.
 */
export function spokenMenu(menu: MenuEntry[]): string {
  const items = menu.filter((m) => m.phone).map((m) => `Press ${m.key} for ${m.spoken}.`);
  if (items.length === 0) return "";
  return `${items.join(" ")} Or you can just say the name.`;
}

/**
 * Decides, from the directory and the clock (never the model), whether the person can be put
 * through right now, and what Sarah says.
 */
export function availabilityOf(
  menu: MenuEntry[],
  person: string,
  nowMs: number,
  texts: { fallback?: string | null; afterHours?: string | null } = {},
): AvailabilityResult {
  const entry = findMenuEntry(menu, person);
  if (!entry) {
    const list = reachableList(menu);
    return {
      status: "not_found",
      entry: null,
      say: list ? `Who would you like to reach? I can put you through to ${list}.` : "Who would you like to reach?",
    };
  }
  const first = firstName(entry.label);
  if (!entry.phone) {
    return {
      status: "no_number",
      entry,
      say: `${entry.spoken} isn't available by phone right now. I can take a message and pass it on to ${first}.`,
    };
  }
  if (!isWithinHours(entry.rules, nowMs)) {
    const custom = sentence(texts.afterHours);
    return {
      status: "after_hours",
      entry,
      say: custom
        ? `${custom} I can take a message and pass it on to ${first}.`
        : `${first} isn't available right now. I can take a message and pass it on.`,
    };
  }
  const tail = sentence(texts.fallback);
  return { status: "available", entry, say: `I'll put you through to ${entry.spoken} now.${tail ? ` ${tail}` : ""}` };
}

// --- The gate ----------------------------------------------------------------------------------

export type StaffCheck = {
  status: AvailabilityStatus | "menu_off" | "verify_first";
  label: string | null;
  key: number | null;
  /** E.164 only when status is "available", and so only for a verified owner. */
  transferNumber: string | null;
  /** Post-dial digits for the transfer: "ww<ext>", or a bare pause when there is no extension. */
  transferDigits: string;
  say: string;
};

export const MENU_OFF_SAY = "I can take a message and pass it on to the team.";

/**
 * What check_staff_availability answers. `menu` is null while the menu is off. `verified` is whether
 * this call has a verified owner (ownerVerifyLib.hasLiveVerification). Without it: verify_first, no
 * number, and not even whether the person is in.
 */
export function staffCheck(
  menu: MenuEntry[] | null,
  verified: boolean,
  person: string,
  nowMs: number,
  texts: { fallback?: string | null; afterHours?: string | null } = {},
): StaffCheck {
  const none = NO_EXTENSION_DIGITS;
  if (!menu) return { status: "menu_off", label: null, key: null, transferNumber: null, transferDigits: none, say: MENU_OFF_SAY };
  if (!verified) {
    const entry = findMenuEntry(menu, person);
    return { status: "verify_first", label: entry?.label ?? null, key: entry?.key ?? null, transferNumber: null, transferDigits: none, say: "" };
  }
  const r = availabilityOf(menu, person, nowMs, texts);
  const t = transferAssignmentValues(r.status === "available" ? r.entry : null);
  return {
    status: r.status,
    label: r.entry?.label ?? null,
    key: r.entry?.key ?? null,
    transferNumber: r.status === "available" ? (r.entry?.phone ?? null) : null,
    transferDigits: t.digits,
    say: r.say,
  };
}

// --- The ElevenLabs transfer tool --------------------------------------------------------------

/**
 * How the transfer destination is configured on ElevenLabs.
 *
 *   "static" (used): one rule per number, which the model could pick without the check. The gate is
 *   the prompt, the verify_first refusal in check_staff_availability and the post-call flag on
 *   unverified transfers.
 *   "dynamic" (DO NOT USE without a conversation-initiation webhook): ONE transfer rule whose
 *   destination is the dynamic variable OWNER_TRANSFER_VAR, set by check_staff_availability's
 *   assignments. It failed every real Twilio call (2026-11-03, config v23, e.g.
 *   conv_7201m6gqmsy1f6q9cn5avy9k520b): at the first LLM turn ElevenLabs ended the call with 1008
 *   agent_configuration_error "Dynamic variable '{{owner_transfer_number}}' is not available".
 *   dynamic_variable_placeholders are NOT applied on phone calls (only system__* variables exist),
 *   so the variable must be supplied at call start by the conversation-initiation webhook.
 */
export const TRANSFER_DESTINATION_MODE: "dynamic" | "static" = "static";
/** Dynamic variables check_staff_availability assigns (see ROUTING_TOOL_DEFS in agents.ts). */
export const OWNER_TRANSFER_VAR = "owner_transfer_number";
export const OWNER_TRANSFER_DIGITS_VAR = "owner_transfer_digits";
/** What the variables hold until a verified check sets them, and after any refusal. Not dialable. */
export const NO_TRANSFER_NUMBER = "none";
/** A half-second pause: the post-dial digits for someone with no extension (a no-op on the line). */
export const NO_EXTENSION_DIGITS = "w";

/** The values check_staff_availability returns for the two variables. Always both, so a refusal resets them. */
export function transferAssignmentValues(entry: Pick<MenuEntry, "phone" | "extension"> | null): { number: string; digits: string } {
  if (!entry?.phone) return { number: NO_TRANSFER_NUMBER, digits: NO_EXTENSION_DIGITS };
  return { number: entry.phone, digits: entry.extension ? postDialDigits(entry.extension) : NO_EXTENSION_DIGITS };
}

/** Defaults for the agent, so the variables exist from the first second of every call. Only sent while the menu is live. */
export function transferPlaceholders(): Record<string, string> {
  return { [OWNER_TRANSFER_VAR]: NO_TRANSFER_NUMBER, [OWNER_TRANSFER_DIGITS_VAR]: NO_EXTENSION_DIGITS };
}

export type TransferRule = {
  transfer_destination: { type: "phone"; phone_number: string } | { type: "phone_dynamic_variable"; phone_number: string };
  condition: string;
  transfer_type: "blind";
  post_dial_digits?: { type: "static"; value: string } | { type: "dynamic"; value: string };
};

/** The transfer rule(s) for the people with a dialable number, or [] when nobody can be put through. */
export function transferRules(menu: MenuEntry[], mode: "dynamic" | "static" = TRANSFER_DESTINATION_MODE): TransferRule[] {
  const reachable = menu.filter((m): m is MenuEntry & { phone: string } => !!m.phone);
  if (reachable.length === 0) return [];
  if (mode === "dynamic") {
    return [
      {
        transfer_destination: { type: "phone_dynamic_variable" as const, phone_number: `{{${OWNER_TRANSFER_VAR}}}` },
        condition:
          "An existing property owner was verified by verify_owner in this call, asked for a staff member, and " +
          "check_staff_availability then returned available in this call. Never for a tenant, a prospect or anyone else.",
        transfer_type: "blind" as const,
        ...(reachable.some((m) => m.extension)
          ? { post_dial_digits: { type: "dynamic" as const, value: `{{${OWNER_TRANSFER_DIGITS_VAR}}}` } }
          : {}),
      },
    ];
  }
  // Static fallback: one rule per distinct number (people sharing one number share its rule).
  const byPhone = new Map<string, Array<MenuEntry & { phone: string }>>();
  for (const m of reachable) byPhone.set(m.phone, [...(byPhone.get(m.phone) ?? []), m]);
  return [...byPhone.values()].map((group) => {
    const m = group[0];
    const who = group.map((g) => `${g.spoken} (menu key ${g.key}${g.role ? `, ${g.role}` : ""})`).join(" or ");
    return {
      transfer_destination: { type: "phone" as const, phone_number: m.phone },
      condition:
        `An existing property owner was verified by verify_owner in this call, asked for ${who}, and ` +
        `check_staff_availability returned available with this transfer_number in this call. Never for a tenant, a prospect or anyone else.`,
      transfer_type: "blind" as const,
      ...(m.extension ? { post_dial_digits: { type: "static" as const, value: postDialDigits(m.extension) } } : {}),
    };
  });
}

/**
 * The transfer_to_number system tool, or null when nobody can be put through (then the agent gets
 * no transfer tool at all). Blind transfer: the call is handed to Twilio and Sarah leaves it.
 */
export function transferToolConfig(menu: MenuEntry[], mode: "dynamic" | "static" = TRANSFER_DESTINATION_MODE) {
  const transfers = transferRules(menu, mode);
  if (transfers.length === 0) return null;
  return {
    type: "system" as const,
    name: "transfer_to_number",
    description:
      "Puts a VERIFIED existing property owner through to the staff member they asked for. Only after " +
      "verify_owner returned verified and then check_staff_availability returned available in this call: use its " +
      "transfer_number exactly, and its say line as client_message. Never for tenants, prospects, vendors or anyone else.",
    pre_tool_speech: "off" as const,
    params: {
      system_tool_type: "transfer_to_number" as const,
      transfers,
      enable_client_message: true,
    },
  };
}

// --- Our own Twilio transfer (TRANSFER_MECHANISM "twilio_dial") ------------------------------------

/**
 * Who dials the staff member.
 *
 *   "twilio_dial" (used): Sarah calls the transfer_owner_call webhook. The server re-checks the
 *   verification and availability, then (after OWNER_TRANSFER_DELAY_MS, so Sarah finishes her line)
 *   updates the live Twilio call with our own <Dial>: Sarah's Twilio number as caller ID, a ring
 *   timeout and an action URL. Busy, no answer or failure comes back to /twilio/owner-transfer-result,
 *   which keeps the caller on the line and takes a voicemail for that staff member. The caller is
 *   never just cut off. The agent has no transfer_to_number tool in this mode.
 *   "elevenlabs_system": ElevenLabs' transfer_to_number system tool (blind). Its <Dial> has no action
 *   URL and passes the caller's own number as caller ID, so a busy or unanswered staff phone ends the
 *   call: conv_3301m6gssbv6f2r90ckc39g787f5 (2026-11-03) dialled +1517... from the caller's number, the
 *   leg came back "busy" in 0 s without ringing, and Twilio hung up on the owner. ElevenLabs has no
 *   fallback setting for a failed transfer (conference transfer included), so do not go back to it.
 */
export const TRANSFER_MECHANISM: "twilio_dial" | "elevenlabs_system" = "twilio_dial";
/** How long after transfer_owner_call returns before the call is handed to Twilio (Sarah's say line). */
export const OWNER_TRANSFER_DELAY_MS = 5000;
/** How long the staff phone rings before the caller is offered voicemail. */
export const OWNER_DIAL_TIMEOUT_SECS = 20;
export const OWNER_VOICEMAIL_MAX_SECS = 120;
/** A Twilio voice call SID ({{system__call_sid}}). Anything else is never sent to Twilio. */
export const CALL_SID_RE = /^CA[0-9a-f]{32}$/;
const TWIML_VOICE = "Polly.Joanna";

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** A spoken name without the role in brackets: "Pat Fiore (Owner)" -> "Pat Fiore". */
export function spokenStaffName(label: string | null | undefined): string {
  const name = (label ?? "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  return name || "the team";
}

/**
 * The TwiML that rings the staff member. Caller ID is Sarah's own Twilio number (a number on the
 * account, so carriers do not treat it as spoofed). `digits` is check_staff_availability's
 * transfer_digits: sent after answer only when it holds a real extension, not the bare pause.
 */
export function ownerDialTwiml(o: { number: string; digits: string; callerId: string; actionUrl: string; timeoutSecs?: number }): string {
  const send = /[0-9*#]/.test(o.digits) ? ` sendDigits="${xmlEscape(o.digits)}"` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Dial callerId="${xmlEscape(o.callerId)}" timeout="${o.timeoutSecs ?? OWNER_DIAL_TIMEOUT_SECS}" action="${xmlEscape(o.actionUrl)}" method="POST">` +
    `<Number${send}>${xmlEscape(o.number)}</Number></Dial></Response>`
  );
}

/** Whether a <Dial> action's DialCallStatus means the staff member's phone picked up. */
export function dialAnswered(dialCallStatus: string | null | undefined): boolean {
  return dialCallStatus === "completed" || dialCallStatus === "answered";
}

/** After an answered transfer ends: nothing more to do. */
export function hangupTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`;
}

/**
 * The staff phone did not pick up (busy, no answer, failed): the caller stays on the line and can
 * leave a voicemail for that person. If they say nothing, they hear a closing line, not a dead line.
 */
export function ownerTransferFallbackTwiml(o: { label: string | null; voicemailUrl: string }): string {
  const who = xmlEscape(spokenStaffName(o.label));
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Say voice="${TWIML_VOICE}">I'm sorry, ${who} couldn't take your call right now. Please leave your name, the best number to call you back on, and your message after the tone, and they'll get back to you.</Say>` +
    `<Record maxLength="${OWNER_VOICEMAIL_MAX_SECS}" timeout="6" playBeep="true" action="${xmlEscape(o.voicemailUrl)}" method="POST"/>` +
    `<Say voice="${TWIML_VOICE}">I didn't catch a message. ${who} will see that you called. Thank you for calling, goodbye.</Say>` +
    `<Hangup/></Response>`
  );
}

/** After the voicemail was recorded. */
export function ownerVoicemailThanksTwiml(label: string | null): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Say voice="${TWIML_VOICE}">Thank you. Your message is saved for ${xmlEscape(spokenStaffName(label))}. Goodbye.</Say>` +
    `<Hangup/></Response>`
  );
}

// --- The prompt --------------------------------------------------------------------------------

/**
 * Where verify_owner's address comes from (prompt and tool description, word for word). A real call
 * (conv_5201m6gvmsxafxssy2xrjzjgxten, 2026-11-03) sent an address the caller never said, copied
 * from an example in the tool description.
 */
export const OWNER_ADDRESS_RULE =
  "spoken_property_address is ONLY the address the caller said in this call. Never fill it from an " +
  "example, a previous call, or a guess. If they haven't said one, ask first.";

/** The OWNER CALL ROUTING section. Only composed while the menu is live and someone can be reached. */
export function composeOwnerRoutingBlock(menu: MenuEntry[], company: string): string {
  const other = menu.filter((m) => !m.phone && m.label);
  return `OWNER CALL ROUTING (existing property owners only; the one exception to "do not connect anyone"):
Use this only once the caller has said they own a property that ${company} manages. Tenants,
prospects, vendors and everyone else never hear about it and are never put through: follow their
usual flow, and if they ask for a staff member, take a message the usual way. An owner who wants
${company} to manage a property is a prospect: route_owner_prospect, as before.
The phone menu, word for word, ONLY after verify_owner returned verified: "${spokenMenu(menu)}"${
    other.length ? `\nNot reachable by phone (take a message): ${other.map((m) => `${m.key}: ${m.spoken}`).join(", ")}.` : ""
  }
Read the menu at a calm pace, one option at a time; don't rush it.
Order, one step per turn: property, name, email, verify, menu, availability, transfer. If they name
who they want early, remember it.
1. Ask which property they own with ${company}. Call verify_owner with that address only, ask its
   say line and wait for a yes. Its address options are read back as one question, like find_unit's.
   ${OWNER_ADDRESS_RULE}
2. Ask their name. It is optional: if they would rather not say, move on. Never used to verify.
3. Ask for the email address on file for that property. Read back what you heard in spoken form
   ("j, s, m, i, t, h, at gmail dot com. Is that right?") and let them correct it. An email read-back
   follows the same confirm-before-use rule as phone numbers (rule 8).
4. Call verify_owner with the confirmed address and email (and caller_name, if given). It decides,
   never you. not_verified: say its say line, read the new email back, then call it again.
   no_match_take_message: say its say line, then step 8, with no menu. Never say which part failed,
   and never say or hint at any email on file.
5. Only after verify_owner returned verified: if they already named who they want, confirm it ("You
   wanted Pat Fiore, right?") or go to step 6 (rule 4). Otherwise read the phone menu as one turn,
   then stop and wait. Never read it twice in a call unless asked.
6. They may say a name, a role ("accounting") or press a key. A single keypad digit after the menu
   is that key. Digits before verify_owner returned verified are not a property, a key or a yes:
   say you'll take them to the menu once they're verified, then ask for the property. Call
   check_staff_availability with who they asked for. Never decide availability yourself.
${
    TRANSFER_MECHANISM === "twilio_dial"
      ? `7. If it returns available, call transfer_owner_call with the same person straight away, then say
   its say line and nothing else. If it does not return connecting, say its say line and go to step 8.
   If the caller talks to you again after it returned connecting, the transfer did not go through:
   say sorry, then step 8.`
      : `7. If it returns available, call transfer_to_number with its transfer_number, client_message set to
   its say line, and a one-sentence agent_message. Say nothing else.`
  }
8. Otherwise say its say line, then take a message: their name, the best callback number (rule 8),
   and what it is about, one question each, skipping what they already said. Call
   take_staff_message (person: who they wanted, else "the team"), then say its say line.
If verify_owner, check_staff_availability or the transfer fails, errors or gives no answer, never end
the call: say you can take a message instead, then step 8.
Never transfer anyone verify_owner did not verify in this call. Never give a staff member's number,
never promise they will pick up, and never offer "press 0".`;
}
