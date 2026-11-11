import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { normalizeUnitKey } from "./units";
import { OWNER_EMAIL_SEPARATOR, parseOwnerEmails, rosterAddressFormatted } from "./rosterFields";

/**
 * Pure mapping between one row of the normalized client roster
 * (docs/rosters/518-unit-rosters-normalized.xlsx, contract: docs/rosters/unit-fields-spec.md)
 * and the properties / units / residents / unitSourceRows fields. No database access.
 *
 * Both directions live here so the importer and the lossless round-trip check read the same
 * tables. Every label is matched exactly; anything outside a table throws a ConvexError naming
 * the row and column, so a new or misspelled value fails the import instead of being guessed.
 *
 * "-" in a data column means "not stated" and becomes an absent field, never 0 or "".
 */

// --- Input row ---------------------------------------------------------------

const cell = v.union(v.string(), v.number(), v.null());

/**
 * One roster row as scripts/roster/import_roster.py emits it. Review columns (Please check,
 * Correct? (Y/N), Corrections) and "Phone Number" (not imported yet, user decision 2026-11-03)
 * are never sent.
 */
export const rosterRowValidator = v.object({
  rowId: cell,
  property: cell,
  unit: cell,
  category: cell,
  city: cell,
  unitType: cell,
  floor: cell,
  bedrooms: cell,
  bathrooms: cell,
  status: cell,
  tenants: cell,
  leaseType: cell,
  leaseEnd: cell,
  rent: cell,
  rentPaidTo: cell,
  heatingFuel: cell,
  gasPaidBy: cell,
  electricPaidBy: cell,
  laundry: cell,
  selling: cell,
  assetManager: cell,
  // Property-level: one owner pair per building (Make Up 2026-11-03; empty on Gold and Silver).
  ownersName: cell,
  ownersEmail: cell,
  notes: cell,
  sourceUnit: cell,
  sourceCom: cell,
  sourceFloor: cell,
  sourceTenants: cell,
  sourceLeaseEnd: cell,
  sourceBedBath: cell,
  sourceRent: cell,
  sourceGeTl: cell,
  sourceLmat: cell,
  sourceLaundry: cell,
  sourceGasPaid: cell,
  sourceElectricPaid: cell,
  sourceGasElectric: cell,
  sourceWho: cell,
  sourceWd: cell,
  sourcePropertyHeading: cell,
  sourceLayoutNotes: cell,
  sourceSection: cell,
  page: cell,
  managerFeedback: cell,
});
export type RosterRow = Infer<typeof rosterRowValidator>;
type Cell = RosterRow[keyof RosterRow];

export const categoryValidator = v.union(v.literal("gold"), v.literal("silver"), v.literal("make_up"));
export type Category = Infer<typeof categoryValidator>;

// --- Label tables (sheet label -> stored value) ----------------------------------

const CATEGORY = { Gold: "gold", Silver: "silver", "Make Up": "make_up" } as const;

/** Decision 8: the asset manager each roster names. Checked, so a stray name fails loudly. */
const EXPECTED_MANAGER: Record<Category, string> = { gold: "Nina", silver: "Nikki", make_up: "Delia" };

const UNIT_TYPE = {
  Residential: "residential",
  Commercial: "commercial",
  Storefront: "storefront",
  Garage: "garage",
  Office: "office",
  Other: "other",
  Unknown: "unknown",
} as const;

// The en dash is how the sheet's dropdown writes these two values.
const OCCUPANCY = {
  Occupied: "occupied",
  "Occupied – leaving": "occupied_leaving",
  Vacant: "vacant",
  "Vacant – not rent ready": "vacant_not_ready",
} as const;

// Decision 3 (client, 2026-10-30): At-will = Month-to-month, so "At-will" is NOT accepted.
const LEASE_TYPE = {
  "Fixed term": "fixed",
  "Month-to-month": "month_to_month",
  Vacant: "vacant",
  Unknown: "unknown",
} as const;

const RENT_PAID_TO = {
  "518 Property Pro": "company",
  "Owner directly": "owner_direct",
  "Included in another unit's rent": "included_in_other_unit",
} as const;

