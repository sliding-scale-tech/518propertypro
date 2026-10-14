/**
 * Tour scheduling rules and time-zone arithmetic. Pure functions, no Convex imports, so the
 * same rules run in the booking webhook, the Availability page and a quick local check.
 *
 * All instants are epoch milliseconds (UTC). "Local" always means the team's time zone, which
 * an admin sets — a tour at "2pm" is 2pm where the property is, not where the server runs.
 */

export const TOUR_MINUTES = 45;
// Kept clear on BOTH sides of a tour, so a 45-minute tour needs a 75-minute gap in the calendar.
export const BUFFER_MINUTES = 15;
// Offered times fall on the hour and half hour: easy to say out loud, easy to remember.
export const SLOT_STEP_MINUTES = 30;
// Nobody gets booked for a tour starting in ten minutes.
export const MIN_LEAD_MINUTES = 120;

const MINUTE = 60 * 1000;
export const TOUR_MS = TOUR_MINUTES * MINUTE;
export const BUFFER_MS = BUFFER_MINUTES * MINUTE;

/** day: 0 = Sunday … 6 = Saturday, matching Date.getUTCDay(). Times are "HH:MM", 24-hour. */
export type DayHours = { day: number; start: string; end: string };
export type Interval = { start: number; end: number };

export const DEFAULT_WEEKLY_HOURS: DayHours[] = [1, 2, 3, 4, 5].map((day) => ({
  day,
  start: "09:00",
  end: "17:00",
}));

// --- Validation -------------------------------------------------------------

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Throws a message fit to show a person, or returns the hours sorted by day. */
export function validateWeeklyHours(hours: DayHours[]): DayHours[] {
  const seen = new Set<number>();
  for (const h of hours) {
    if (!Number.isInteger(h.day) || h.day < 0 || h.day > 6) throw new Error("Unknown day of the week.");
    if (seen.has(h.day)) throw new Error("Each day can only have one set of hours.");
    seen.add(h.day);
    if (!TIME_RE.test(h.start) || !TIME_RE.test(h.end)) throw new Error("Times must look like 09:00.");
    if (toMinutes(h.end) - toMinutes(h.start) < TOUR_MINUTES) {
      throw new Error(`Each day's hours need room for at least one ${TOUR_MINUTES}-minute tour.`);
    }
  }
  return [...hours].sort((a, b) => a.day - b.day);
}

export function isDateKey(value: string): boolean {
  return DATE_RE.test(value);
}

// --- Time-zone arithmetic ---------------------------------------------------

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The wall-clock date and time an instant shows in a time zone. */
export function zonedParts(ms: number, timeZone: string): Parts & { second: number } {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(ms)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
    second: out.second,
  };
}

