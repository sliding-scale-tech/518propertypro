/**
 * Leases (B44): the pure rules behind the lease tag, the Residents Lease filter, the daily
 * lease-ended follow-up and the New renter / Move out / Renewed forms. No Convex server imports,
 * so the client runs the same validation as the server (same messages) and
 * scripts/probes/lease_rules.test.mjs runs every rule directly.
 *
 * Dates are "YYYY-MM-DD" keys. "Today" is always the TEAM's date (organizations.timeZone, as tours
 * do), never the server's UTC date: a lease ending Nov 30 has ended only once it is Dec 1 in Albany.
 */

import { addDays, isValidTimeZone, localDateKey } from "./tourSchedule";
import { toE164 } from "./phone";
import { rentAmountProblem } from "./unitRentPolicy";

/** Used when the team has no time zone set (the business runs in Albany, NY; rosFormat uses the same). */
export const DEFAULT_TEAM_TIME_ZONE = "America/New_York";
/** "Ending soon": the lease ends within this many days (today counts). */
export const ENDING_SOON_DAYS = 60;
export const MAX_PHONES = 5;
export const MAX_NAME = 120;
export const MAX_EMAIL = 200;

/** The team's date for an instant: its time zone when set and valid, else DEFAULT_TEAM_TIME_ZONE. */
export function teamToday(nowMs: number, timeZone?: string | null): string {
  const tz = timeZone && isValidTimeZone(timeZone) ? timeZone : DEFAULT_TEAM_TIME_ZONE;
  return localDateKey(nowMs, tz);
}

/** A real calendar date "YYYY-MM-DD" (not 2026-02-30). */
export function isRealDate(s: string | null | undefined): boolean {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export { addDays };

// --- Lease tag ----------------------------------------------------------------------------------

export type LeaseStatusFlag = "month_to_month";
export type LeaseFields = {
  active: boolean;
  leaseEnd?: string | null;
  leaseStatus?: LeaseStatusFlag | null;
};
export type LeaseTag = "ended" | "ending_soon" | "month_to_month";

export const LEASE_TAG_LABEL: Record<LeaseTag, string> = {
  ended: "Lease ended",
  ending_soon: "Ending soon",
  month_to_month: "Month-to-month",
};

/**
 * The resident's lease tag. Only active residents have one (a moved-out resident's lease is
 * history). Month-to-month (set by a person) wins over the date; otherwise ended when the lease
 * end is before today, ending soon when it is today or within ENDING_SOON_DAYS, else none.
 */
export function leaseTag(r: LeaseFields, today: string): LeaseTag | null {
  if (!r.active) return null;
  if (r.leaseStatus === "month_to_month") return "month_to_month";
  if (!r.leaseEnd) return null;
  if (r.leaseEnd < today) return "ended";
  if (r.leaseEnd <= addDays(today, ENDING_SOON_DAYS)) return "ending_soon";
  return null;
}

// --- Lease filter (Residents toolbar) ------------------------------------------------------------

export const LEASE_FILTERS = ["all", "ended", "ending_30", "ending_60", "ending_90", "month_to_month", "none"] as const;
export type LeaseFilter = (typeof LEASE_FILTERS)[number];
export const LEASE_FILTER_LABEL: Record<LeaseFilter, string> = {
  all: "All",
  ended: "Ended",
  ending_30: "Ending in 30 days",
  ending_60: "Ending in 60 days",
  ending_90: "Ending in 90 days",
  month_to_month: "Month-to-month",
  none: "No lease date",
};

/**
 * Whether a resident passes the Lease filter. Lease filters are about current tenancies, so an
 * inactive resident only passes "all". "Ending in N days" = today through today + N (not already
 * ended); month-to-month residents only match "Month-to-month".
 */
export function matchesLeaseFilter(r: LeaseFields, filter: LeaseFilter | undefined, today: string): boolean {
  if (!filter || filter === "all") return true;
  if (!r.active) return false;
  const m2m = r.leaseStatus === "month_to_month";
  if (filter === "month_to_month") return m2m;
  if (m2m) return false;
  if (filter === "none") return !r.leaseEnd;
  if (!r.leaseEnd) return false;
  if (filter === "ended") return r.leaseEnd < today;
  const days = filter === "ending_30" ? 30 : filter === "ending_60" ? 60 : 90;
  return r.leaseEnd >= today && r.leaseEnd <= addDays(today, days);
}

// --- Daily lease-ended follow-up -----------------------------------------------------------------

/**
 * A resident gets a lease-ended follow-up when they are active, their lease end has passed (team
 * date), nobody has marked them month-to-month, and they have no open follow-up yet. That last
 * condition is what makes the daily job idempotent.
 */
export function needsLeaseFollowUp(r: LeaseFields, today: string, hasOpenFollowUp: boolean): boolean {
  if (hasOpenFollowUp) return false;
  if (!r.active || r.leaseStatus === "month_to_month" || !r.leaseEnd) return false;
  return r.leaseEnd < today;
}

/** The residents (of one batch) that need a new follow-up; `open` = resident ids with one open. */
export function selectLeaseFollowUps<T extends LeaseFields & { _id: string }>(
  rows: readonly T[],
  today: string,
  open: ReadonlySet<string>,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r._id)) continue;
    seen.add(r._id);
    if (needsLeaseFollowUp(r, today, open.has(r._id))) out.push(r);
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 30", or "Nov 30, 2025" when the year differs from today's. */
export function shortDate(dateKey: string, today: string): string {
  if (!isRealDate(dateKey)) return dateKey;
  const [y, m, d] = dateKey.split("-").map(Number);
  const base = `${MONTHS[m - 1]} ${d}`;
  return dateKey.slice(0, 4) === today.slice(0, 4) ? base : `${base}, ${y}`;
}

