/**
 * B45 "Edit unit": the pure rules behind the one Edit unit dialog and its one server mutation
 * (unitEdit.saveAll). No Convex server imports, erasable TypeScript only, so the dialog runs the
 * SAME diff, validation and permission rules as the server (same messages), and
 * scripts/probes/unit_edit.test.mjs runs them directly.
 *
 *   - unitEditChanges: which fields really change (compared with the stored unit), section by section.
 *   - validateUnitEdit: every failing field (field -> message), in UNIT_EDIT_ORDER.
 *   - unitEditPermissions / deniedSection: who may change which section.
 *   - rosterSync: what the roster fields become after a tenancy change, and the precedence of a
 *     manual roster edit made in the same save.
 */

import { BULK_REASON_MAX, BULK_REASON_MIN, cleanReason } from "./bulkReassignLib";
import { isRealDate, validateMoveOut, validateNewRenter } from "./leaseLib";
import type { FieldErrors } from "./leaseLib";
import { UNIT_FIELD_MSG, parseBathroomsInput, parseFloorInput } from "./unitFieldsPolicy";
import { validateRentChangeAll } from "./unitRentPolicy";

type Raw = string | null | undefined;

// --- Roster values and their labels (selects show the label, never the stored value) -------------

export const OCCUPANCY_VALUES = ["occupied", "occupied_leaving", "vacant", "vacant_not_ready"] as const;
export type Occupancy = (typeof OCCUPANCY_VALUES)[number];
export const OCCUPANCY_LABEL: Record<Occupancy, string> = {
  occupied: "Occupied",
  occupied_leaving: "Occupied (leaving)",
  vacant: "Vacant",
  vacant_not_ready: "Vacant, not rent ready",
};

export const LEASE_TYPE_VALUES = ["fixed", "month_to_month", "vacant", "unknown"] as const;
export type LeaseType = (typeof LEASE_TYPE_VALUES)[number];
export const LEASE_TYPE_LABEL: Record<LeaseType, string> = {
  fixed: "Fixed term",
  month_to_month: "Month to month",
  vacant: "Vacant",
  unknown: "Unknown",
};

export const RENT_PAID_TO_VALUES = ["company", "owner_direct", "included_in_other_unit"] as const;
export type RentPaidTo = (typeof RENT_PAID_TO_VALUES)[number];
export const RENT_PAID_TO_LABEL: Record<RentPaidTo, string> = {
  company: "Paid to the company",
  owner_direct: "Owner collects rent directly",
  included_in_other_unit: "Included in another unit's rent",
};

export const MAX_UNIT_NUMBER = 40;
export const MAX_UNIT_TYPE = 20;
export const MAX_PARKING = 200;
export const MAX_LEASING_FACTS = 2000;

export const UNIT_EDIT_MSG = {
  nothing: "No changes to save.",
  unitNumberLong: `Keep the unit number under ${MAX_UNIT_NUMBER} characters.`,
  typeLong: `Keep the unit type under ${MAX_UNIT_TYPE} characters.`,
  parkingLong: `Keep the parking note under ${MAX_PARKING} characters.`,
  leasingLong: `Keep the leasing notes under ${MAX_LEASING_FACTS.toLocaleString("en-US")} characters.`,
  availableFromInvalid: "Enter the available-from date as a real date, like 2026-12-01.",
  occupancyInvalid: "Choose the roster occupancy from the list.",
  leaseTypeInvalid: "Choose the lease type from the list.",
  rentPaidToInvalid: "Choose who the rent is paid to from the list.",
  residentGone: "That resident has already moved out. Close the dialog and open it again.",
  moveOutForReplace: (name: string) => `Move out ${name} too, or turn off "Replace with a new renter".`,
  managerMissing: "Choose the asset manager.",
  reasonMissing: "Enter a reason for changing the asset manager.",
  reasonShort: `Enter a reason of at least ${BULK_REASON_MIN} characters.`,
  reasonLong: `The reason is too long (max ${BULK_REASON_MAX} characters).`,
  // Permissions (server; the dialog shows these sections read-only instead).
  notYourUnit: "You can only edit units you manage.",
  rentAdminOnly: "Only an admin can change the rent. Ask an admin.",
  managerAdminOnly: "Only an admin can change the asset manager. Ask an admin.",
  newRenterNotYours: "You can only add residents to units you manage.",
  moveOutNotYours: "You can only record move-outs for units you manage.",
} as const;

