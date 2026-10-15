import type { FunctionReturnType } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import type { api } from "@/convex/_generated/api";

export type UnitRow = FunctionReturnType<typeof api.units.list>[number];
export type Manager = { userId: Id<"users">; name: string };

export const UNIT_TYPES = ["studio", "1br", "2br", "3br+"] as const;

/** Server errors arrive as ConvexError data or Error.message; never show a raw object. */
export function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "data" in err && typeof err.data === "string") {
    return err.data;
  }
  if (err instanceof Error && err.message) {
    const m = err.message.match(/Uncaught Error: (.*?)(?:\n|$)/);
    return (m?.[1] ?? err.message).slice(0, 200);
  }
  return "Something went wrong. Try again.";
}

export function formatRent(value: number | undefined) {
  if (value === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
