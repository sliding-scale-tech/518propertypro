/**
 * Rent changes with an effective month: the pure rules (spec docs/specs/ros-build-spec.md 5.9,
 * "Rent history"). A unit's rent is a history of changes (`unitRentChanges`): each says "from
 * {effectiveMonth} the rent is {rentCents}". The rent for a month is the latest change effective on
 * or before that month; before the first change it is the rent the unit had before any change
 * (the first change's `previousRentCents`, i.e. the roster rent at that time); a unit with no
 * changes uses its roster rent (`units.rent`, converted to cents without float drift).
 *
 * `units.rent` stays the unit's CURRENT rent for every other reader (Sarah, leasing, the docs): it is
 * kept equal to the latest change (the one with the newest effective month), so it never goes stale
 * waiting for a month to start. Money is only ever read through rentForMonth, never from units.rent
 * directly once a unit has history.
 *
 * Payments store their own amount: changing the rent never changes a payment already marked.
 *
 * Pure: no Convex imports, erasable TypeScript only (Node's test runner loads it). The server
 * (unitRentLib.ts), the Payments page and the property page all use these, so messages match.
 */

import { MAX_AMOUNT_CENTS, formatCurrency, formatMonth, isMonth, monthOf, nextMonth, parseDollarsToCents, prevMonth } from "./rosFormat";
import { rosterRentToCents, type FieldResult } from "./rosPolicy";

/** A rent change as far as the rules need it (Convex Docs of `unitRentChanges` are assignable). */
export type RentChange = {
  _id?: string;
  effectiveMonth: string;
  rentCents: number;
  previousRentCents?: number | null;
  createdAt?: number;
};

/** The unit as far as the rules need it: its roster rent in DOLLARS (units.rent). */
export type RentUnit = { rent?: number | null };

/** A new rent can start at most this many months before the current month (same as marking rent). */
export const MAX_RENT_CHANGE_MONTHS_BACK = 24;
/** ...and at most this many months after it. */
export const MAX_RENT_CHANGE_MONTHS_AHEAD = 12;
export const MAX_RENT_CHANGE_NOTE = 200;

// --- messages (exact wording, server and client) ---------------------------------------------------

export const RENT_CHANGE_MSG = {
  unitMissing: "Select the unit to change rent for.",
  unitNotFound: "Unit not found.",
  rentMissing: "Enter the new rent.",
  rentInvalid: "Enter the rent as a dollar amount, like 1250 or 1250.50.",
  rentZero: "The rent must be more than $0.00.",
  rentTooBig: "The rent can't be more than $1,000,000.00.",
  monthMissing: "Select the month the new rent starts.",
  monthInvalid: "Select a real month (like October 2026).",
  monthTooOld: (month: string): string => `The new rent can't start in ${formatMonth(month)} — that's more than 24 months ago.`,
  monthTooFar: (month: string): string => `The new rent can't start in ${formatMonth(month)} — that's more than 12 months ahead.`,
  noteLong: "Keep the note under 200 characters.",
  /** The amount asked for is already the rent from that month (nothing would change). */
  unchanged: (month: string, cents: number): string => `The rent from ${formatMonth(month)} is already ${formatCurrency(cents)}.`,
  /** Replacing the unit's first change with the rent it had before any change (nothing would change). */
  sameAsBefore: (month: string, cents: number): string =>
    `The rent from ${formatMonth(month)} would be the same as before (${formatCurrency(cents)}). Nothing to change.`,
  /** Info after a change: a month it covers was already paid at another amount. */
  alreadyPaid: (month: string, cents: number): string =>
    `${formatMonth(month)} is already marked paid at ${formatCurrency(cents)}; that payment isn't changed.`,
  /** units.update refuses a rent edit: rent changes go through Change rent so the history is kept. */
  useChangeRent: "Rent is changed with Change rent, so its history is kept.",
} as const;

// --- the rent for a month ------------------------------------------------------------------------

function validCents(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= MAX_AMOUNT_CENTS;
}

