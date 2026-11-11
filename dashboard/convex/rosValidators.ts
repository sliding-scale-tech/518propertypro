import { v, type Infer } from "convex/values";
import type { CalcSource } from "./rosCalc";
import type { RowType } from "./rosPolicy";

/**
 * Rental Owner Statement (ROS) validators shared by schema.ts and the finance function files.
 * Dependency-free apart from convex/values (spec 3.1), so schema.ts can import it.
 */

export const rowTypeValidator = v.union(
  v.literal("income"),
  v.literal("owner_contribution"),
  v.literal("other_addition"),
  v.literal("expense"),
  v.literal("owner_draw"),
  v.literal("other_subtraction"),
);

/**
 * `opening_balance` and `stripe` are reserved: v1 never writes them. `roster_rent` = a Rent Income
 * row prefilled from the roster rent and written at finalize (sourceId `<statementId>:<unitId>`).
 */
export const ledgerSourceValidator = v.union(
  v.literal("manual"),
  v.literal("work_order"),
  v.literal("management_fee"),
  v.literal("owner_draw"),
  v.literal("opening_balance"),
  v.literal("stripe"),
  v.literal("roster_rent"),
);

export const accountSystemKeyValidator = v.union(
  v.literal("rent_income"),
  v.literal("management_fees"),
  v.literal("owner_draw"),
  v.literal("owner_contribution"),
  v.literal("repairs"),
);

export const statementStatusValidator = v.union(v.literal("draft"), v.literal("final"), v.literal("discarded"));

export type LedgerSource = Infer<typeof ledgerSourceValidator>;
export type AccountSystemKey = Infer<typeof accountSystemKeyValidator>;
export type StatementStatus = Infer<typeof statementStatusValidator>;

/** Compile-time check: rosPolicy's RowType and rowTypeValidator hold exactly the same literals. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type RowTypeMatchesValidator = Same<Infer<typeof rowTypeValidator>, RowType> extends true ? true : never;
export const ROW_TYPE_MATCHES_VALIDATOR: RowTypeMatchesValidator = true;

/** Compile-time check: rosCalc's CalcSource and ledgerSourceValidator hold exactly the same literals. */
export type CalcSourceMatchesValidator = Same<LedgerSource, CalcSource> extends true ? true : never;
export const CALC_SOURCE_MATCHES_VALIDATOR: CalcSourceMatchesValidator = true;