/** "Unit 2B" (a label that already says Unit is kept as is). */
export function unitWord(unitNumber: string): string {
  return /^unit\b/i.test(unitNumber.trim()) ? unitNumber.trim() : `Unit ${unitNumber.trim()}`;
}

/** The follow-up task's title, e.g. "Lease for Unit 2B at 1635 Van Vranken Ave ended on Nov 30. Renewed, moving out, or month-to-month?" */
export function leaseFollowUpTitle(a: { unitNumber: string; propertyName: string; leaseEnd: string; today: string }): string {
  return `Lease for ${unitWord(a.unitNumber)} at ${a.propertyName} ended on ${shortDate(a.leaseEnd, a.today)}. Renewed, moving out, or month-to-month?`;
}

// --- Form validation (client and server, same messages) -----------------------------------------

export const LEASE_MSG = {
  moveOutMissing: "Enter the move-out date.",
  moveOutInvalid: "Enter the move-out date as a real date, like 2026-11-30.",
  moveOutFuture: "The move-out date can't be in the future. Record the move-out on or after the day they leave.",
  nameMissing: "Enter the new renter's full name.",
  nameLong: `Keep the name under ${MAX_NAME} characters.`,
  phoneIncomplete: (n: number) => `Phone ${n} doesn't look complete. Use 10 digits, like (518) 555-1234.`,
  phonesTooMany: `Add at most ${MAX_PHONES} phone numbers.`,
  phoneDuplicate: (n: number) => `Phone ${n} is the same as another number.`,
  emailInvalid: "That email address doesn't look right. Use the form name@example.com.",
  leaseStartInvalid: "Enter the lease start as a real date, like 2026-12-01.",
  leaseEndInvalid: "Enter the lease end as a real date, like 2027-11-30.",
  leaseEndBeforeStart: "Lease end must be after lease start.",
  leaseEndPast: "The lease end is already in the past. Check the date.",
  renewMissing: "Enter the new lease end date.",
  renewNotAfterOld: (old: string) => `The new lease end must be after the old one (${old}).`,
  renewPast: "The new lease end must be after today.",
} as const;

export type FieldErrors = Record<string, string>;

/** The first failing field in `order` (then any other), or null. */
export function firstError(errs: FieldErrors, order: readonly string[]): { field: string; message: string } | null {
  const field = order.find((k) => errs[k]) ?? Object.keys(errs)[0];
  return field ? { field, message: errs[field] } : null;
}