/** Oldest effective month first; two rows for the same month (should never happen): the newest written wins. */
export function sortRentChanges<T extends RentChange>(changes: readonly T[]): T[] {
  return [...changes]
    .filter((c) => typeof c.effectiveMonth === "string" && isMonth(c.effectiveMonth))
    .sort((a, b) =>
      a.effectiveMonth < b.effectiveMonth ? -1 : a.effectiveMonth > b.effectiveMonth ? 1 : (a.createdAt ?? 0) - (b.createdAt ?? 0),
    );
}

export type RentInEffect = {
  /** Integer cents, or null when no valid rent is set for the month. */
  cents: number | null;
  /** The effective month of the change in force; null = the roster rent (no change applies yet). */
  fromMonth: string | null;
  /** The change in force (its _id), or null. */
  changeId: string | null;
  /** True when the unit has any rent history (so units.rent is no longer read for money). */
  hasHistory: boolean;
};

/** The rent in force for `month` and where it comes from. */
export function rentInEffect(unit: RentUnit, changes: readonly RentChange[], month: string): RentInEffect {
  const sorted = sortRentChanges(changes);
  if (sorted.length === 0) {
    return { cents: rosterRentToCents(unit.rent), fromMonth: null, changeId: null, hasHistory: false };
  }
  let hit: RentChange | null = null;
  for (const c of sorted) if (c.effectiveMonth <= month) hit = c;
  if (hit) {
    return { cents: validCents(hit.rentCents) ? hit.rentCents : null, fromMonth: hit.effectiveMonth, changeId: hit._id ?? null, hasHistory: true };
  }
  // Before the first change: the rent the unit had before any change (stored on that change).
  const base = sorted[0].previousRentCents;
  return { cents: validCents(base) ? base : null, fromMonth: null, changeId: null, hasHistory: true };
}

/** The unit's rent for `month` in integer cents, or null (no valid rent set for that month). */
export function rentForMonth(unit: RentUnit, changes: readonly RentChange[], month: string): number | null {
  return rentInEffect(unit, changes, month).cents;
}

/** The next change after `month` (an upcoming rent), or null. */
export function upcomingRentChange<T extends RentChange>(changes: readonly T[], month: string): T | null {
  return sortRentChanges(changes).find((c) => c.effectiveMonth > month) ?? null;
}

/** The change with the newest effective month (what units.rent is kept equal to), or null. */
export function latestRentChange<T extends RentChange>(changes: readonly T[]): T | null {
  const sorted = sortRentChanges(changes);
  return sorted.length > 0 ? sorted[sorted.length - 1] : null;
}

/**
 * Integer cents -> the DOLLARS number units.rent stores. `cents / 100` is the double closest to the
 * decimal, so rosterRentToCents gives the same cents back (tested for every cent value in range).
 */
export function centsToRosterDollars(cents: number): number {
  if (!validCents(cents)) throw new Error(`Expected a rent in cents, got ${String(cents)}`);
  return cents / 100;
}

/**
 * The months a change effective `effectiveMonth` governs: from it up to (not including) the next
 * change's month; null `until` = open-ended.
 */
export function governedMonths(changes: readonly RentChange[], effectiveMonth: string): { from: string; until: string | null } {
  const next = sortRentChanges(changes).find((c) => c.effectiveMonth > effectiveMonth);
  return { from: effectiveMonth, until: next ? next.effectiveMonth : null };
}

/** One line of the rent history (newest effective month first). */
export type RentHistoryLine<T extends RentChange> = {
  change: T;
  /** The rent in force the month before (null = none set). */
  fromCents: number | null;
  toCents: number;
};

/** The rent history, newest effective month first, with the rent each change replaced. */
export function rentHistoryLines<T extends RentChange>(unit: RentUnit, changes: readonly T[]): RentHistoryLine<T>[] {
  const sorted = sortRentChanges(changes);
  return sorted
    .map((c) => ({ change: c, fromCents: rentForMonth(unit, sorted, prevMonth(c.effectiveMonth)), toCents: c.rentCents }))
    .reverse();
}

// --- months --------------------------------------------------------------------------------------

function shiftMonth(month: string, by: number): string {
  let m = month;
  for (let i = 0; i < Math.abs(by); i++) m = by < 0 ? prevMonth(m) : nextMonth(m);
  return m;
}

