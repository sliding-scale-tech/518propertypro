// Labels and row-action rules for the statement's lines tables (pure, so node tests can load it).
// Spec: docs/specs/ros-build-spec.md 6.3 (draft editor).
import { formatDate, formatMonth, monthOf } from "../../convex/rosFormat";

/** The LineView fields these helpers read. */
export type LineLabelInput = {
  kind: string;
  editable: boolean;
  entryId?: string;
  /** The line's effective (posting) date on this statement. */
  date: string;
  /** The date the row was entered with. */
  storedDate: string;
  carriedForward: boolean;
  /** Set on a rent payment from the Payments page (the month the rent is for). */
  rentForMonth?: string;
  /** A ledger row on the Rent Income account. */
  onRentAccount?: boolean;
  /** Dated before the owner's first statement month: off unless put back. */
  defaultExcluded?: boolean;
};

/** A rent payment line (source rent_payment): read-only here, changed on the Payments page. */
export const PAYMENTS_LINK = {
  edit: "Edit on Payments page",
  view: "View on Payments page",
  tooltip: "Rent is recorded on the Payments page. Change or undo the payment there.",
  legacyRentTooltip: "Rent Income rows can't be edited here any more. Delete it, or record rent on the Payments page.",
} as const;

/** True for a rent payment marked on the Payments page. */
export function isRentPaymentLine(l: LineLabelInput): boolean {
  return l.kind === "entry" && typeof l.rentForMonth === "string" && l.rentForMonth !== "";
}

/** The Payments page filtered to the payment's rent month and property. */
export function paymentsPageHref(l: { rentForMonth?: string; propertyId?: string }): string {
  const q = new URLSearchParams();
  if (l.rentForMonth) q.set("month", l.rentForMonth);
  if (l.propertyId) q.set("property", l.propertyId);
  const s = q.toString();
  return s ? `/payments?${s}` : "/payments";
}

/** Edit is offered on a hand-entered draft row, but not on Rent Income (rent goes on the Payments page). */
export function canEditEntryLine(l: LineLabelInput): boolean {
  return l.kind === "entry" && l.editable && l.onRentAccount !== true;
}

/**
 * "Leave off this month": every draft line except a rent payment from the Payments page (undo it
 * there). A payment that is off by default (before the first statement month) and was put back can
 * go back to its default.
 */
export function canLeaveOffLine(l: LineLabelInput): boolean {
  return !isRentPaymentLine(l) || l.defaultExcluded === true;
}

/** Button and toast text for leaving a line off / putting it back (server names stay exclude / include). */
export const LEAVE_OFF = {
  button: "Leave off this month",
  tooltip: "Leave this line off this statement. It stays unbilled and comes back on next month's draft.",
  toast: "Left off this statement. Put it back from “Left off this statement” below.",
  cardTitle: "Left off this statement",
  putBack: "Put back",
  putBackToast: "Put back on this statement.",
  empty: "Nothing is left off this statement.",
} as const;

/** The Delete dialog (it calls ledger.voidEntry; the row stays in the history with the reason). */
export const DELETE_ENTRY = {
  button: "Delete",
  title: "Delete this transaction?",
  body: "It is removed from this and every future statement. It stays in the history with your reason.",
  confirm: "Delete transaction",
  busy: "Deleting…",
  toast: "Transaction deleted.",
} as const;

/**
 * True when the row is a hand-entered ledger row that is still editable on this draft (so unbilled
 * and not voided). Rent payments from the Payments page, roster rent, work orders, fees, draws,
 * imported rows and final statements: false.
 */
export function canDeleteLine(l: LineLabelInput): boolean {
  return l.kind === "entry" && l.editable && !isRentPaymentLine(l) && typeof l.entryId === "string" && l.entryId !== "";
}

/** True when the row's own date is before the period it posts in (it carried forward). */
function isCarried(l: LineLabelInput): boolean {
  return l.carriedForward && l.storedDate < l.date;
}

/**
 * The pill next to the source pill on a carried-forward line, or null. On a draft:
 * "From September 2026 — not on a final statement yet". On a final statement the line is now on one,
 * so the pill says only "From September 2026".
 */
export function carriedForwardTag(l: LineLabelInput, isDraft: boolean): string | null {
  if (!isCarried(l)) return null;
  const from = `From ${formatMonth(monthOf(l.storedDate))}`;
  return isDraft ? `${from} — not on a final statement yet` : from;
}

/** The date cell: the original date, plus "posts 10/1/2026" when the line carried forward. */
export function lineDateCell(l: LineLabelInput): { date: string; posts: string | null } {
  if (!isCarried(l)) return { date: formatDate(l.date), posts: null };
  return { date: formatDate(l.storedDate), posts: `posts ${formatDate(l.date)}` };
}