const HEATING_FUEL = { Gas: "gas", Electric: "electric", Both: "both" } as const;
const PAYER = { Tenant: "tenant", Landlord: "landlord" } as const;

const LAUNDRY = {
  None: "none",
  "Shared in building": "shared_building",
  "Hookups in unit": "hookups",
  "Provided in unit": "provided",
  Unknown: "unknown",
} as const;

/** Decision 3b: "Source: Section" -> ownership. Gold and Silver have no section ("-"). */
const MAKE_UP_SECTION_OWNERSHIP = {
  "Delia - Rentals": "company_owned",
  "Delia Management Properties": "managed",
} as const;

/**
 * Units rented one room at a time, by roster and property. Only what a manager said: Silver
 * 687 State Street B1-B4 is "one apartment rented per room" (Software Answers, third pass). The
 * importer checks that each listed row carries that note, so this table can't silently drift
 * from the sheet. Sarah reads leasingFacts, which says it is a room, never "a 4-bedroom".
 */
const ROOM_RENTALS: Partial<Record<Category, Record<string, { units: string[]; managerNote: string }>>> = {
  silver: {
    "687 State Street": {
      units: ["B1", "B2", "B3", "B4"],
      managerNote: "Manager: one apartment rented per room",
    },
  },
};

// --- Helpers ----------------------------------------------------------------------

const HIDDEN = "(names hidden)";
const OWNER_HIDDEN = "(owner hidden)";

function fail(rowId: string, column: string, value: Cell, why = "is not an allowed value"): never {
  throw new ConvexError(`${rowId}: ${column} ${JSON.stringify(value)} ${why}.`);
}

/** A data column: always a value or "-" (spec: no empty cell in a derived data column). */
function str(row: RosterRow, key: keyof RosterRow, column: string): string {
  const value = row[key];
  if (typeof value !== "string" || value === "") fail(String(row.rowId), column, value, "must be text or \"-\"");
  return value;
}

function lookup<T extends Record<string, string>>(
  row: RosterRow,
  key: keyof RosterRow,
  column: string,
  table: T,
): T[keyof T] | undefined {
  const value = str(row, key, column);
  if (value === "-") return undefined;
  if (!Object.prototype.hasOwnProperty.call(table, value)) fail(String(row.rowId), column, value);
  return table[value as keyof T];
}

/** A Source/notes column: verbatim text, or absent when the cell is empty. */
function optText(row: RosterRow, key: keyof RosterRow, column: string): string | undefined {
  const value = row[key];
  if (value === null) return undefined;
  if (typeof value !== "string") fail(String(row.rowId), column, value, "must be text");
  return value === "" ? undefined : value;
}

function numberOrDash(row: RosterRow, key: keyof RosterRow, column: string): number | undefined {
  const value = row[key];
  if (value === "-") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(String(row.rowId), column, value, "must be a number or \"-\"");
  return value;
}

function reverse<T extends Record<string, string>>(table: T): Record<string, string> {
  return Object.fromEntries(Object.entries(table).map(([label, value]) => [value, label]));
}

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Bedroom count -> the string Sarah's bedrooms filter matches (UNIT_TYPES in the UI). */
export function bedroomsLabel(count: number | undefined, rentedAs: "room" | undefined): string {
  if (rentedAs === "room") return "room";
  if (count === undefined) return "-";
  if (count === 0) return "studio";
  if (count === 1) return "1br";
  if (count === 2) return "2br";
  return "3br+";
}

function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/** What Sarah reads for a room rental: a room, its apartment's size, and the per-room rent. */
export function roomLeasingFacts(apartmentBedrooms: number, rent: number | undefined): string {
  const size = `a room in a shared ${apartmentBedrooms}-bedroom apartment`;
  return rent === undefined
    ? `This is ${size}, not a whole apartment. The rent is not stated; do not quote one.`
    : `This is ${size}, ${money(rent)} a month for the room. Describe it as a room in a shared ` +
        `${apartmentBedrooms}-bedroom apartment, never as a ${apartmentBedrooms}-bedroom unit: the rent is for one room, not the whole apartment.`;
}

// --- Row -> database fields --------------------------------------------------------

