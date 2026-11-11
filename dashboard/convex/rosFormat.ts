/**
 * Rental Owner Statement (ROS): the ONE shared formatter for money, business dates and strings.
 * Spec: docs/specs/ros-build-spec.md section 4.1.
 *
 * Pure: no Convex imports, erasable TypeScript only, so `node --test` loads it directly.
 *
 * Money is always an integer number of cents. Nothing here uses float arithmetic on money,
 * parseFloat or toLocaleString. Business dates are `YYYY-MM-DD` strings in America/New_York and are
 * never turned into a `Date`; only epoch-ms inputs (businessDate, generatedStamp) go through Intl.
 */

export const ROS_TIME_ZONE = "America/New_York"; // ASSUMPTION A24
export const COMPANY_NAME = "Property Pro Realty Group Inc.";
export const COMPANY_ADDRESS_LINES = ["60 Broad Street", "Waterford, NY 12188"] as const;
export const PROPERTY_LEVEL = "Property level";
export const MAX_AMOUNT_CENTS = 100_000_000; // $1,000,000.00: typo guard

// --- money ---------------------------------------------------------------------------------------

/** Throws Error unless `n` is a safe integer (a valid number of cents). */
export function assertCents(n: number): void {
  if (typeof n !== "number" || !Number.isSafeInteger(n)) {
    throw new Error(`Expected an integer number of cents, got ${String(n)}`);
  }
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function plainAmount(cents: number): { neg: boolean; s: string } {
  assertCents(cents);
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = groupThousands(Math.floor(abs / 100).toString());
  return { neg, s: `${dollars}.${String(abs % 100).padStart(2, "0")}` };
}

/** 433387 -> "4,333.87"; 0 -> "0.00"; -240000 -> "(2,400.00)". */
export function formatAmount(cents: number): string {
  const { neg, s } = plainAmount(cents);
  return neg ? `(${s})` : s;
}

/** 433387 -> "$4,333.87"; 0 -> "$0.00"; -240000 -> "($2,400.00)". */
export function formatCurrency(cents: number): string {
  const { neg, s } = plainAmount(cents);
  return neg ? `($${s})` : `$${s}`;
}

const UNSIGNED_DOLLARS = /^\d+(\.\d{1,2})?$/;

/** "12" / "12.5" / "12.50" -> cents, by integer maths only. null if the shape is wrong or too big. */
function unsignedDollarsToCents(s: string): number | null {
  if (!UNSIGNED_DOLLARS.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const wholeNum = Number(whole);
  if (!Number.isSafeInteger(wholeNum)) return null;
  const cents = wholeNum * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * Typed dollars -> cents. Trims; strips one leading "$" and every ","; must then match
 * /^\d+(\.\d{1,2})?$/. "12.5" -> 1250; "$1,250.00" -> 125000; "" / "-1" / "1.234" / "abc" -> null.
 */
export function parseDollarsToCents(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (s.startsWith("$")) s = s.slice(1);
  s = s.replace(/,/g, "");
  return unsignedDollarsToCents(s);
}

/**
 * As parseDollarsToCents, but also accepts a leading "-" or wrapping "(...)" for a negative
 * amount ("(12.00)" -> -1200, "-0.50" -> -50, "-$5" -> -500). Used only for the opening balance.
 */
export function parseSignedDollarsToCents(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  let neg = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    neg = true;
    s = s.slice(1, -1).trim();
  } else if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1).trim();
  }
  const cents = parseDollarsToCents(s);
  if (cents === null) return null;
  return neg && cents !== 0 ? -cents : cents; // never -0
}

/**
 * Integer division rounded half up: floor((numerator * 2 + denominator) / (denominator * 2)).
 * Integers only, numerator >= 0, denominator > 0. Throws Error otherwise or on overflow.
 */
export function roundHalfUpDiv(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || numerator < 0) {
    throw new Error(`roundHalfUpDiv: numerator must be a non-negative integer, got ${String(numerator)}`);
  }
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error(`roundHalfUpDiv: denominator must be a positive integer, got ${String(denominator)}`);
  }
  const top = numerator * 2 + denominator;
  const bottom = denominator * 2;
  if (!Number.isSafeInteger(top) || !Number.isSafeInteger(bottom)) {
    throw new Error("roundHalfUpDiv: overflow");
  }
  return Math.floor(top / bottom);
}

/** `bps` basis points of `baseCents`, rounded half up to the cent: roundHalfUpDiv(base * bps, 10000). */
export function percentOf(baseCents: number, bps: number): number {
  if (!Number.isSafeInteger(baseCents) || baseCents < 0) {
    throw new Error(`percentOf: base must be a non-negative integer, got ${String(baseCents)}`);
  }
  if (!Number.isSafeInteger(bps) || bps < 0) {
    throw new Error(`percentOf: bps must be a non-negative integer, got ${String(bps)}`);
  }
  const product = baseCents * bps;
  if (!Number.isSafeInteger(product)) throw new Error("percentOf: overflow");
  return roundHalfUpDiv(product, 10000);
}

