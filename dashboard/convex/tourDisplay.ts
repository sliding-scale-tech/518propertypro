/**
 * How a tour's apartment, phone number and lead answers read: on the dashboard calendar, in the
 * Tour details dialog and in the Google Calendar event a booked tour creates. Pure (only phone.ts
 * is imported), so the dashboard can use it too and scripts/probes/tour_display.test.mjs tests it.
 */

import { toE164 } from "./phone";

/** "1 Washington Ave, Albany, NY 12210" -> "1 Washington Ave": the part someone says. */
export function streetOf(address: string): string {
  return address.split(",")[0].trim() || address.trim();
}

/** "1" -> "Unit 1", "4B" -> "Unit 4B"; a label that already says what it is stays as it is. */
export function unitPhrase(label: string): string {
  const l = label.trim();
  return /^(unit|apt\.?|apartment|suite|ste\.?|room|#)\s*/i.test(l) ? l : `Unit ${l}`;
}

export type TourApartmentSnapshot = {
  propertyAddress?: string | null;
  unitLabel?: string | null;
};

/**
 * One line naming the apartment, or null when no building was recorded.
 *  - "short", for a calendar tile: "1 Washington Ave · Unit 1"
 *  - "long", for the dialog and the event: "1 Washington Ave, Unit 1"
 */
export function apartmentLine(t: TourApartmentSnapshot, style: "short" | "long" = "long"): string | null {
  const address = t.propertyAddress?.trim();
  if (!address) return null;
  const street = streetOf(address);
  const unit = t.unitLabel?.trim();
  if (!unit) return street;
  return `${street}${style === "short" ? " · " : ", "}${unitPhrase(unit)}`;
}

/** The properties page's URL key for "show exactly this unit" (read by components/units/unit-inventory.tsx). */
export const EXACT_UNIT_PARAM = "units_unit";

/**
 * The dashboard page for a tour's apartment: the property page with its unit list narrowed to exactly
 * that unit (`units_unit`, an exact match, so "1" never also shows "10" or "1A"), or the property page
 * alone. Null without a property.
 */
export function apartmentHref(propertyId: string | null | undefined, unitLabel?: string | null): string | null {
  if (!propertyId) return null;
  const qs = new URLSearchParams({ property: propertyId });
  const unit = unitLabel?.trim();
  if (unit) qs.set(EXACT_UNIT_PARAM, unit);
  return `/properties?${qs.toString()}`;
}

/** Whether a unit row is the one an exact-unit link names: the same label, ignoring case and spacing. */
export function isExactUnit(unitNumber: string, wanted: string | null | undefined): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const w = norm(wanted ?? "");
  return w === "" || norm(unitNumber) === w;
}

/**
 * A stored phone number as people read it. A North American number reads "(518) 555-0123", any
 * other valid number in E.164; `tel` is the number to dial. A value that is not a valid number is
 * shown exactly as stored, with no `tel`, so nobody taps a link that dials the wrong person.
 */
export function phoneForDisplay(raw: string | null | undefined): { text: string; tel: string | null } | null {
  const stored = raw?.trim();
  if (!stored) return null;
  const e164 = toE164(stored);
  if (!e164) return { text: stored, tel: null };
  const nanp = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return { text: nanp ? `(${nanp[1]}) ${nanp[2]}-${nanp[3]}` : e164, tel: e164 };
}

/** A lead answer as text: booleans (and "true"/"false" that arrived as strings) read Yes / No. */
export function formatAnswer(value: string | number | boolean | null | undefined): string {
  if (value === true || value === "true") return "Yes";
  if (value === false || value === "false") return "No";
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * The Google Calendar event's text for a tour, so the team member sees where it is on their phone.
 * A tour with no chosen apartment has no location at all: it is never placed at the team's first
 * or default building (conv_0001m7acgw57fpwagbr0ydncsybk put a Van Vranken tour at 1 Washington Avenue).
 */
export function tourEventText(t: {
  /** The chosen building's name; null when no apartment was chosen. */
  propertyName: string | null;
  propertyAddress: string | null;
  unitLabel?: string | null;
  /** True only when the tour is for a building the caller chose (matched on the team's own buildings). */
  apartmentChosen: boolean;
  callerName?: string;
  callerPhone?: string;
}): { summary: string; description: string; location?: string } {
  const who = t.callerName || "Prospective renter";
  const apartment = t.apartmentChosen ? apartmentLine(t, "long") : null;
  const phone = phoneForDisplay(t.callerPhone);
  const address = t.apartmentChosen ? t.propertyAddress?.trim() || null : null;
  return {
    summary: apartment ? `Property tour: ${who}, ${apartment}` : `Property tour: ${who}`,
    description: [
      apartment
        ? `Tour of ${t.propertyName || streetOf(t.propertyAddress ?? "")}, booked by Sarah (Simplr).`
        : "Tour booked by Sarah (Simplr).",
      apartment ? `Apartment: ${apartment}` : "Apartment: none chosen yet. Confirm the address with the renter.",
      t.callerName ? `Renter: ${t.callerName}` : null,
      phone ? `Phone: ${phone.text}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    // The street address turns the event's location into a tappable map link in Google Calendar.
    ...(address ? { location: address } : {}),
  };
}

// --- What Sarah says about a booked tour (request_tour / reschedule_tour results) ----------------

/** " to see Unit 2B at 1635 Van Vranken Avenue, Schenectady, NY", or " at <address>" without a unit. */
function placePhrase(address: string, unitLabel?: string | null): string {
  const unit = unitLabel?.trim();
  return unit ? ` to see ${unitPhrase(unit)} at ${address}` : ` at ${address}`;
}

/** Said when a tour has no building: the team confirms it, Sarah never names one. */
export const TEAM_CONFIRMS_ADDRESS = "The team will confirm the address with you.";

/**
 * request_tour's say line. The address (and unit) only when the tour really is for a chosen building;
 * without one there is no address at all, never the team's first building.
 *   "You're all set for Tuesday, November 17 at 2:00 PM with Nina at 1635 Van Vranken Avenue, Schenectady, NY."
 *   "You're all set for Tuesday, November 17 at 2:00 PM with Nina to see Unit 2B at 1635 Van Vranken Avenue, Schenectady, NY."
 *   "You're all set for Tuesday, November 17 at 2:00 PM with Nina. The team will confirm the address with you."
 */
export function tourBookedSay(t: {
  when: string;
  memberFirstName: string;
  address?: string | null;
  unitLabel?: string | null;
}): string {
  const address = t.address?.trim();
  const base = `You're all set for ${t.when} with ${t.memberFirstName}`;
  return address ? `${base}${placePhrase(address, t.unitLabel)}.` : `${base}. ${TEAM_CONFIRMS_ADDRESS}`;
}

/** reschedule_tour's say line after the apartment of a booked tour was corrected (same day and time). */
export function tourApartmentChangedSay(t: { when: string; address: string; unitLabel?: string | null }): string {
  return `Thanks for catching that. Your tour on ${t.when} is now${placePhrase(t.address.trim(), t.unitLabel)}.`;
}

/** reschedule_tour's say line when the corrected building could not be matched or saved. */
export const TOUR_ADDRESS_NOT_CHANGED_SAY =
  "Sorry about that. The team will confirm the address with you before the tour.";