export type MappedProperty = {
  name: string;
  category: Category;
  ownership: "company_owned" | "managed";
  selling: true | undefined;
  city: string | undefined;
  sourceSection: string | undefined;
  intendedAssetManagerName: string;
  addressFormatted: string;
  /** Absent when the sheet's owner cells are empty: the import then leaves the stored owner alone. */
  ownerName: string | undefined;
  /** Lowercase, in sheet order; properties.ownerEmail is the first. */
  ownerEmails: string[] | undefined;
};

/** Keys of MappedProperty whose values are owner data: never put in an error message. */
const OWNER_KEYS = new Set<keyof MappedProperty>(["ownerName", "ownerEmails"]);

/** An owner cell: text, or absent when empty. "-" is refused so "not known" has one spelling. */
function ownerCell(row: RosterRow, key: "ownersName" | "ownersEmail", column: string): string | undefined {
  const value = row[key];
  if (value === null) return undefined;
  if (typeof value !== "string") fail(String(row.rowId), column, OWNER_HIDDEN, "must be text");
  if (value.trim() === "") return undefined;
  if (value.trim() === "-") fail(String(row.rowId), column, "-", "is not allowed here; leave the cell empty when the owner is not known");
  return value;
}

/**
 * How an owner cell compares in the lossless check: the name trimmed, the emails lowercased
 * (that is how they are stored; user decision 2026-11-03). Every other column compares exactly.
 */
export function ownerCellForCompare(key: string, value: string | number | null): string | number | null {
  if (key !== "ownersName" && key !== "ownersEmail") return value;
  if (typeof value !== "string") return value;
  if (value.trim() === "") return null;
  if (key === "ownersName") return value.trim();
  return value.split(OWNER_EMAIL_SEPARATOR).map((e) => e.trim().toLowerCase()).join(OWNER_EMAIL_SEPARATOR);
}

/** The unit columns the roster owns. Absent = "-". */
export type MappedUnitFields = {
  unitNumber: string;
  unitNumberKey: string;
  unitType: Doc<"units">["unitType"];
  floor: number | undefined;
  floorRaw: string | undefined;
  bedrooms: string;
  bedroomsCount: number | undefined;
  bathrooms: number | undefined;
  rentedAs: "room" | undefined;
  occupancy: Doc<"units">["occupancy"];
  leaseType: Doc<"units">["leaseType"];
  leaseEnd: string | undefined;
  rent: number | undefined;
  rentPaidTo: Doc<"units">["rentPaidTo"];
  heatingFuel: Doc<"units">["heatingFuel"];
  gasPaidBy: Doc<"units">["gasPaidBy"];
  electricPaidBy: Doc<"units">["electricPaidBy"];
  laundry: Doc<"units">["laundry"];
  available: boolean;
  /** Set only for room rentals; the importer leaves other units' leasingFacts alone. */
  leasingFacts: string | undefined;
};

export type MappedSourceRow = Omit<
  Doc<"unitSourceRows">,
  "_id" | "_creationTime" | "orgId" | "propertyId" | "unitId" | "updatedAt"
>;

export type MappedRow = {
  rowId: string;
  property: MappedProperty;
  unit: MappedUnitFields;
  tenants: string[];
  source: MappedSourceRow;
};

