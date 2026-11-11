/**
 * Technician appointment windows: a start and end instant (epoch ms) plus the absolute label
 * stored beside them ("Tue, Nov 3, 1:00–3:00 PM"). Pure, so the mutations, the dashboard, Sarah's
 * status tool and the picker all share one set of rules and one label format.
 *
 * Labels never use relative words ("Today"): the label is written once and read for weeks.
 */

import { isValidTimeZone, localDateKey } from "./tourSchedule";

const HOUR = 60 * 60 * 1000;
export const WINDOW_MAX_MS = 12 * HOUR;
// Lets an admin record a visit that already happened this morning; anything older is a typo.
export const WINDOW_PAST_GRACE_MS = 24 * HOUR;
export const WINDOW_MAX_AHEAD_MS = 366 * 24 * HOUR;

/** The team's zone, else the caller's browser zone when it is a real one, else UTC (as tours do). */
export function resolveTimeZone(teamTimeZone: string | null | undefined, fallback?: string | null): string {
  if (teamTimeZone) return teamTimeZone;
  return fallback && isValidTimeZone(fallback) ? fallback : "UTC";
}

/**
 * What the tenant said suits them for a visit, or undefined when there is nothing to show (null,
 * empty, blank). Free text in their own words: never parse it, and never use it as the scheduled
 * window or due date.
 */
export function tenantPreferredTimeText(raw: string | null | undefined): string | undefined {
  return raw?.trim() || undefined;
}

/** A message fit to show a person, or null when the window is acceptable. */
export function windowProblem(start: number, end: number, now: number): string | null {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return "Pick a valid time window.";
  if (end <= start) return "The window has to end after it starts.";
  if (end - start > WINDOW_MAX_MS) return "A time window can be at most 12 hours long.";
  if (start < now - WINDOW_PAST_GRACE_MS) return "That time window is in the past. Pick a new one.";
  if (start > now + WINDOW_MAX_AHEAD_MS) return "Pick a time window within the next year.";
  return null;
}

type Clock = { time: string; period: string };

function clockOf(ms: number, timeZone: string): Clock {
  let hour = "";
  let minute = "";
  let period = "";
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(ms)) {
    if (p.type === "hour") hour = p.value;
    else if (p.type === "minute") minute = p.value;
    else if (p.type === "dayPeriod") period = p.value.toUpperCase();
  }
  return { time: `${hour}:${minute}`, period };
}

/** "1:00 PM" in the zone. */
export function clockLabel(ms: number, timeZone: string): string {
  const c = clockOf(ms, timeZone);
  return `${c.time} ${c.period}`;
}

/** "1:00–3:00 PM", or "11:00 AM–1:00 PM" when the window crosses noon. Times only, no day. */
export function windowTimeRange(start: number, end: number, timeZone: string): string {
  const a = clockOf(start, timeZone);
  const b = clockOf(end, timeZone);
  return a.period === b.period ? `${a.time}–${b.time} ${b.period}` : `${a.time} ${a.period}–${b.time} ${b.period}`;
}

function dayLabel(ms: number, timeZone: string, withYear: boolean): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" as const } : {}),
  }).format(ms);
}

/**
 * "Tue, Nov 3, 1:00–3:00 PM". The year is added when it isn't the current one, and both days are
 * named when the window runs past midnight ("Tue, Nov 3, 10:00 PM – Wed, Nov 4, 2:00 AM").
 */
export function windowLabel(start: number, end: number, timeZone: string, now: number): string {
  const thisYear = localDateKey(now, timeZone).slice(0, 4);
  const startKey = localDateKey(start, timeZone);
  const endKey = localDateKey(end, timeZone);
  const withYear = startKey.slice(0, 4) !== thisYear || endKey.slice(0, 4) !== thisYear;
  if (startKey === endKey) return `${dayLabel(start, timeZone, withYear)}, ${windowTimeRange(start, end, timeZone)}`;
  return `${dayLabel(start, timeZone, withYear)}, ${clockLabel(start, timeZone)} – ${dayLabel(end, timeZone, withYear)}, ${clockLabel(end, timeZone)}`;
}

/** Whether the window starts on today's local date in the zone. */
export function windowIsToday(start: number, now: number, timeZone: string): boolean {
  return localDateKey(start, timeZone) === localDateKey(now, timeZone);
}
