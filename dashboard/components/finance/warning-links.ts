// Where each statement warning is fixed (pure, no imports, so node tests can load it).
// The statement page's warnings card turns a warning into a link (another page, scrolled to the
// section by its #hash) or an in-page scroll; the owner page reads the hash and highlights the field.

/** The ids of the sections the warnings point at. The owner page and the side panel render them. */
export const ANCHOR = {
  ownerPayee: "owner-payee",
  property: (propertyId: string): string => `property-${propertyId}`,
  opening: (propertyId: string): string => `property-${propertyId}-opening`,
  startMonth: (propertyId: string): string => `property-${propertyId}-start`,
  deposits: (propertyId: string): string => `property-${propertyId}-deposits`,
} as const;

export type WarningLinkInput = { code: string; message: string; propertyId?: string; workOrderId?: string; rentMonth?: string };

export type WarningTarget =
  /** Another page; `href` may end in `#<anchor>`. */
  | { kind: "href"; href: string; label: string }
  /** A section on this page. */
  | { kind: "scroll"; anchor: string; label: string };

const ownerPage = (ownerId: string, anchor: string): string =>
  `/owner-statements/owners/${encodeURIComponent(ownerId)}#${anchor}`;

/** null = no place to fix it (or the warning lacks the id it needs). Labels end in " →". */
export function warningTarget(w: WarningLinkInput, ownerId: string): WarningTarget | null {
  const pid = w.propertyId;
  switch (w.code) {
    case "OPENING_BALANCE_NOT_SET":
    case "PREV_OWNER_BALANCE":
      return pid ? { kind: "href", href: ownerPage(ownerId, ANCHOR.opening(pid)), label: "Set opening balance →" } : null;
    case "START_MONTH_AFTER":
      return pid ? { kind: "href", href: ownerPage(ownerId, ANCHOR.startMonth(pid)), label: "Check first statement month →" } : null;
    case "DEPOSITS_NOT_SET":
      return pid ? { kind: "href", href: ownerPage(ownerId, ANCHOR.deposits(pid)), label: "Enter deposits →" } : null;
    case "CO_OWNED":
      return pid ? { kind: "href", href: ownerPage(ownerId, ANCHOR.property(pid)), label: "Review property links →" } : null;
    case "PAYEE_MISSING":
      return { kind: "href", href: ownerPage(ownerId, ANCHOR.ownerPayee), label: "Set payee →" };
    case "WO_MISSING_BILL":
    case "WO_AWAITING_REVIEW":
    case "WO_BEFORE_START":
    case "WO_BEFORE_START_MISSING_BILL": {
      // A warning about several work orders has no single id (and no link).
      if (!w.workOrderId) return null;
      const wo = /\bWO-\d+\b/.exec(w.message)?.[0] ?? "work order";
      return { kind: "href", href: `/work-orders/${encodeURIComponent(w.workOrderId)}`, label: `Open ${wo} →` };
    }
    case "RENT_UNPAID":
      // The Payments page for that rent month and this owner, showing the units still unpaid.
      return w.rentMonth
        ? {
            kind: "href",
            href: `/owner-statements/payments?month=${encodeURIComponent(w.rentMonth)}&owner=${encodeURIComponent(ownerId)}&status=unpaid`,
            label: "Open Payments page →",
          }
        : null;
    default:
      return null;
  }
}

const HIGHLIGHT = ["ring-2", "ring-primary", "ring-offset-2", "ring-offset-card", "rounded-xl"];

/**
 * Scrolls to the section with this id, outlines it for a moment and focuses its first enabled
 * control. false = not on the page (yet).
 */
export function revealSection(anchor: string): boolean {
  if (typeof document === "undefined") return false;
  const el = document.getElementById(anchor);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add(...HIGHLIGHT);
  window.setTimeout(() => el.classList.remove(...HIGHLIGHT), 2200);
  const control = el.querySelector<HTMLElement>(
    "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])",
  );
  control?.focus({ preventScroll: true });
  return true;
}