export function mapRosterRow(row: RosterRow, category: Category): MappedRow {
  const rowId = row.rowId;
  if (typeof rowId !== "string" || !/^[GSM]-\d{3,}$/.test(rowId)) {
    throw new ConvexError(`Row ID ${JSON.stringify(rowId)} is not like S-001.`);
  }
  const prefix = { gold: "G", silver: "S", make_up: "M" }[category];
  if (!rowId.startsWith(`${prefix}-`)) fail(rowId, "Row ID", rowId, `does not belong to the ${category} roster`);

  const categoryLabel = str(row, "category", "Category");
  if (lookup(row, "category", "Category", CATEGORY) !== category) {
    fail(rowId, "Category", categoryLabel, `is not the roster being imported (${category})`);
  }

  // --- property-level columns
  const name = str(row, "property", "Property");
  if (name === "-" || name !== name.trim() || /\s{2,}/.test(name)) fail(rowId, "Property", name, "is not a clean address");
  const cityRaw = str(row, "city", "City");
  const city = cityRaw === "-" ? undefined : cityRaw;
  const sellingRaw = str(row, "selling", "Selling");
  if (sellingRaw !== "Yes" && sellingRaw !== "-") fail(rowId, "Selling", sellingRaw);
  const sectionRaw = str(row, "sourceSection", "Source: Section");
  let ownership: MappedProperty["ownership"];
  if (category === "make_up") {
    if (!Object.prototype.hasOwnProperty.call(MAKE_UP_SECTION_OWNERSHIP, sectionRaw)) {
      fail(rowId, "Source: Section", sectionRaw);
    }
    ownership = MAKE_UP_SECTION_OWNERSHIP[sectionRaw as keyof typeof MAKE_UP_SECTION_OWNERSHIP];
  } else {
    if (sectionRaw !== "-") fail(rowId, "Source: Section", sectionRaw, "must be \"-\" outside Make Up");
    ownership = "managed";
  }
  const manager = str(row, "assetManager", "Asset manager");
  if (manager !== EXPECTED_MANAGER[category]) {
    fail(rowId, "Asset manager", manager, `is not ${EXPECTED_MANAGER[category]} (decision 8)`);
  }
  // Owners (user decision 2026-11-03): property-level, the name trimmed, every email validated.
  // Errors never show the owner's name or a full email.
  const ownerNameRaw = ownerCell(row, "ownersName", "Owners Name")?.trim();
  if (ownerNameRaw !== undefined && ownerNameRaw.length > 120) {
    fail(rowId, "Owners Name", OWNER_HIDDEN, "is longer than 120 characters");
  }
  const ownerEmailCell = ownerCell(row, "ownersEmail", "Owners Email Address");
  let ownerEmails: string[] | undefined;
  if (ownerEmailCell !== undefined) {
    const parsed = parseOwnerEmails(ownerEmailCell);
    if ("error" in parsed) throw new ConvexError(`${rowId}: Owners Email Address ${parsed.error}.`);
    ownerEmails = parsed.emails;
  }
  const property: MappedProperty = {
    name,
    category,
    ownership,
    selling: sellingRaw === "Yes" ? true : undefined,
    city,
    sourceSection: sectionRaw === "-" ? undefined : sectionRaw,
    intendedAssetManagerName: manager,
    addressFormatted: rosterAddressFormatted(name, city),
    ownerName: ownerNameRaw || undefined,
    ownerEmails,
  };

  // --- unit-level columns
  const unitNumber = row.unit;
  if (typeof unitNumber !== "string" || unitNumber.trim() === "") fail(rowId, "Unit", unitNumber, "must be text");
  const unitNumberKey = normalizeUnitKey(unitNumber);
  // Unit "-" = the roster names no unit because the building is one dwelling (Silver S-017,
  // 9 Lexington Court: "Only one unit. It is a townhouse."). Kept verbatim with an empty key;
  // assertSameProperty only allows that when it is the property's only unit.
  if (!unitNumberKey && unitNumber !== "-") fail(rowId, "Unit", unitNumber, "has no letters or digits to match on");

  const unitType = lookup(row, "unitType", "Unit type", UNIT_TYPE);
  if (unitType === undefined) fail(rowId, "Unit type", "-", "must be stated");

  let floor: number | undefined;
  let floorRaw: string | undefined;
  const floorCell = row.floor;
  if (typeof floorCell === "number") {
    if (!Number.isInteger(floorCell) || floorCell < 0) fail(rowId, "Floor", floorCell, "must be a whole number");
    floor = floorCell;
  } else if (floorCell === "Basement") {
    floor = 0; // decision: basement sorts below floor 1 and is never a top floor
    floorRaw = "Basement";
  } else if (typeof floorCell === "string" && floorCell !== "" && floorCell !== "-") {
    if (/^-?\d+(\.\d+)?$/.test(floorCell.trim())) fail(rowId, "Floor", floorCell, "is a number stored as text");
    floorRaw = floorCell;
  } else if (floorCell !== "-") {
    fail(rowId, "Floor", floorCell, "must be a number, text or \"-\"");
  }

  const bedroomsCount = numberOrDash(row, "bedrooms", "Bedrooms");
  if (bedroomsCount !== undefined && (!Number.isInteger(bedroomsCount) || bedroomsCount < 0)) {
    fail(rowId, "Bedrooms", bedroomsCount, "must be a whole number");
  }
  const bathrooms = numberOrDash(row, "bathrooms", "Bathrooms");
  if (bathrooms !== undefined && (bathrooms < 0 || !Number.isInteger(bathrooms * 2))) {
    fail(rowId, "Bathrooms", bathrooms, "must be in steps of .5");
  }

  const occupancy = lookup(row, "status", "Status", OCCUPANCY);
  const leaseType = lookup(row, "leaseType", "Lease type", LEASE_TYPE);
  const leaseEndRaw = str(row, "leaseEnd", "Lease end");
  if (leaseEndRaw !== "-" && !isRealDate(leaseEndRaw)) fail(rowId, "Lease end", leaseEndRaw, "must be a YYYY-MM-DD date or \"-\"");
  const leaseEnd = leaseEndRaw === "-" ? undefined : leaseEndRaw;

  const rent = numberOrDash(row, "rent", "Rent");
  if (rent !== undefined && !(rent > 0)) fail(rowId, "Rent", rent, "must be above 0 (not stated is \"-\")");
  if (rent !== undefined && Math.round(rent * 100) / 100 !== rent) fail(rowId, "Rent", rent, "has more than 2 decimals");

  const rentPaidTo = lookup(row, "rentPaidTo", "Rent paid to", RENT_PAID_TO);
  const heatingFuel = lookup(row, "heatingFuel", "Heating fuel", HEATING_FUEL);
  const gasPaidBy = lookup(row, "gasPaidBy", "Gas paid by", PAYER);
  const electricPaidBy = lookup(row, "electricPaidBy", "Electric paid by", PAYER);
  const laundry = lookup(row, "laundry", "Laundry", LAUNDRY);
  const notes = optText(row, "notes", "Notes");

  // --- tenants (decision 4): split only on "; ", pieces verbatim, "A & B" stays one name.
  const tenantsRaw = str(row, "tenants", "Tenants");
  const tenants = tenantsRaw === "-" ? [] : tenantsRaw.split("; ");
  for (const t of tenants) {
    // Errors name the row and column, never the tenant's name.
    if (t === "" || t !== t.trim() || t === "-") fail(rowId, "Tenants", HIDDEN, "has an empty or padded name");
    if (t.length > 120) fail(rowId, "Tenants", HIDDEN, "has a name longer than 120 characters");
  }
  if (new Set(tenants).size !== tenants.length) fail(rowId, "Tenants", HIDDEN, "lists the same name twice");
  const lives = occupancy === "occupied" || occupancy === "occupied_leaving";
  if (!lives && tenants.length > 0) fail(rowId, "Tenants", HIDDEN, `is set on a unit whose Status is not occupied`);

  // --- room rentals
  const roomCfg = ROOM_RENTALS[category]?.[name];
  const isRoom = roomCfg?.units.includes(unitNumber) ?? false;
  let leasingFacts: string | undefined;
  if (isRoom) {
    if (!notes?.includes(roomCfg!.managerNote)) {
      fail(rowId, "Notes", notes ?? null, `must contain "${roomCfg!.managerNote}" for a room rental`);
    }
    if (bedroomsCount === undefined || bedroomsCount < 2) fail(rowId, "Bedrooms", bedroomsCount ?? "-", "must give the shared apartment's size");
    leasingFacts = roomLeasingFacts(bedroomsCount, rent);
  }
  const rentedAs = isRoom ? ("room" as const) : undefined;

  // Decision 2: Sarah may offer a unit only when it is vacant (and rent ready), residential and
  // has a stated rent. Everything else, including "Vacant – not rent ready", is not offered.
  // User decision 2026-11-04: a unit in a property marked Selling is never offered, on any tab.
  const available =
    occupancy === "vacant" && unitType === "residential" && rent !== undefined && sellingRaw !== "Yes";

  const page = row.page;
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1) fail(rowId, "Source: Page", page, "must be a page number");

  return {
    rowId,
    property,
    unit: {
      unitNumber,
      unitNumberKey,
      unitType,
      floor,
      floorRaw,
      bedrooms: bedroomsLabel(bedroomsCount, rentedAs),
      bedroomsCount,
      bathrooms,
      rentedAs,
      occupancy,
      leaseType,
      leaseEnd,
      rent,
      rentPaidTo,
      heatingFuel,
      gasPaidBy,
      electricPaidBy,
      laundry,
      available,
      leasingFacts,
    },
    tenants,
    source: {
      category,
      rowId,
      page,
      property: name,
      unit: unitNumber,
      assetManager: manager,
      notes,
      sourceUnit: optText(row, "sourceUnit", "Source: Unit"),
      sourceCom: optText(row, "sourceCom", "Source: COM (unlabeled column)"),
      sourceFloor: optText(row, "sourceFloor", "Source: Floor"),
      sourceTenants: optText(row, "sourceTenants", "Source: Tenants"),
      sourceLeaseEnd: optText(row, "sourceLeaseEnd", "Source: Lease End/Exp"),
      sourceBedBath: optText(row, "sourceBedBath", "Source: Bed/Bath"),
      sourceRent: optText(row, "sourceRent", "Source: Rent"),
      sourceGeTl: optText(row, "sourceGeTl", "Source: G/E & T/L"),
      sourceLmat: optText(row, "sourceLmat", "Source: LMAT"),
      sourceLaundry: optText(row, "sourceLaundry", "Source: Laundry"),
      sourceGasPaid: optText(row, "sourceGasPaid", "Source: Gas Paid"),
      sourceElectricPaid: optText(row, "sourceElectricPaid", "Source: Electric Paid"),
      sourceGasElectric: optText(row, "sourceGasElectric", "Source: Gas/Electric"),
      sourceWho: optText(row, "sourceWho", "Source: Who"),
      sourceWd: optText(row, "sourceWd", "Source: W/D"),
      sourcePropertyHeading: optText(row, "sourcePropertyHeading", "Source: Property heading"),
      sourceLayoutNotes: optText(row, "sourceLayoutNotes", "Source: Layout notes"),
      sourceSection: optText(row, "sourceSection", "Source: Section"),
      managerFeedback: optText(row, "managerFeedback", "Source: Manager feedback"),
    },
  };
}

