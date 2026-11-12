import { businessToday, formatMonth, isMonth, monthOf, nextMonth, prevMonth } from "@/convex/rosFormat";

/** The current business month (YYYY-MM, America/New_York). */
export function currentMonth(nowMs: number): string {
  return monthOf(businessToday(nowMs));
}

/** The current month and the `count - 1` months before it, newest first (spec 6.2). */
export function recentMonths(nowMs: number, count = 24): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  let m = currentMonth(nowMs);
  for (let i = 0; i < count; i++) {
    out.push({ value: m, label: formatMonth(m) });
    m = prevMonth(m);
  }
  return out;
}

/** The statements page default: the previous month. */
export function defaultStatementMonth(nowMs: number): string {
  return prevMonth(currentMonth(nowMs));
}

/** A `?month=` value if it is one of the offered months, else null. */
export function pickMonth(raw: string | null, options: { value: string }[]): string | null {
  if (!raw || !isMonth(raw)) return null;
  return options.some((o) => o.value === raw) ? raw : null;
}

/** "Nov 11, 2026, 3:04 PM" for audit and "Updated" timestamps (not money). */
export function formatStamp(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

/**
 * The Payments page's rent months, newest first: next month (rent paid early), this month and the
 * `back` months before it (the oldest month rent can still be marked for). A `?month=` from a link
 * that is older (a real month, not after next month) is added at the end, so the link still opens it.
 */
export function rentMonthOptions(nowMs: number, urlMonth: string | null, back = 24): { value: string; label: string }[] {
  const latest = nextMonth(currentMonth(nowMs));
  const out = [{ value: latest, label: formatMonth(latest) }, ...recentMonths(nowMs, back + 1)];
  if (urlMonth && isMonth(urlMonth) && urlMonth <= latest && !out.some((o) => o.value === urlMonth)) {
    out.push({ value: urlMonth, label: formatMonth(urlMonth) });
  }
  return out;
}
