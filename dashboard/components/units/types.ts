import type { FunctionReturnType } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import type { api } from "@/convex/_generated/api";

export type UnitRow = FunctionReturnType<typeof api.units.list>[number];
export type Manager = { userId: Id<"users">; name: string };

export const UNIT_TYPES = ["studio", "1br", "2br", "3br+"] as const;

export function formatRent(value: number | undefined) {
  if (value === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