/** Every row of one building must agree on the building's own columns. */
export function assertSameProperty(rows: MappedRow[]): MappedProperty {
  const first = rows[0].property;
  for (const r of rows) {
    for (const key of Object.keys(first) as Array<keyof MappedProperty>) {
      if (JSON.stringify(r.property[key]) !== JSON.stringify(first[key])) {
        if (OWNER_KEYS.has(key)) {
          // Owners are per building; rows that disagree mean the sheet is wrong. No values shown.
          throw new ConvexError(
            `${r.rowId}: ${key === "ownerName" ? "Owners Name" : "Owners Email Address"} differs from ` +
              `${rows[0].rowId} for property "${first.name}"; every row of a building must name the same owner.`,
          );
        }
        throw new ConvexError(
          `${r.rowId}: ${key} ${JSON.stringify(r.property[key])} differs from ${rows[0].rowId} ` +
            `(${JSON.stringify(first[key])}) for property "${first.name}".`,
        );
      }
    }
  }
  const unnamed = rows.find((r) => r.unit.unitNumberKey === "");
  if (unnamed && rows.length > 1) {
    throw new ConvexError(`${unnamed.rowId}: unit "-" is only allowed when it is the only unit of "${first.name}".`);
  }
  const keys = new Map<string, string>();
  for (const r of rows) {
    const other = keys.get(r.unit.unitNumberKey);
    if (other) {
      throw new ConvexError(`${r.rowId}: unit "${r.unit.unitNumber}" has the same unit key as ${other} in "${first.name}".`);
    }
    keys.set(r.unit.unitNumberKey, r.rowId);
  }
  return first;
}