// --- Input shapes ---------------------------------------------------------------------------------

export type DetailsRaw = {
  unitNumber?: Raw;
  bedrooms?: Raw;
  floor?: Raw;
  bathrooms?: Raw;
  isTopFloor?: boolean | null;
  parking?: Raw;
  availableFrom?: Raw;
  leasingFacts?: Raw;
};
/** Selects: undefined = not touched; null or "" = "Not stated" (cleared). `available`: null = not touched. */
export type RosterRaw = { available?: boolean | null; occupancy?: Raw; leaseType?: Raw; rentPaidTo?: Raw };
export type RentRaw = { rent?: Raw; effectiveMonth?: Raw; note?: Raw };
export type MoveOutRaw = { residentId?: Raw; moveOutDate?: Raw };
export type NewRenterRaw = {
  fullName?: Raw;
  phones?: ReadonlyArray<Raw> | null;
  email?: Raw;
  leaseStart?: Raw;
  leaseEnd?: Raw;
};
export type ManagerRaw = { assetManagerUserId?: Raw; reason?: Raw };

/** What the dialog sends and the server receives. Every section is optional. */
export type UnitEditRaw = {
  details?: DetailsRaw | null;
  roster?: RosterRaw | null;
  rent?: RentRaw | null;
  moveOuts?: ReadonlyArray<MoveOutRaw> | null;
  newRenter?: NewRenterRaw | null;
  manager?: ManagerRaw | null;
};

/** The stored unit, as far as the dialog edits it. */
export type UnitSnapshot = {
  unitNumber: string;
  bedrooms: string;
  floor?: number | null;
  bathrooms?: number | null;
  isTopFloor?: boolean | null;
  parking?: string | null;
  availableFrom?: string | null;
  leasingFacts?: string | null;
  available: boolean;
  occupancy?: string | null;
  leaseType?: string | null;
  rentPaidTo?: string | null;
  assetManagerUserId: string;
};

export type EditSection = "details" | "roster" | "rent" | "tenancy" | "manager";
export const SECTION_ORDER: readonly EditSection[] = ["details", "roster", "rent", "tenancy", "manager"];

const t = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const numText = (n: number | null | undefined): string => (n === null || n === undefined ? "" : String(n));

// --- Diff -----------------------------------------------------------------------------------------

/**
 * Only what really changes, compared with the stored unit. Used by the dialog (to send just the
 * edits, and to say "No changes to save.") and again by the server against the unit as it is
 * now, so a field someone else changed meanwhile is never overwritten by a stale copy.
 *
 * A number field whose text equals the stored value is unchanged, so an odd legacy value (a roster
 * 1.25 baths) is neither re-validated nor rewritten. Text that does not parse counts as a change,
 * so validation reports it. Rent counts when the new rent or its month is filled in; tenancy when
 * a move-out or a new renter is given; the asset manager when a different one is chosen (a blank
 * choice also counts, so validation can say "Choose the asset manager.").
 */