function offsetMs(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant a wall-clock time happens in a time zone. Checks the offset a second time because
 * the offset at the naive guess can differ from the offset at the answer when a daylight-saving
 * change falls between them.
 */
export function zonedToUtc(p: Parts, timeZone: string): number {
  const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const first = offsetMs(guess, timeZone);
  const ms = guess - first;
  const second = offsetMs(ms, timeZone);
  return second === first ? ms : guess - second;
}

export function localDateKey(ms: number, timeZone: string): string {
  const p = zonedParts(ms, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "2026-09-16T14:00" — what find_tour_times hands the agent and request_tour takes back. */
export function formatLocalDateTime(ms: number, timeZone: string): string {
  const p = zonedParts(ms, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function parseLocalDateTime(value: string): Parts | null {
  const m = LOCAL_DATETIME_RE.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return { year, month, day, hour, minute };
}

/** "Wednesday, September 16 at 2:00 PM" — how the agent says it and how the lead records it. */
export function spokenLabel(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(ms);
}

export function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function weekdayOf(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function startOfLocalDay(dateKey: string, timeZone: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return zonedToUtc({ year, month, day, hour: 0, minute: 0 }, timeZone);
}

/** Monday 00:00 to the following Monday 00:00, local — "that week" for tour counts. */
export function weekBounds(ms: number, timeZone: string): Interval {
  const key = localDateKey(ms, timeZone);
  const monday = addDays(key, -((weekdayOf(key) + 6) % 7));
  return { start: startOfLocalDay(monday, timeZone), end: startOfLocalDay(addDays(monday, 7), timeZone) };
}

function dayNumber(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * The Monday-to-Sunday weeks that make up a month's calendar grid — the Monday on or before the
 * 1st, through the Sunday on or after the last day, so the grid is always whole weeks (the same
 * shape Google Calendar and Outlook use), never a partial one at either end. `monthKey` is
 * "YYYY-MM". `days` is 28, 35 or 42, always a multiple of 7.
 */
export function monthGridRange(monthKey: string): { start: string; days: number } {
  const [year, month] = monthKey.split("-").map(Number);
  const firstOfMonth = `${monthKey}-01`;
  const lastDayNum = new Date(Date.UTC(year, month, 0)).getUTCDate(); // day 0 of next month = last of this one
  const lastOfMonth = `${monthKey}-${pad(lastDayNum)}`;

  const start = addDays(firstOfMonth, -((weekdayOf(firstOfMonth) + 6) % 7));
  const end = addDays(lastOfMonth, 6 - ((weekdayOf(lastOfMonth) + 6) % 7));
  return { start, days: dayNumber(end) - dayNumber(start) + 1 };
}

/** The YYYY-MM a date key falls in — e.g. "2026-09-16" -> "2026-09". */
export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

/** The month before or after "YYYY-MM", wrapping across a year boundary. */
export function addMonths(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const total = year * 12 + (month - 1) + delta;
  return `${Math.floor(total / 12)}-${pad(((total % 12) + 12) % 12 + 1)}`;
}

// --- Rules ------------------------------------------------------------------

/** Every tour start on one local day that fits inside the person's hours and the lead time. */
export function candidateStarts(
  dateKey: string,
  hours: DayHours[],
  timeZone: string,
  now: number,
): number[] {
  const today = hours.find((h) => h.day === weekdayOf(dateKey));
  if (!today) return [];

  const [year, month, day] = dateKey.split("-").map(Number);
  const open = Math.ceil(toMinutes(today.start) / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES;
  const close = toMinutes(today.end);
  const starts: number[] = [];
  for (let m = open; m + TOUR_MINUTES <= close; m += SLOT_STEP_MINUTES) {
    const ms = zonedToUtc({ year, month, day, hour: Math.floor(m / 60), minute: m % 60 }, timeZone);
    if (ms >= now + MIN_LEAD_MINUTES * MINUTE) starts.push(ms);
  }
  return starts;
}

/** Whether a tour starting here sits inside the person's hours — the buffer may spill outside. */
export function withinHours(start: number, hours: DayHours[], timeZone: string): boolean {
  const key = localDateKey(start, timeZone);
  const today = hours.find((h) => h.day === weekdayOf(key));
  if (!today) return false;
  const p = zonedParts(start, timeZone);
  const minutes = p.hour * 60 + p.minute;
  return minutes >= toMinutes(today.start) && minutes + TOUR_MINUTES <= toMinutes(today.end);
}

/** Free means nothing busy in the tour itself or in the buffer either side of it. */
export function isFree(start: number, busy: Interval[]): boolean {
  const from = start - BUFFER_MS;
  const to = start + TOUR_MS + BUFFER_MS;
  return !busy.some((b) => b.start < to && b.end > from);
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Busy blocks with one interval cut out — the tour being moved, so it never blocks its own new
 * time. Free/busy merges touching events into one block, so a block is trimmed rather than
 * dropped, keeping whatever part of it was not the tour.
 */
export function withoutInterval(busy: Interval[], cut: Interval): Interval[] {
  const out: Interval[] = [];
  for (const b of busy) {
    if (b.end <= cut.start || b.start >= cut.end) {
      out.push(b);
      continue;
    }
    if (b.start < cut.start) out.push({ start: b.start, end: cut.start });
    if (b.end > cut.end) out.push({ start: cut.end, end: b.end });
  }
  return out;
}

/**
 * A phone number reduced to its last ten digits, so one caller matches however the number was
 * written or heard: "03343583830", "+92 334 3583830" and caller ID "+923343583830" are the same.
 * Null when there are too few digits to be a real number.
 */
export function phoneKey(phone: string | undefined | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : null;
}