/**
 * Lossless check for one row: the columns that do not read back exactly as the sheet sent them.
 * Returns column keys only, never values (they include tenant names).
 */
export function diffSheetRow(sent: RosterRow, readBack: Record<keyof RosterRow, string | number | null>): string[] {
  const out: string[] = [];
  for (const key of Object.keys(sent) as Array<keyof RosterRow>) {
    const a = ownerCellForCompare(key, sent[key]);
    const b = ownerCellForCompare(key, readBack[key]);
    const same = typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-9 : a === b;
    if (!same) out.push(key);
  }
  return out;
}

// --- Database -> sheet labels (round-trip check) ------------------------------------

const UNIT_TYPE_LABEL = reverse(UNIT_TYPE);
const OCCUPANCY_LABEL = reverse(OCCUPANCY);
const LEASE_TYPE_LABEL = reverse(LEASE_TYPE);
const RENT_PAID_TO_LABEL = reverse(RENT_PAID_TO);
const HEATING_FUEL_LABEL = reverse(HEATING_FUEL);
const PAYER_LABEL = reverse(PAYER);
const LAUNDRY_LABEL = reverse(LAUNDRY);
const CATEGORY_LABEL = reverse(CATEGORY);

const dash = (s: string | undefined) => (s === undefined ? "-" : s);
const label = (table: Record<string, string>, value: string | undefined) =>
  value === undefined ? "-" : (table[value] ?? `?${value}`);