function trim(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function moveOutProblem(raw: string | null | undefined, today: string): string | null {
  const d = trim(raw);
  if (!d) return LEASE_MSG.moveOutMissing;
  if (!isRealDate(d)) return LEASE_MSG.moveOutInvalid;
  if (d > today) return LEASE_MSG.moveOutFuture;
  return null;
}

/** Phones as typed -> E.164 list, with a field error per bad row ("phone0", "phone1", ...). Blank rows are ignored. */
export function cleanPhoneList(raw: ReadonlyArray<string | null | undefined>): { phones: string[]; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const phones: string[] = [];
  const filled = raw.map((p, i) => ({ p: trim(p), i })).filter((x) => x.p !== "");
  if (filled.length > MAX_PHONES) errors.phones = LEASE_MSG.phonesTooMany;
  for (const { p, i } of filled) {
    const e164 = toE164(p);
    if (!e164) errors[`phone${i}`] = LEASE_MSG.phoneIncomplete(i + 1);
    else if (phones.includes(e164)) errors[`phone${i}`] = LEASE_MSG.phoneDuplicate(i + 1);
    else phones.push(e164);
  }
  return { phones, errors };
}

export function emailProblem(raw: string | null | undefined): string | null {
  const e = trim(raw).toLowerCase();
  if (!e) return null;
  if (e.length > MAX_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return LEASE_MSG.emailInvalid;
  return null;
}

export type NewRenterInput = {
  /** True when the unit has active residents now (the move-out date is then required). */
  hasCurrent: boolean;
  moveOutDate?: string | null;
  fullName?: string | null;
  phones?: ReadonlyArray<string | null | undefined> | null;
  email?: string | null;
  leaseStart?: string | null;
  leaseEnd?: string | null;
  /** Typed dollars; blank = leave the rent as it is. */
  rent?: string | null;
  today: string;
};

export const NEW_RENTER_ORDER = ["moveOutDate", "fullName", "phones", "phone0", "phone1", "phone2", "phone3", "phone4", "email", "leaseStart", "leaseEnd", "rent"] as const;

/** Every failing field of the New renter form (field -> message). Empty = valid. */
export function validateNewRenter(i: NewRenterInput): FieldErrors {
  const errs: FieldErrors = {};
  if (i.hasCurrent) {
    const m = moveOutProblem(i.moveOutDate, i.today);
    if (m) errs.moveOutDate = m;
  }
  const name = trim(i.fullName);
  if (!name) errs.fullName = LEASE_MSG.nameMissing;
  else if (name.length > MAX_NAME) errs.fullName = LEASE_MSG.nameLong;
  Object.assign(errs, cleanPhoneList(i.phones ?? []).errors);
  const email = emailProblem(i.email);
  if (email) errs.email = email;
  const start = trim(i.leaseStart);
  const end = trim(i.leaseEnd);
  if (start && !isRealDate(start)) errs.leaseStart = LEASE_MSG.leaseStartInvalid;
  if (end && !isRealDate(end)) errs.leaseEnd = LEASE_MSG.leaseEndInvalid;
  else if (end && start && isRealDate(start) && end <= start) errs.leaseEnd = LEASE_MSG.leaseEndBeforeStart;
  else if (end && end < i.today) errs.leaseEnd = LEASE_MSG.leaseEndPast;
  if (trim(i.rent)) {
    const r = rentAmountProblem(i.rent);
    if (r) errs.rent = r;
  }
  return errs;
}

/** The Move out form: just the date. */
export function validateMoveOut(i: { moveOutDate?: string | null; today: string }): FieldErrors {
  const m = moveOutProblem(i.moveOutDate, i.today);
  return m ? { moveOutDate: m } : {};
}

/** The Renewed form: a new lease end after today and after the old one. */
export function validateRenewal(i: { leaseEnd?: string | null; oldLeaseEnd?: string | null; today: string }): FieldErrors {
  const d = trim(i.leaseEnd);
  if (!d) return { leaseEnd: LEASE_MSG.renewMissing };
  if (!isRealDate(d)) return { leaseEnd: LEASE_MSG.leaseEndInvalid };
  if (i.oldLeaseEnd && d <= i.oldLeaseEnd) return { leaseEnd: LEASE_MSG.renewNotAfterOld(shortDate(i.oldLeaseEnd, i.today)) };
  if (d <= i.today) return { leaseEnd: LEASE_MSG.renewPast };
  return {};
}
