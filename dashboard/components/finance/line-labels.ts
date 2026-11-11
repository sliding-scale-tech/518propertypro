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
};

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
 * and not voided). Roster rent, work orders, fees, draws, imported rows and final statements: false.
 */
export function canDeleteLine(l: LineLabelInput): boolean {
  return l.kind === "entry" && l.editable && typeof l.entryId === "string" && l.entryId !== "";
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