/** Rebuilds the sheet's columns (same keys as RosterRow) from what is stored. */
export function toSheetRow(
  property: Doc<"properties">,
  unit: Doc<"units">,
  residents: Doc<"residents">[],
  source: Doc<"unitSourceRows">,
): Record<keyof RosterRow, string | number | null> {
  return {
    rowId: source.rowId,
    property: property.name,
    unit: unit.unitNumber,
    category: property.category ? CATEGORY_LABEL[property.category] : "?",
    city: dash(property.city),
    unitType: label(UNIT_TYPE_LABEL, unit.unitType),
    floor: unit.floorRaw ?? unit.floor ?? "-",
    bedrooms: unit.bedroomsCount ?? "-",
    bathrooms: unit.bathrooms ?? "-",
    status: label(OCCUPANCY_LABEL, unit.occupancy),
    tenants: residents.length === 0 ? "-" : residents.map((r) => r.fullName).join("; "),
    leaseType: label(LEASE_TYPE_LABEL, unit.leaseType),
    leaseEnd: dash(unit.leaseEnd),
    rent: unit.rent ?? "-",
    rentPaidTo: label(RENT_PAID_TO_LABEL, unit.rentPaidTo),
    heatingFuel: label(HEATING_FUEL_LABEL, unit.heatingFuel),
    gasPaidBy: label(PAYER_LABEL, unit.gasPaidBy),
    electricPaidBy: label(PAYER_LABEL, unit.electricPaidBy),
    laundry: label(LAUNDRY_LABEL, unit.laundry),
    selling: property.selling ? "Yes" : "-",
    assetManager: source.assetManager,
    ownersName: property.ownerName ?? null,
    ownersEmail: property.ownerEmails?.join(OWNER_EMAIL_SEPARATOR) ?? property.ownerEmail ?? null,
    notes: source.notes ?? null,
    sourceUnit: source.sourceUnit ?? null,
    sourceCom: source.sourceCom ?? null,
    sourceFloor: source.sourceFloor ?? null,
    sourceTenants: source.sourceTenants ?? null,
    sourceLeaseEnd: source.sourceLeaseEnd ?? null,
    sourceBedBath: source.sourceBedBath ?? null,
    sourceRent: source.sourceRent ?? null,
    sourceGeTl: source.sourceGeTl ?? null,
    sourceLmat: source.sourceLmat ?? null,
    sourceLaundry: source.sourceLaundry ?? null,
    sourceGasPaid: source.sourceGasPaid ?? null,
    sourceElectricPaid: source.sourceElectricPaid ?? null,
    sourceGasElectric: source.sourceGasElectric ?? null,
    sourceWho: source.sourceWho ?? null,
    sourceWd: source.sourceWd ?? null,
    sourcePropertyHeading: source.sourcePropertyHeading ?? null,
    sourceLayoutNotes: source.sourceLayoutNotes ?? null,
    // Gold and Silver have no section: the sheet shows "-" and the property stores none.
    sourceSection: source.sourceSection ?? null,
    page: source.page,
    managerFeedback: source.managerFeedback ?? null,
  };
}