export function unitEditChanges(snap: UnitSnapshot, raw: UnitEditRaw): UnitEditRaw {
  const out: UnitEditRaw = {};

  const d = raw.details ?? undefined;
  if (d) {
    const dd: DetailsRaw = {};
    if (d.unitNumber != null && t(d.unitNumber) !== snap.unitNumber) dd.unitNumber = d.unitNumber;
    if (d.bedrooms != null && t(d.bedrooms) !== snap.bedrooms) dd.bedrooms = d.bedrooms;
    if (d.floor != null && t(d.floor) !== numText(snap.floor)) {
      const p = parseFloorInput(d.floor);
      if (!p.ok || (p.value ?? null) !== (snap.floor ?? null)) dd.floor = d.floor;
    }
    if (d.bathrooms != null && t(d.bathrooms) !== numText(snap.bathrooms)) {
      const p = parseBathroomsInput(d.bathrooms);
      if (!p.ok || (p.value ?? null) !== (snap.bathrooms ?? null)) dd.bathrooms = d.bathrooms;
    }
    if (typeof d.isTopFloor === "boolean" && d.isTopFloor !== (snap.isTopFloor ?? false)) dd.isTopFloor = d.isTopFloor;
    if (d.parking != null && t(d.parking) !== (snap.parking ?? "").trim()) dd.parking = d.parking;
    if (d.availableFrom != null && t(d.availableFrom) !== (snap.availableFrom ?? "")) dd.availableFrom = d.availableFrom;
    if (d.leasingFacts != null && t(d.leasingFacts) !== (snap.leasingFacts ?? "").trim()) dd.leasingFacts = d.leasingFacts;
    if (Object.keys(dd).length > 0) out.details = dd;
  }

  const r = raw.roster ?? undefined;
  if (r) {
    const rr: RosterRaw = {};
    if (typeof r.available === "boolean" && r.available !== snap.available) rr.available = r.available;
    for (const key of ["occupancy", "leaseType", "rentPaidTo"] as const) {
      if (r[key] === undefined) continue;
      const next = t(r[key]);
      if (next !== (snap[key] ?? "")) rr[key] = next === "" ? null : next;
    }
    if (Object.keys(rr).length > 0) out.roster = rr;
  }

  const rent = raw.rent ?? undefined;
  if (rent && (t(rent.rent) !== "" || t(rent.effectiveMonth) !== "")) out.rent = rent;

  const moves = (raw.moveOuts ?? []).filter((m) => m && t(m.residentId) !== "");
  // One entry per resident (the first wins).
  const seen = new Set<string>();
  const uniq = moves.filter((m) => {
    const id = t(m.residentId);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (uniq.length > 0) out.moveOuts = uniq;
  if (raw.newRenter) out.newRenter = raw.newRenter;

  const m = raw.manager ?? undefined;
  if (m && m.assetManagerUserId !== undefined && t(m.assetManagerUserId) !== snap.assetManagerUserId) out.manager = m;

  return out;
}

/** The sections a (diffed) change touches, in save order. */
export function editSections(c: UnitEditRaw): EditSection[] {
  const s: EditSection[] = [];
  if (c.details && Object.keys(c.details).length > 0) s.push("details");
  if (c.roster && Object.keys(c.roster).length > 0) s.push("roster");
  if (c.rent) s.push("rent");
  if ((c.moveOuts && c.moveOuts.length > 0) || c.newRenter) s.push("tenancy");
  if (c.manager) s.push("manager");
  return s;
}

// --- Validation -----------------------------------------------------------------------------------

/** The field key of a resident's move-out date in the dialog (and in a server error). */
export function moveOutField(residentId: string): string {
  return `moveOut:${residentId}`;
}

const NEW_RENTER_FIELDS = ["fullName", "phones", "phone0", "phone1", "phone2", "phone3", "phone4", "email", "leaseStart", "leaseEnd"] as const;

/** The on-screen order of every field, for "the first error" (toast + focus). */
export function unitEditOrder(residentIds: readonly string[]): string[] {
  return [
    "unitNumber",
    "bedrooms",
    "bathrooms",
    "floor",
    "isTopFloor",
    "parking",
    "availableFrom",
    "leasingFacts",
    "available",
    "occupancy",
    "leaseType",
    "rentPaidTo",
    "rent",
    "effectiveMonth",
    "note",
    ...residentIds.map(moveOutField),
    ...NEW_RENTER_FIELDS,
    "assetManagerUserId",
    "reason",
  ];
}

export type EditEnv = {
  /** The team's date (lease and move-out dates). */
  today: string;
  /** The business date the rent window is measured from (unitRent uses businessToday). */
  rentToday: string;
  /** The unit's active residents now. */
  residents: ReadonlyArray<{ _id: string; fullName: string }>;
};

/** Every failing field (field -> message) of a diffed change. Empty = valid. */
export function validateUnitEdit(c: UnitEditRaw, env: EditEnv): FieldErrors {
  const errs: FieldErrors = {};
  const d = c.details;
  if (d) {
    if (d.unitNumber !== undefined) {
      const s = t(d.unitNumber);
      if (s === "") errs.unitNumber = UNIT_FIELD_MSG.unitNumberMissing;
      else if (s.length > MAX_UNIT_NUMBER) errs.unitNumber = UNIT_EDIT_MSG.unitNumberLong;
    }
    if (d.bedrooms !== undefined) {
      const s = t(d.bedrooms);
      if (s === "") errs.bedrooms = UNIT_FIELD_MSG.typeMissing;
      else if (s.length > MAX_UNIT_TYPE) errs.bedrooms = UNIT_EDIT_MSG.typeLong;
    }
    if (d.floor !== undefined) {
      const p = parseFloorInput(d.floor ?? "");
      if (!p.ok) errs.floor = p.message;
    }
    if (d.bathrooms !== undefined) {
      const p = parseBathroomsInput(d.bathrooms ?? "");
      if (!p.ok) errs.bathrooms = p.message;
    }
    if (d.parking !== undefined && t(d.parking).length > MAX_PARKING) errs.parking = UNIT_EDIT_MSG.parkingLong;
    if (d.availableFrom !== undefined && t(d.availableFrom) !== "" && !isRealDate(t(d.availableFrom))) {
      errs.availableFrom = UNIT_EDIT_MSG.availableFromInvalid;
    }
    if (d.leasingFacts !== undefined && t(d.leasingFacts).length > MAX_LEASING_FACTS) errs.leasingFacts = UNIT_EDIT_MSG.leasingLong;
  }

  const r = c.roster;
  if (r) {
    if (r.occupancy != null && !(OCCUPANCY_VALUES as readonly string[]).includes(r.occupancy)) errs.occupancy = UNIT_EDIT_MSG.occupancyInvalid;
    if (r.leaseType != null && !(LEASE_TYPE_VALUES as readonly string[]).includes(r.leaseType)) errs.leaseType = UNIT_EDIT_MSG.leaseTypeInvalid;
    if (r.rentPaidTo != null && !(RENT_PAID_TO_VALUES as readonly string[]).includes(r.rentPaidTo)) errs.rentPaidTo = UNIT_EDIT_MSG.rentPaidToInvalid;
  }

  if (c.rent) Object.assign(errs, validateRentChangeAll({ ...c.rent, today: env.rentToday }));

  const moving = new Set<string>();
  for (const m of c.moveOuts ?? []) {
    const id = t(m.residentId);
    moving.add(id);
    const field = moveOutField(id);
    if (!env.residents.some((x) => x._id === id)) {
      errs[field] = UNIT_EDIT_MSG.residentGone;
      continue;
    }
    const e = validateMoveOut({ moveOutDate: m.moveOutDate, today: env.today });
    if (e.moveOutDate) errs[field] = e.moveOutDate;
  }

  if (c.newRenter) {
    // The rent is section 3 (Rent), and the move-out dates are per resident above.
    const nr = validateNewRenter({ ...c.newRenter, hasCurrent: false, rent: null, today: env.today });
    Object.assign(errs, nr);
    for (const res of env.residents) {
      if (!moving.has(res._id)) errs[moveOutField(res._id)] = UNIT_EDIT_MSG.moveOutForReplace(res.fullName);
    }
  }

  if (c.manager) {
    if (t(c.manager.assetManagerUserId) === "") errs.assetManagerUserId = UNIT_EDIT_MSG.managerMissing;
    const reason = cleanReason(c.manager.reason);
    if (reason === "") errs.reason = UNIT_EDIT_MSG.reasonMissing;
    else if (reason.length < BULK_REASON_MIN) errs.reason = UNIT_EDIT_MSG.reasonShort;
    else if (reason.length > BULK_REASON_MAX) errs.reason = UNIT_EDIT_MSG.reasonLong;
  }
  return errs;
}

// --- Permissions ----------------------------------------------------------------------------------

/**
 * Who the viewer is FOR THIS UNIT. `ownAm` = holds the asset_manager role AND is this unit's
 * designated asset manager (covering a colleague's unit does not count: covering is read-only).
 */
export type UnitRoles = { admin: boolean; accountant: boolean; ownAm: boolean };

export type UnitEditPermissions = {
  details: boolean;
  roster: boolean;
  rent: boolean;
  moveOut: boolean;
  newRenter: boolean;
  manager: boolean;
  remove: boolean;
};

/**
 * The matrix. Admin: everything. The unit's own asset manager: details, availability & roster,
 * move out and new renter (adding residents to units they manage). Rent: admin or accountant (the
 * finance rule unitRent.changeRent already had). Asset manager change and Remove unit: admin only.
 */
export function unitEditPermissions(r: UnitRoles): UnitEditPermissions {
  const unitPerson = r.admin || r.ownAm;
  return {
    details: unitPerson,
    roster: unitPerson,
    rent: r.admin || r.accountant,
    moveOut: unitPerson,
    newRenter: unitPerson,
    manager: r.admin,
    remove: r.admin,
  };
}

/** True when the viewer may change anything in the dialog (the Edit unit button shows). */
export function canOpenUnitEdit(p: UnitEditPermissions): boolean {
  return p.details || p.roster || p.rent || p.moveOut || p.newRenter || p.manager || p.remove;
}

/** The first section of a change the viewer may not make: its field and message, or null. */
export function deniedSection(p: UnitEditPermissions, c: UnitEditRaw): { field: string; message: string } | null {
  if (c.details && Object.keys(c.details).length > 0 && !p.details) {
    return { field: Object.keys(c.details)[0], message: UNIT_EDIT_MSG.notYourUnit };
  }
  if (c.roster && Object.keys(c.roster).length > 0 && !p.roster) {
    return { field: Object.keys(c.roster)[0], message: UNIT_EDIT_MSG.notYourUnit };
  }
  if (c.rent && !p.rent) return { field: "rent", message: UNIT_EDIT_MSG.rentAdminOnly };
  if (c.moveOuts && c.moveOuts.length > 0 && !p.moveOut) {
    return { field: moveOutField(t(c.moveOuts[0].residentId)), message: UNIT_EDIT_MSG.moveOutNotYours };
  }
  if (c.newRenter && !p.newRenter) return { field: "fullName", message: UNIT_EDIT_MSG.newRenterNotYours };
  if (c.manager && !p.manager) return { field: "assetManagerUserId", message: UNIT_EDIT_MSG.managerAdminOnly };
  return null;
}

// --- Roster sync ----------------------------------------------------------------------------------

export type RosterPatch = { occupancy?: Occupancy; leaseType?: LeaseType };

/**
 * The roster fields after a tenancy change (owner statements read them to decide vacancy:
 * rosPolicy.rosterSaysVacant = occupancy vacant / vacant_not_ready, or lease type vacant):
 *   - a new renter: occupancy "occupied"; lease type "fixed" when the lease has an end, else
 *     "month_to_month";
 *   - a move-out that leaves nobody in the unit: occupancy "vacant" and lease type "vacant";
 *   - a move-out with others still living there: nothing changes.
 * Precedence: a roster field the user set by hand in the SAME save (`manual`) wins and is left
 * alone. Values already equal are left out, so nothing is written or audited for them.
 */
export function rosterSync(a: {
  newRenter: { leaseEnd?: string | null } | null;
  movedOut: number;
  leftAfter: number;
  current: { occupancy?: string | null; leaseType?: string | null };
  manual?: { occupancy?: boolean; leaseType?: boolean };
}): RosterPatch {
  let want: RosterPatch = {};
  if (a.newRenter) {
    want = { occupancy: "occupied", leaseType: t(a.newRenter.leaseEnd) !== "" ? "fixed" : "month_to_month" };
  } else if (a.movedOut > 0 && a.leftAfter === 0) {
    want = { occupancy: "vacant", leaseType: "vacant" };
  }
  const out: RosterPatch = {};
  if (want.occupancy && !a.manual?.occupancy && a.current.occupancy !== want.occupancy) out.occupancy = want.occupancy;
  if (want.leaseType && !a.manual?.leaseType && a.current.leaseType !== want.leaseType) out.leaseType = want.leaseType;
  return out;
}

/**
 * Availability after a tenancy change. A new renter takes the unit off the market (false); a
 * move-out offers it again only when asked (`makeAvailable`). A manual Available choice in the
 * same save wins. null = leave it.
 */
export function availabilitySync(a: {
  newRenter: boolean;
  makeAvailable: boolean;
  current: boolean;
  manual: boolean;
}): boolean | null {
  if (a.manual) return null;
  if (a.newRenter) return a.current ? false : null;
  if (a.makeAvailable) return a.current ? null : true;
  return null;
}
