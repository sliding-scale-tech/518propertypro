/**
 * The Add unit / Edit unit form fields as pure rules, shared by the forms (client validation) and
 * convex/units.ts (the server checks again), so the messages match. Numbers are parsed from the
 * typed text with strict patterns: nothing becomes NaN silently, and rent goes through
 * parseDollarsToCents (integer cents, never Number / parseFloat on money).
 *
 * Pure: no Convex imports, erasable TypeScript only (Node's test runner loads it).
 */

import { MAX_AMOUNT_CENTS, parseDollarsToCents } from "./rosFormat";
import { rosterRentToCents } from "./rosPolicy";

export const UNIT_FIELD_MSG = {
  unitNumberMissing: "Enter a unit number.",
  typeMissing: "Select the unit type.",
  floorInvalid: "Enter the floor as a whole number, like 2 (0 for the basement).",
  bathroomsInvalid: "Enter the bathrooms as a number like 1 or 1.5.",
  rentInvalid: "Enter the rent as a dollar amount over $0, like 1250 or 1250.50.",
  managerMissing: "Select the asset manager for this unit.",
} as const;

export const MIN_FLOOR = -5;
export const MAX_FLOOR = 200;
export const MAX_BATHROOMS = 20;

/** null = OK. A floor number (server side): a whole number from -5 to 200. */
export function floorProblem(n: unknown): string | null {
  return typeof n === "number" && Number.isInteger(n) && n >= MIN_FLOOR && n <= MAX_FLOOR ? null : UNIT_FIELD_MSG.floorInvalid;
}

/** null = OK. Bathrooms (server side): 0 to 20 in steps of 0.5. */
export function bathroomsProblem(n: unknown): string | null {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= MAX_BATHROOMS && Number.isInteger(n * 2)
    ? null
    : UNIT_FIELD_MSG.bathroomsInvalid;
}

/** null = OK. A roster rent in DOLLARS (server side, units.create): a clean dollar amount over $0. */
export function rosterRentProblem(n: unknown): string | null {
  return rosterRentToCents(n) === null ? UNIT_FIELD_MSG.rentInvalid : null;
}

type Parsed<T> = { ok: true; value: T | undefined } | { ok: false; message: string };

/** Typed floor -> number; "" -> undefined (not stated). */
export function parseFloorInput(raw: string): Parsed<number> {
  const s = raw.trim();
  if (s === "") return { ok: true, value: undefined };
  if (!/^-?\d{1,3}$/.test(s)) return { ok: false, message: UNIT_FIELD_MSG.floorInvalid };
  const n = Number(s);
  return floorProblem(n) === null ? { ok: true, value: n } : { ok: false, message: UNIT_FIELD_MSG.floorInvalid };
}

/** Typed bathrooms -> number; "" -> undefined (not stated). "1", "1.5", "2.0". */
export function parseBathroomsInput(raw: string): Parsed<number> {
  const s = raw.trim();
  if (s === "") return { ok: true, value: undefined };
  if (!/^\d{1,2}(\.[05]0?)?$/.test(s)) return { ok: false, message: UNIT_FIELD_MSG.bathroomsInvalid };
  const n = Number(s);
  return bathroomsProblem(n) === null ? { ok: true, value: n } : { ok: false, message: UNIT_FIELD_MSG.bathroomsInvalid };
}

/** Typed rent (Add unit) -> DOLLARS for units.rent, via integer cents; "" -> undefined (not stated). */
export function parseRentInput(raw: string): Parsed<number> {
  const s = raw.trim();
  if (s === "") return { ok: true, value: undefined };
  const cents = parseDollarsToCents(s);
  if (cents === null || cents <= 0 || cents > MAX_AMOUNT_CENTS) return { ok: false, message: UNIT_FIELD_MSG.rentInvalid };
  return { ok: true, value: cents / 100 };
}

export type UnitFormInput = {
  unitNumber: string;
  bedrooms: string;
  floor: string;
  bathrooms: string;
  /** Only on Add unit (Edit unit changes rent with Change rent). */
  rent?: string;
  /** Only on Add unit. */
  assetManagerUserId?: string | null;
};

/** Edit unit: a field whose typed text is still the stored value is not re-validated or sent. */
export type UnitFormUnchanged = { floor?: boolean; bathrooms?: boolean };

export type UnitFormValue = {
  unitNumber: string;
  bedrooms: string;
  floor?: number;
  bathrooms?: number;
  rent?: number;
};

/** Every failing field (field -> message) and, when there are none, the parsed values. */
export function validateUnitForm(
  i: UnitFormInput,
  unchanged: UnitFormUnchanged = {},
): { errors: Record<string, string>; value: UnitFormValue | null } {
  const errors: Record<string, string> = {};
  const unitNumber = i.unitNumber.trim();
  if (unitNumber === "") errors.unitNumber = UNIT_FIELD_MSG.unitNumberMissing;
  if (i.bedrooms.trim() === "") errors.bedrooms = UNIT_FIELD_MSG.typeMissing;
  const floor: Parsed<number> = unchanged.floor ? { ok: true, value: undefined } : parseFloorInput(i.floor);
  if (!floor.ok) errors.floor = floor.message;
  const bathrooms: Parsed<number> = unchanged.bathrooms ? { ok: true, value: undefined } : parseBathroomsInput(i.bathrooms);
  if (!bathrooms.ok) errors.bathrooms = bathrooms.message;
  const rent = i.rent === undefined ? null : parseRentInput(i.rent);
  if (rent && !rent.ok) errors.rent = rent.message;
  if (i.assetManagerUserId !== undefined && (i.assetManagerUserId ?? "").trim() === "") errors.assetManagerUserId = UNIT_FIELD_MSG.managerMissing;
  if (Object.keys(errors).length > 0) return { errors, value: null };
  return {
    errors,
    value: {
      unitNumber,
      bedrooms: i.bedrooms,
      ...(floor.ok && floor.value !== undefined ? { floor: floor.value } : {}),
      ...(bathrooms.ok && bathrooms.value !== undefined ? { bathrooms: bathrooms.value } : {}),
      ...(rent && rent.ok && rent.value !== undefined ? { rent: rent.value } : {}),
    },
  };
}