/** The oldest month a new rent can start: 24 months before the current month. */
export function earliestRentChangeMonth(today: string): string {
  return shiftMonth(monthOf(today), -MAX_RENT_CHANGE_MONTHS_BACK);
}

/** The latest month a new rent can start: 12 months after the current month. */
export function latestRentChangeMonth(today: string): string {
  return shiftMonth(monthOf(today), MAX_RENT_CHANGE_MONTHS_AHEAD);
}

/** The months offered in the Change rent dialog, newest first (12 ahead .. 24 back). */
export function rentChangeMonthOptions(today: string): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const oldest = earliestRentChangeMonth(today);
  for (let m = latestRentChangeMonth(today); m >= oldest; m = prevMonth(m)) out.push({ value: m, label: formatMonth(m) });
  return out;
}

// --- the form fields -----------------------------------------------------------------------------

export type RentChangeRaw = {
  /** Typed dollars ("1250", "$1,250.50"); parsed with parseDollarsToCents, never Number(). */
  rent?: string | null;
  effectiveMonth?: string | null;
  note?: string | null;
  /** Business date today (YYYY-MM-DD). */
  today: string;
};

export type RentChangeFields = { rentCents: number; effectiveMonth: string; note: string | null };

const trim = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** null = OK. The typed rent. */
export function rentAmountProblem(raw: string | null | undefined): string | null {
  const s = trim(raw);
  if (s === "") return RENT_CHANGE_MSG.rentMissing;
  const cents = parseDollarsToCents(s);
  if (cents === null) {
    // "-5", "1.234", "abc": a shape problem. A huge number of digits is still "too big" to the user.
    if (/^\$?[\d,]+(\.\d{1,2})?$/.test(s)) return RENT_CHANGE_MSG.rentTooBig;
    return RENT_CHANGE_MSG.rentInvalid;
  }
  if (cents <= 0) return RENT_CHANGE_MSG.rentZero;
  if (cents > MAX_AMOUNT_CENTS) return RENT_CHANGE_MSG.rentTooBig;
  return null;
}

/** null = OK. The month the new rent starts. */
export function rentChangeMonthProblem(raw: string | null | undefined, today: string): string | null {
  const m = trim(raw);
  if (m === "") return RENT_CHANGE_MSG.monthMissing;
  if (!isMonth(m)) return RENT_CHANGE_MSG.monthInvalid;
  if (m < earliestRentChangeMonth(today)) return RENT_CHANGE_MSG.monthTooOld(m);
  if (m > latestRentChangeMonth(today)) return RENT_CHANGE_MSG.monthTooFar(m);
  return null;
}

type Check = { field: string; run: () => string | null };

function checks(i: RentChangeRaw): Check[] {
  return [
    { field: "rent", run: () => rentAmountProblem(i.rent) },
    { field: "effectiveMonth", run: () => rentChangeMonthProblem(i.effectiveMonth, i.today) },
    { field: "note", run: () => (trim(i.note).length > MAX_RENT_CHANGE_NOTE ? RENT_CHANGE_MSG.noteLong : null) },
  ];
}

/** First failing field (rent, effectiveMonth, note), or the cleaned values. */
export function validateRentChange(input: RentChangeRaw): FieldResult<RentChangeFields> {
  for (const c of checks(input)) {
    const m = c.run();
    if (m !== null) return { ok: false, field: c.field, message: m };
  }
  const note = trim(input.note);
  return {
    ok: true,
    value: { rentCents: parseDollarsToCents(trim(input.rent)) as number, effectiveMonth: trim(input.effectiveMonth), note: note === "" ? null : note },
  };
}

/** Every failing field (field -> message), for marking all bad fields at once. */
export function validateRentChangeAll(input: RentChangeRaw): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of checks(input)) {
    const m = c.run();
    if (m !== null) out[c.field] = m;
  }
  return out;
}

/** "Rent $1,250.00/month (from November 2026)" / "(from the roster)" / "No rent set". */
export function rentLabel(r: Pick<RentInEffect, "cents" | "fromMonth">): string {
  if (r.cents === null) return "No rent set";
  return `Rent ${formatCurrency(r.cents)}/month (${r.fromMonth ? `from ${formatMonth(r.fromMonth)}` : "from the roster"})`;
}