/** 500 -> "5.00"; 1250 -> "12.50"; 0 -> "0.00"; 1 -> "0.01". */
export function formatBps(bps: number): string {
  if (!Number.isSafeInteger(bps) || bps < 0) {
    throw new Error(`formatBps: expected a non-negative integer, got ${String(bps)}`);
  }
  return `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, "0")}`;
}

/**
 * Typed percent -> basis points, with no upper bound. Exported for validators that need to tell
 * "not a number" apart from "out of range". Trims and strips one trailing "%".
 */
export function parsePercentToBpsUnbounded(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (s.endsWith("%")) s = s.slice(0, -1).trim();
  return unsignedDollarsToCents(s); // same shape and maths: whole*100 + 2-digit fraction
}

/** "5" | "5.0" | "5.00" | "5%" -> 500; 0..100 with <= 2 decimals; anything else -> null. */
export function parsePercentToBps(raw: string | null | undefined): number | null {
  const bps = parsePercentToBpsUnbounded(raw);
  return bps !== null && bps <= 10000 ? bps : null;
}

// --- dates (strings only, no Date for YYYY-MM-DD) -----------------------------------------------

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");
const pad4 = (n: number): string => String(n).padStart(4, "0");

/** A real calendar date in the form YYYY-MM-DD. */
export function isIsoDate(s: string): boolean {
  if (typeof s !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

/** YYYY-MM with month 01..12. */
export function isMonth(s: string): boolean {
  if (typeof s !== "string") return false;
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return false;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12;
}

function splitMonth(month: string): [number, number] {
  if (!isMonth(month)) throw new Error(`Expected a YYYY-MM month, got ${String(month)}`);
  return [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
}

function splitDate(date: string): [number, number, number] {
  if (!isIsoDate(date)) throw new Error(`Expected a YYYY-MM-DD date, got ${String(date)}`);
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
}

/** "2026-09" -> "2026-09-01". */
export function monthStart(month: string): string {
  splitMonth(month);
  return `${month}-01`;
}

/** "2026-09" -> "2026-09-30"; "2028-02" -> "2028-02-29". */
export function monthEnd(month: string): string {
  const [y, m] = splitMonth(month);
  return `${month}-${pad2(daysInMonth(y, m))}`;
}

/** "2026-01" -> "2025-12". */
export function prevMonth(month: string): string {
  const [y, m] = splitMonth(month);
  return m === 1 ? `${pad4(y - 1)}-12` : `${pad4(y)}-${pad2(m - 1)}`;
}

/** "2026-12" -> "2027-01". */
export function nextMonth(month: string): string {
  const [y, m] = splitMonth(month);
  return m === 12 ? `${pad4(y + 1)}-01` : `${pad4(y)}-${pad2(m + 1)}`;
}

/** "2026-09-30" -> "2026-09". */
export function monthOf(date: string): string {
  splitDate(date);
  return date.slice(0, 7);
}

/** "2026-09-01" -> "9/1/2026" (no zero padding). */
export function formatDate(date: string): string {
  const [y, m, d] = splitDate(date);
  return `${m}/${d}/${y}`;
}

/** "2026-09" -> "September 2026". */
export function formatMonth(month: string): string {
  const [y, m] = splitMonth(month);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "9/1/2026 - 9/30/2026". */
export function formatPeriod(start: string, end: string): string {
  return `${formatDate(start)} - ${formatDate(end)}`;
}

function zonedParts(ms: number): Record<string, string> {
  if (typeof ms !== "number" || !Number.isFinite(ms)) throw new Error(`Expected epoch ms, got ${String(ms)}`);
  const out: Record<string, string> = {};
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ROS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (const p of fmt.formatToParts(ms)) out[p.type] = p.value;
  return out;
}

/** Epoch ms -> the YYYY-MM-DD business date in ROS_TIME_ZONE. */
export function businessDate(ms: number): string {
  const p = zonedParts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Today's business date (YYYY-MM-DD in ROS_TIME_ZONE) for `nowMs`. */
export function businessToday(nowMs: number): string {
  return businessDate(nowMs);
}

/** "10/16/2026 09:26:36": MM/DD/YYYY HH:mm:ss, 24 h, zero-padded, ROS_TIME_ZONE (ASSUMPTION A23). */
export function generatedStamp(ms: number): string {
  const p = zonedParts(ms);
  const hour = p.hour === "24" ? "00" : p.hour; // defensive: some engines print midnight as 24
  return `${p.month}/${p.day}/${p.year} ${hour}:${p.minute}:${p.second}`;
}

// --- strings -------------------------------------------------------------------------------------

/** Uniqueness key for names: trim, lowercase, collapse whitespace, strip trailing ".". */
export function normalizeNameKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "")
    .trim();
}

/** Natural, case-insensitive order: "Unit 2" before "Unit 10". */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}
