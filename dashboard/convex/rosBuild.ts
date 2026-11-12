/**
 * Rental Owner Statement (ROS): builds a statement from the database (spec 5.4 "Building a draft").
 * A server helper, NOT a registered Convex function.
 *
 * Split in two so the mapping can be tested without Convex:
 * - `assembleStatement(data)` is PURE: DB-shaped rows in, CalcInput + engine result + LineViews +
 *   merged warnings out. scripts/probes/ros_build.test.mjs feeds it the golden sample.
 * - `loadBuildData(ctx, statement, ...)` only reads the database and hands the rows to it.
 *   `buildStatement` = load + assemble.
 *
 * Runtime imports are the pure ROS modules only (plus convex/values), so Node's test runner can load
 * this file; the Convex types are `import type` and are erased.
 */

import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  type CalcAccount,
  type CalcInput,
  type CalcProperty,
  type CalcRow,
  type CalcSource,
  type DetailLine,
  type GeneratedDraw,
  type GeneratedFee,
  type StatementResult,
  type StatementSnapshot,
  type StatementWarning,
  computeStatement,
  displayName,
  effectivePayee,
  footerName,
} from "./rosCalc";
import { COMPANY_NAME, PROPERTY_LEVEL, businessDate, formatMonth, monthEnd, monthStart, prevMonth } from "./rosFormat";
import {
  ADDITION_TYPES,
  MAX_STATEMENT_LINES,
  MSG,
  ROSTER_RENT_LABEL,
  cmpStr,
  effectiveFee,
  finalizeProblem,
  selectWorkOrders,
  type RentSkipCode,
  type RowType,
  type WoForBilling,
} from "./rosPolicy";
import {
  RECEIVED_WINDOW_MONTHS,
  RENT_PAY_MSG,
  rentMarkability,
  rentRecordsFor,
  unpaidCheckMonths,
  type RentRecord,
} from "./rentPaymentsPolicy";

// --- DB-shaped inputs (Convex Docs are assignable to these) -------------------------------------

export type BuildOwner = {
  _id: string;
  legalName: string;
  contactFirstName?: string;
  contactLastName?: string;
  payeeName?: string;
  /** DEPRECATED, never read: the fee is per property (BuildLink.managementFeeBps ?? defaultFeeBps). */
  managementFeeBps?: number;
};

export type BuildAccount = {
  _id: string;
  name: string;
  kind: RowType;
  feeBase: boolean;
  systemKey?: string;
  active: boolean;
};

export type BuildUnit = {
  _id: string;
  unitNumber: string;
  securityDepositHeldCents?: number;
  /** Roster rent in DOLLARS (units.rent); absent = not stated. */
  rent?: number;
  rentPaidTo?: "company" | "owner_direct" | "included_in_other_unit";
  /** Roster occupancy / lease type: "vacant" ones can't have rent marked (rosPolicy.rosterSaysVacant). */
  occupancy?: string;
  leaseType?: string;
};

/** A resident row (residents table): only active ones count as the unit's tenants. */
export type BuildResident = { unitId: string; fullName: string; active: boolean };

export type BuildLink = {
  _id: string;
  ownerId: string;
  openingBalanceCents?: number;
  startMonth?: string;
  propertyReserveCents?: number;
  /** This property's own management fee (bps); absent = the org default. */
  managementFeeBps?: number;
};

export type BuildEntry = {
  _id: string;
  ownerId: string;
  propertyId: string;
  unitId?: string;
  date: string;
  accountId: string;
  counterparty: string;
  memo: string;
  amountCents: number;
  source: CalcSource;
  statementId?: string;
  voided?: boolean;
  /** rent_payment rows: the month the rent is for ("YYYY-MM"). */
  rentForMonth?: string;
  createdAt: number;
};

export type BuildWorkOrder = {
  _id: string;
  number: number;
  propertyId: string;
  unitId: string;
  status: string;
  completedAt?: number;
  closedAt?: number;
  createdAt: number;
  billAmountCents?: number;
  noOwnerCharge?: boolean;
  billedStatementId?: string;
  workCompletedDescription?: string;
  rosAccountId?: string;
  billPropertyLevel?: boolean;
};

export type BuildAdjustment = {
  propertyId: string;
  earlyPaymentsCents: number;
  unpaidBillsCents: number;
  propertyReserveCents?: number;
};

export type BuildOverride = {
  propertyId: string;
  feeAmountCents?: number;
  feeMemo?: string;
  feeExcluded?: boolean;
  drawAmountCents?: number;
  drawExcluded?: boolean;
};

export type BuildStatementDoc = {
  _id: string;
  ownerId: string;
  month: string;
  periodStart: string;
  periodEnd: string;
  propertyIds: string[];
  excludedKeys: string[];
  /** Default-excluded lines (dated before the owner's first statement month) put back on. */
  includedKeys?: string[];
  adjustments: BuildAdjustment[];
  overrides: BuildOverride[];
  // rentOverrides / rentChecked* (the old roster-rent prefill) are no longer read (2026-11-12).
};

export type BuildPropertyData = {
  propertyId: string;
  /** null = the property row is gone or is in another org. */
  property: { name: string } | null;
  /** Every ownerProperties row for the property (any owner). */
  links: BuildLink[];
  /** Legal names of the owners of `links`, same order. */
  linkOwnerNames: string[];
  /** endingCashCents of the FINAL ownerStatementProperties row for (property, prevMonth(month)), else null. */
  prevFinalEndingCents: number | null;
  /**
   * The owner of that previous final. When it is another owner (the property changed hands), its
   * ending is NOT carried: this owner starts from its own opening balance. Absent = this owner.
   */
  prevFinalOwnerId?: string | null;
  /** Legal name of that owner, for the PREV_OWNER_BALANCE message. */
  prevFinalOwnerName?: string;
  /** True when the property has any final statement (any owner, any month). */
  hasAnyFinal: boolean;
  units: BuildUnit[];
  /** Candidate ledger rows; filtered again here (unbilled, not voided, this owner, date <= periodEnd). */
  entries: BuildEntry[];
  /** Residents of the property's units (who counts as a tenant, for the unpaid-rent check). Absent = none loaded. */
  residents?: BuildResident[];
  /**
   * Ledger rows of the property's units (any owner, billed or not) used ONLY for the "no rent marked
   * received" info warning: rent_payment rows by rentForMonth and rows dated in the checked months.
   * They never go on the statement from here (that is `entries`).
   */
  rentRecords?: RentRecord[];
  /**
   * Work orders of the property: closed ones that are still pending for the ROS (rosPending, or
   * not backfilled yet) and status completed. Filtered again here (selectWorkOrders).
   */
  workOrders: BuildWorkOrder[];
};

export type BuildData = {
  statement: BuildStatementDoc;
  owner: BuildOwner;
  /** Every account of the org, active or not (rows can point at a turned-off account). */
  accounts: BuildAccount[];
  /** In statement.propertyIds order. */
  properties: BuildPropertyData[];
  /** Business date the statement is dated (finalize: today; draft view: today). */
  statementDate: string;
  /** The org default management fee (financeSettings.rosDefaultFeeBps); absent = 500 (5.00%). */
  defaultFeeBps?: number;
};

// --- outputs -------------------------------------------------------------------------------------

/** "rent" = a historical roster-rent line (key "rent:<unitId>"), only on statements finalized before 2026-11-12. */
export type LineKind = "entry" | "wo" | "fee" | "draw" | "rent";

/**
 * DEPRECATED (roster-rent prefill, removed 2026-11-12). `ownerStatements.get().rent.skipped` keeps
 * this shape (always empty) so an older client still renders.
 */
export type RentSkip = {
  propertyId: string;
  propertyName: string;
  unitId: string;
  unit: string;
  code: RentSkipCode;
  reason: string;
};

export type LineView = {
  key: string;
  kind: LineKind;
  side: "addition" | "subtraction";
  date: string; // effective date
  storedDate: string;
  carriedForward: boolean;
  propertyId: string;
  propertyName: string;
  unit: string;
  accountId: string;
  accountName: string;
  name: string;
  counterparty: string;
  memo: string;
  amountCents: number;
  sourceLabel: string;
  entryId?: string;
  workOrderId?: string;
  unitId?: string | null;
  billPropertyLevel?: boolean;
  editable: boolean;
  /** A rent payment from the Payments page (source rent_payment): the month the rent is for. */
  rentForMonth?: string;
  /** A ledger row on the Rent Income account: rent is changed on the Payments page, not here. */
  onRentAccount?: boolean;
  /**
   * True for a line dated before the owner's first statement month: it is left off unless the
   * accountant includes it (ownerStatements.includedKeys). `note` says why.
   */
  defaultExcluded?: boolean;
  note?: string;
};

export type PropertyAdjustmentView = {
  propertyId: string;
  name: string;
  securityDepositsCents: number;
  earlyPaymentsCents: number;
  unpaidBillsCents: number;
  propertyReserveCents: number;
  /** The owner-link default (ownerProperties.propertyReserveCents ?? 0). */
  propertyReserveDefaultCents: number;
  /**
   * Where `fee.bps` comes from: "own" = the property's own fee, "default" = the org default, null =
   * a final statement (the % is the one frozen in its snapshot).
   */
  feeSource: "own" | "default" | null;
  fee: GeneratedFee;
  draw: GeneratedDraw;
};

/** What a candidate row came from, for LineViews and the finalize writes. */
export type RowOrigin =
  | {
      kind: "entry";
      entryId: string;
      source: CalcSource;
      unitId: string | null;
      onRentAccount: boolean;
      rentForMonth?: string;
    }
  | { kind: "wo"; workOrderId: string; number: number; unitId: string; billPropertyLevel: boolean };

export type BuiltStatement = {
  input: CalcInput;
  /** Engine result; `result.warnings` is replaced by the merged list (DB + engine), so a snapshot is self-contained. */
  result: StatementResult;
  lines: LineView[];
  excludedLines: LineView[];
  warnings: StatementWarning[];
  properties: PropertyAdjustmentView[];
  origins: Record<string, RowOrigin>;
  feeAccountId: string | null;
  drawAccountId: string | null;
  payeeName: string | null;
  /** This owner's link per property (null when not linked), in column order. */
  ownerLinks: (BuildLink | null)[];
};

// --- small pure helpers --------------------------------------------------------------------------

/** Business date of a work order for the ROS: completion (tech submit), else close, else creation (spec 5.6). */
export function woCompletedDate(wo: { completedAt?: number; closedAt?: number; createdAt: number }): string {
  return businessDate(wo.completedAt ?? wo.closedAt ?? wo.createdAt);
}

export function woSeq(wo: { completedAt?: number; closedAt?: number; createdAt: number }): number {
  return wo.completedAt ?? wo.closedAt ?? wo.createdAt;
}

export function accountToCalc(a: BuildAccount): CalcAccount {
  return { id: a._id, name: a.name, kind: a.kind, feeBase: a.feeBase, ...(a.systemKey ? { systemKey: a.systemKey } : {}) };
}

/** A ledger row onto a statement: key entry:<id>, unit label or null (Property level), seq = createdAt. */
export function entryToCalcRow(e: BuildEntry, unitLabel: string | null): CalcRow {
  return {
    key: `entry:${e._id}`,
    propertyId: e.propertyId,
    unitLabel,
    date: e.date,
    accountId: e.accountId,
    counterparty: e.counterparty,
    memo: e.memo,
    amountCents: e.amountCents,
    source: e.source,
    seq: e.createdAt,
  };
}

/** The WO shape rosPolicy.selectWorkOrders needs. `accountUsable` = rosAccountId is an expense account of this org. */
export function woToBilling(wo: BuildWorkOrder, unitLabel: string, accountUsable: boolean): WoForBilling {
  return {
    id: wo._id,
    number: wo.number,
    propertyId: wo.propertyId,
    unitLabel,
    status: wo.status,
    completedDate: woCompletedDate(wo),
    ...(wo.billAmountCents !== undefined ? { billAmountCents: wo.billAmountCents } : {}),
    ...(wo.noOwnerCharge !== undefined ? { noOwnerCharge: wo.noOwnerCharge } : {}),
    ...(wo.billedStatementId !== undefined ? { billedStatementId: wo.billedStatementId } : {}),
    ...(wo.workCompletedDescription !== undefined ? { workCompletedDescription: wo.workCompletedDescription } : {}),
    // An account that is missing or not an expense account counts as "no account" -> WO_MISSING_BILL.
    ...(wo.rosAccountId !== undefined && accountUsable ? { rosAccountId: wo.rosAccountId } : {}),
  };
}

/** A billable WO onto a statement (spec 5.4 step 2): company name, verbatim trimmed description (A38). */
export function woToCalcRow(wo: BuildWorkOrder, unitLabel: string | null): CalcRow {
  return {
    key: `wo:${wo._id}`,
    propertyId: wo.propertyId,
    unitLabel: wo.billPropertyLevel === true ? null : unitLabel,
    date: woCompletedDate(wo),
    accountId: wo.rosAccountId as string,
    counterparty: COMPANY_NAME,
    memo: (wo.workCompletedDescription ?? "").trim(),
    amountCents: wo.billAmountCents as number,
    source: "work_order",
    seq: woSeq(wo),
  };
}

/** Key of a unit's (historical) roster-rent line: a billed roster_rent row maps back to it. */
export function rentKey(unitId: string): string {
  return `rent:${unitId}`;
}

/** "Manual" for hand-entered rows; the other sources (only seen in the ledger list) get a plain label. */
export function entrySourceLabel(source: CalcSource): string {
  switch (source) {
    case "manual":
      return "Manual";
    case "work_order":
      return "Work order";
    case "management_fee":
      return "Management fee";
    case "owner_draw":
      return "Owner draw";
    case "opening_balance":
      return "Opening balance";
    case "stripe":
      return "Card payment";
    case "roster_rent":
      return ROSTER_RENT_LABEL;
    case "rent_payment":
      return RENT_PAYMENT_LABEL;
  }
}

/** Source label of a rent payment marked on the Payments page. */
export const RENT_PAYMENT_LABEL = "Payments page";

export function feeSourceLabel(overridden: boolean): string {
  return overridden ? "Management fee (edited)" : "Management fee (auto)";
}

export function drawSourceLabel(overridden: boolean): string {
  return overridden ? "Owner draw (edited)" : "Owner draw (suggested)";
}

export function lineKindOf(key: string): LineKind {
  if (key.startsWith("entry:")) return "entry";
  if (key.startsWith("wo:")) return "wo";
  if (key.startsWith("fee:")) return "fee";
  if (key.startsWith("draw:")) return "draw";
  if (key.startsWith("rent:")) return "rent";
  throw new Error(`rosBuild: unknown line key ${key}`);
}

/** Deterministic deep-sort-free hash (two 32-bit FNV-1a variants) of a string. */
function hashString(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) ^ (h2 >>> 13);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/**
 * Fingerprint of everything a statement shows (columns, summary, income statement, every detail
 * line, the generated fee/draw), but not the warnings. `get` returns it as `previewHash`; finalize
 * refuses when an `expectedHash` is given and the freshly built statement differs. The engine is
 * deterministic, so the same data gives the same hash.
 */
export function resultHash(result: StatementResult): string {
  return hashString(
    JSON.stringify({
      p: [result.periodStart, result.periodEnd],
      c: result.columns,
      s: result.summary,
      i: result.incomeStatement,
      d: result.detail,
      g: result.generated,
    }),
  );
}

function warningOrder(warnings: StatementWarning[], colOf: Map<string, number>): StatementWarning[] {
  const idx = (w: StatementWarning): number => (w.propertyId === undefined ? -1 : (colOf.get(w.propertyId) ?? 9999));
  return warnings
    .map((w, i) => ({ w, i }))
    .sort((a, b) => (a.w.blocking === b.w.blocking ? 0 : a.w.blocking ? -1 : 1) || idx(a.w) - idx(b.w) || a.i - b.i)
    .map((x) => x.w);
}

/** `propertyId` / `workOrderId` / `rentMonth` (when the warning is about one) let the UI link to where it's fixed. */
export type WarningView = { code: string; message: string; propertyId?: string; workOrderId?: string; rentMonth?: string };

export function splitWarnings(warnings: StatementWarning[]): { blocking: WarningView[]; info: WarningView[] } {
  const view = (w: StatementWarning): WarningView => ({
    code: w.code,
    message: w.message,
    ...(w.propertyId !== undefined ? { propertyId: w.propertyId } : {}),
    ...(w.workOrderId !== undefined ? { workOrderId: w.workOrderId } : {}),
    ...(w.rentMonth !== undefined ? { rentMonth: w.rentMonth } : {}),
  });
  return {
    blocking: warnings.filter((w) => w.blocking).map(view),
    info: warnings.filter((w) => !w.blocking).map(view),
  };
}

// --- the pure assembly ---------------------------------------------------------------------------

/**
 * Spec 5.4 "Building a draft", steps 2-6, on rows already loaded. `isDraft` controls `editable`
 * and the PERIOD_OPEN info warning.
 */
export function assembleStatement(data: BuildData, isDraft = true): BuiltStatement {
  const { statement: st, owner, accounts } = data;
  const accountById = new Map(accounts.map((a) => [a._id, a]));
  const feeAccount = accounts.find((a) => a.systemKey === "management_fees") ?? null;
  const drawAccount = accounts.find((a) => a.systemKey === "owner_draw") ?? null;
  const rentAccountIds = new Set(accounts.filter((a) => a.systemKey === "rent_income").map((a) => a._id));
  /** Rent month -> units (all properties) with markable rent and nothing recorded (RENT_UNPAID). */
  const unpaidByMonth = new Map<string, number>();
  const accountsMissing = !feeAccount || !drawAccount;
  const excluded = new Set(st.excludedKeys);
  const putBack = new Set(st.includedKeys ?? []);
  /** key -> note, for lines that are excluded by default. */
  const defaultOff = new Map<string, string>();
  const payeeName = effectivePayee(owner);

  const dbWarnings: StatementWarning[] = [];
  if (accountsMissing) dbWarnings.push({ code: "ACCOUNTS_MISSING", message: MSG.ACCOUNTS_MISSING, blocking: true });

  const calcProps: CalcProperty[] = [];
  const included: CalcRow[] = [];
  const excludedRows: CalcRow[] = [];
  const origins: Record<string, RowOrigin> = {};
  const ownerLinks: (BuildLink | null)[] = [];
  const reserveDefaults: number[] = [];
  const depositsOnly: number[] = [];
  const feeSources: ("own" | "default")[] = [];

  data.properties.forEach((pd) => {
    const pid = pd.propertyId;
    const name = pd.property?.name ?? "Deleted property";
    const link = pd.links.find((l) => l.ownerId === st.ownerId) ?? null;
    ownerLinks.push(link);

    // ownership: still this owner's, and only this owner's
    if (!pd.property || !link) {
      dbWarnings.push({ code: "OWNER_CHANGED", propertyId: pid, message: MSG.OWNER_CHANGED(name, owner.legalName), blocking: true });
    } else if (pd.links.length >= 2) {
      dbWarnings.push({ code: "CO_OWNED", propertyId: pid, message: MSG.CO_OWNED(name, pd.linkOwnerNames), blocking: true });
    }

    // beginning cash
    let beginning = 0;
    const prevOtherOwner =
      pd.prevFinalEndingCents !== null &&
      pd.prevFinalOwnerId !== undefined &&
      pd.prevFinalOwnerId !== null &&
      pd.prevFinalOwnerId !== st.ownerId;
    if (prevOtherOwner) {
      // The property changed hands: the previous owner's ending cash is theirs, not this owner's.
      if (link !== null && link.openingBalanceCents !== undefined) {
        beginning = link.openingBalanceCents;
      } else if (pd.prevFinalEndingCents !== 0) {
        dbWarnings.push({
          code: "PREV_OWNER_BALANCE",
          propertyId: pid,
          message: MSG.PREV_OWNER_BALANCE(pd.prevFinalOwnerName ?? "Unknown owner", pd.prevFinalEndingCents as number, name),
          blocking: true,
        });
      } else {
        dbWarnings.push({ code: "OPENING_BALANCE_NOT_SET", propertyId: pid, message: MSG.OPENING_BALANCE_NOT_SET(name), blocking: false });
      }
    } else if (pd.prevFinalEndingCents !== null) {
      beginning = pd.prevFinalEndingCents;
    } else if (!pd.hasAnyFinal) {
      if (link?.openingBalanceCents === undefined || link === null) {
        dbWarnings.push({ code: "OPENING_BALANCE_NOT_SET", propertyId: pid, message: MSG.OPENING_BALANCE_NOT_SET(name), blocking: false });
      } else {
        beginning = link.openingBalanceCents;
      }
    } else {
      dbWarnings.push({ code: "PRIOR_NOT_FINAL", propertyId: pid, message: MSG.PRIOR_NOT_FINAL(name, prevMonth(st.month)), blocking: true });
    }

    // deposits
    let deposits = 0;
    for (const u of pd.units) deposits += u.securityDepositHeldCents ?? 0;
    if (pd.units.length > 0 && pd.units.every((u) => u.securityDepositHeldCents === undefined)) {
      dbWarnings.push({ code: "DEPOSITS_NOT_SET", propertyId: pid, message: MSG.DEPOSITS_NOT_SET(name), blocking: false });
    }
    depositsOnly.push(deposits);

    // adjustments and overrides
    const adj = st.adjustments.find((a) => a.propertyId === pid);
    const ov = st.overrides.find((o) => o.propertyId === pid);
    const reserveDefault = link?.propertyReserveCents ?? 0;
    reserveDefaults.push(reserveDefault);
    // The fee: this property's own fee on the owner link, else the org default (5.00% unless changed).
    const fee = effectiveFee(link?.managementFeeBps, data.defaultFeeBps);
    feeSources.push(fee.own ? "own" : "default");
    calcProps.push({
      id: pid,
      name,
      feeBps: fee.bps,
      beginningCashCents: beginning,
      securityDepositsCents: deposits,
      earlyPaymentsCents: adj?.earlyPaymentsCents ?? 0,
      propertyReserveCents: adj?.propertyReserveCents ?? reserveDefault,
      unpaidBillsCents: adj?.unpaidBillsCents ?? 0,
      pendingEpayCents: 0,
      fee: {
        amountOverrideCents: ov?.feeAmountCents ?? null,
        memoOverride: ov?.feeMemo ?? null,
        // Without the system accounts the engine can't place a fee row; finalize is blocked anyway.
        excluded: ov?.feeExcluded === true || accountsMissing,
      },
      draw: { amountOverrideCents: ov?.drawAmountCents ?? null, excluded: ov?.drawExcluded === true || accountsMissing },
    });

    // The owner's first statement month: rows dated before it are left off by default.
    const firstMonth = link?.startMonth ?? st.month;
    const floorDate = monthStart(firstMonth);
    if (link?.startMonth !== undefined && st.month < link.startMonth) {
      dbWarnings.push({
        code: "START_MONTH_AFTER",
        propertyId: pid,
        message: MSG.START_MONTH_AFTER(name, link.startMonth, st.month),
        blocking: true,
      });
    }

    const unitLabelOf = new Map(pd.units.map((u) => [u._id, u.unitNumber]));
    /** `offNote` set = excluded by default (before the first statement month) unless put back. */
    const take = (row: CalcRow, origin: RowOrigin, offNote?: string): void => {
      origins[row.key] = origin;
      if (offNote !== undefined) defaultOff.set(row.key, offNote);
      const off = offNote !== undefined ? !putBack.has(row.key) : excluded.has(row.key);
      (off ? excludedRows : included).push(row);
    };

    // ledger rows: entered by hand, and rent payments from the Payments page (source rent_payment,
    // dated the day received: cash basis). Rent is no longer prefilled from the roster (2026-11-12).
    /** Rent payments received before the first statement month and still left off (RENT_PAYMENT_BEFORE_START). */
    const rentOff: { unit: string | null; date: string; id: string }[] = [];
    for (const e of pd.entries) {
      if (e.propertyId !== pid || e.statementId !== undefined || e.voided === true) continue;
      if (e.ownerId !== st.ownerId || e.date > st.periodEnd) continue;
      const unitLabel = e.unitId !== undefined ? (unitLabelOf.get(e.unitId) ?? null) : null;
      if (e.source === "rent_payment" && e.date < floorDate && !putBack.has(`entry:${e._id}`)) {
        rentOff.push({ unit: unitLabel, date: e.date, id: e._id });
      }
      take(
        entryToCalcRow(e, unitLabel),
        {
          kind: "entry",
          entryId: e._id,
          source: e.source,
          unitId: e.unitId ?? null,
          onRentAccount: rentAccountIds.has(e.accountId),
          ...(e.source === "rent_payment" && e.rentForMonth !== undefined ? { rentForMonth: e.rentForMonth } : {}),
        },
        e.date < floorDate ? MSG.ENTRY_BEFORE_START_NOTE : undefined,
      );
    }

    if (rentOff.length > 0) {
      rentOff.sort((a, b) => cmpStr(a.date, b.date) || cmpStr(a.unit ?? "", b.unit ?? "") || cmpStr(a.id, b.id));
      dbWarnings.push({
        code: "RENT_PAYMENT_BEFORE_START",
        propertyId: pid,
        message: MSG.RENT_PAYMENT_BEFORE_START(rentOff, name, firstMonth),
        blocking: false,
      });
    }

    // "No rent marked received" (info only): units whose rent can be marked (rentPaymentsPolicy
    // .rentMarkability) with neither a rent payment for the month nor a Rent Income row dated in it.
    if (pd.property && link) {
      const tenantsOf = new Map<string, string[]>();
      for (const r of pd.residents ?? []) {
        if (!r.active) continue;
        const list = tenantsOf.get(r.unitId) ?? [];
        list.push(r.fullName);
        tenantsOf.set(r.unitId, list);
      }
      const seen = new Set<string>();
      const records: RentRecord[] = [];
      for (const r of [...pd.entries, ...(pd.rentRecords ?? [])]) {
        if (seen.has(r._id)) continue;
        seen.add(r._id);
        records.push(r);
      }
      const months = unpaidCheckMonths(st.month, link.startMonth);
      for (const u of pd.units) {
        if (!rentMarkability(u, tenantsOf.get(u._id) ?? []).markable) continue;
        for (const m of months) {
          const rec = rentRecordsFor(u._id, m, records, rentAccountIds);
          if (rec.payment === null && rec.ledger.length === 0) unpaidByMonth.set(m, (unpaidByMonth.get(m) ?? 0) + 1);
        }
      }
    }

    // work orders
    const woById = new Map(pd.workOrders.map((w) => [w._id, w]));
    const forBilling = pd.workOrders
      .filter((w) => w.propertyId === pid)
      .map((w) => {
        const acc = w.rosAccountId !== undefined ? accountById.get(w.rosAccountId) : undefined;
        return woToBilling(w, unitLabelOf.get(w.unitId) ?? "", acc !== undefined && acc.kind === "expense");
      });
    const sel = selectWorkOrders(forBilling, st.periodEnd, floorDate);
    for (const b of sel.missingBill) {
      dbWarnings.push({
        code: "WO_MISSING_BILL",
        propertyId: pid,
        workOrderId: b.id,
        message: MSG.WO_MISSING_BILL(b.number, name, b.unitLabel || null),
        blocking: true,
      });
    }
    for (const b of sel.awaitingReview) {
      dbWarnings.push({
        code: "WO_AWAITING_REVIEW",
        propertyId: pid,
        workOrderId: b.id,
        message: MSG.WO_AWAITING_REVIEW(b.number, name, b.completedDate as string),
        blocking: false,
      });
    }
    const takeWo = (b: WoForBilling, offNote?: string): void => {
      const wo = woById.get(b.id)!;
      take(
        woToCalcRow(wo, unitLabelOf.get(wo.unitId) ?? null),
        { kind: "wo", workOrderId: wo._id, number: wo.number, unitId: wo.unitId, billPropertyLevel: wo.billPropertyLevel === true },
        offNote,
      );
    };
    for (const b of sel.billable) takeWo(b);
    for (const b of sel.beforeFloor) takeWo(b, MSG.BEFORE_START_NOTE);
    const stillOff = sel.beforeFloor.filter((b) => !putBack.has(`wo:${b.id}`));
    if (stillOff.length > 0) {
      dbWarnings.push({
        code: "WO_BEFORE_START",
        propertyId: pid,
        ...(stillOff.length === 1 ? { workOrderId: stillOff[0].id } : {}),
        message: MSG.WO_BEFORE_START(stillOff.map((b) => b.number), name, firstMonth),
        blocking: false,
      });
    }
    if (sel.beforeFloorMissingBill.length > 0) {
      const list = sel.beforeFloorMissingBill;
      dbWarnings.push({
        code: "WO_BEFORE_START_MISSING_BILL",
        propertyId: pid,
        ...(list.length === 1 ? { workOrderId: list[0].id } : {}),
        message: MSG.WO_BEFORE_START_MISSING_BILL(list.map((b) => b.number), name, firstMonth),
        blocking: false,
      });
    }
  });

  if (isDraft) {
    const open = finalizeProblem(st.month, data.statementDate);
    if (open !== null) dbWarnings.push({ code: "PERIOD_OPEN", message: open, blocking: false });
  }

  // Info only (never blocks): rent not marked received yet, per rent month, oldest first.
  if (isDraft) {
    for (const m of [...unpaidByMonth.keys()].sort(cmpStr)) {
      const n = unpaidByMonth.get(m) ?? 0;
      if (n > 0) dbWarnings.push({ code: "RENT_UNPAID", rentMonth: m, message: RENT_PAY_MSG.UNPAID(n, m), blocking: false });
    }
  }

  const input: CalcInput = {
    periodStart: st.periodStart,
    periodEnd: st.periodEnd,
    // No owner-level fee any more: every property carries its own feeBps (above).
    owner: { legalName: owner.legalName, payeeName, managementFeeBps: null },
    companyName: COMPANY_NAME,
    properties: calcProps,
    accounts: accounts.map(accountToCalc),
    rows: included,
  };
  const result = computeStatement(input);
  const lineCount = result.detail.additions.length + result.detail.subtractions.length;
  if (lineCount > MAX_STATEMENT_LINES) {
    dbWarnings.unshift({ code: "TOO_MANY_LINES", message: MSG.TOO_MANY_LINES, blocking: true });
  }

  const colOf = new Map(calcProps.map((p, i) => [p.id, i]));
  const warnings = warningOrder([...dbWarnings, ...result.warnings], colOf);
  result.warnings = warnings;

  const generatedByProp = new Map(result.generated.map((g) => [g.propertyId, g]));
  const rowByKey = new Map([...included, ...excludedRows].map((r) => [r.key, r]));

  const lineFromDetail = (l: DetailLine): LineView => {
    const kind = lineKindOf(l.key);
    const side = ADDITION_TYPES.has(l.type) ? "addition" : "subtraction";
    const base = {
      key: l.key,
      kind,
      side,
      date: l.date,
      storedDate: l.storedDate,
      carriedForward: l.carriedForward,
      propertyId: l.propertyId,
      propertyName: l.propertyName,
      unit: l.unit,
      accountName: l.accountName,
      name: l.name,
      memo: l.memo,
      amountCents: l.amountCents,
    } as const;
    if (kind === "fee") {
      const g = generatedByProp.get(l.propertyId)!;
      return { ...base, accountId: feeAccount?._id ?? "", counterparty: COMPANY_NAME, sourceLabel: feeSourceLabel(g.fee.overridden), unitId: null, editable: isDraft };
    }
    if (kind === "draw") {
      const g = generatedByProp.get(l.propertyId)!;
      return { ...base, accountId: drawAccount?._id ?? "", counterparty: payeeName ?? "", sourceLabel: drawSourceLabel(g.draw.overridden), unitId: null, editable: isDraft };
    }
    const row = rowByKey.get(l.key)!;
    return withDefaultOff(withOrigin({ ...base, accountId: row.accountId, counterparty: row.counterparty }, origins[l.key], isDraft), defaultOff);
  };

  const lines = [...result.detail.additions, ...result.detail.subtractions].map(lineFromDetail);

  const nameOf = new Map(calcProps.map((p) => [p.id, p.name]));
  const excludedLines = excludedRows
    .map((r): LineView => {
      const acc = accountById.get(r.accountId);
      const type: RowType = acc?.kind ?? "expense";
      const carried = r.date < st.periodStart;
      const view = withOrigin(
        {
          key: r.key,
          kind: lineKindOf(r.key),
          side: ADDITION_TYPES.has(type) ? "addition" : "subtraction",
          date: carried ? st.periodStart : r.date,
          storedDate: r.date,
          carriedForward: carried,
          propertyId: r.propertyId,
          propertyName: nameOf.get(r.propertyId) ?? "",
          unit: r.unitLabel ?? PROPERTY_LEVEL,
          accountId: r.accountId,
          accountName: acc?.name ?? "",
          name: displayName(r.unitLabel, r.counterparty),
          counterparty: r.counterparty,
          memo: r.memo,
          amountCents: r.amountCents,
        },
        origins[r.key],
        isDraft,
      );
      return withDefaultOff(view, defaultOff);
    })
    .sort((a, b) => cmpStr(a.date, b.date) || cmpStr(a.key, b.key));

  const properties: PropertyAdjustmentView[] = calcProps.map((p, i) => ({
    propertyId: p.id,
    name: p.name,
    securityDepositsCents: depositsOnly[i],
    earlyPaymentsCents: p.earlyPaymentsCents,
    unpaidBillsCents: p.unpaidBillsCents,
    propertyReserveCents: p.propertyReserveCents,
    propertyReserveDefaultCents: reserveDefaults[i],
    feeSource: feeSources[i],
    fee: result.generated[i].fee,
    draw: result.generated[i].draw,
  }));

  return {
    input,
    result,
    lines,
    excludedLines,
    warnings,
    properties,
    origins,
    feeAccountId: feeAccount?._id ?? null,
    drawAccountId: drawAccount?._id ?? null,
    payeeName,
    ownerLinks,
  };
}

function withDefaultOff(l: LineView, defaultOff: Map<string, string>): LineView {
  const note = defaultOff.get(l.key);
  return note === undefined ? l : { ...l, defaultExcluded: true, note };
}

function withOrigin(
  base: Omit<LineView, "sourceLabel" | "editable" | "entryId" | "workOrderId" | "unitId" | "billPropertyLevel" | "defaultExcluded" | "note">,
  origin: RowOrigin,
  isDraft: boolean,
): LineView {
  if (origin.kind === "entry") {
    return {
      ...base,
      sourceLabel: entrySourceLabel(origin.source),
      entryId: origin.entryId,
      unitId: origin.unitId,
      // Only rows entered by hand are edited here; a rent payment is changed on the Payments page.
      editable: isDraft && origin.source === "manual",
      ...(origin.onRentAccount ? { onRentAccount: true } : {}),
      ...(origin.rentForMonth !== undefined ? { rentForMonth: origin.rentForMonth } : {}),
    };
  }
  return {
    ...base,
    sourceLabel: `WO-${origin.number}`,
    workOrderId: origin.workOrderId,
    unitId: origin.unitId,
    billPropertyLevel: origin.billPropertyLevel,
    editable: isDraft,
  };
}

// --- finalize plan (pure) ------------------------------------------------------------------------

export type PlannedLedgerRow = {
  key: string;
  propertyId: string;
  unitId: string | undefined;
  /** The original date: a WO's completion date, periodEnd for fee / draw. */
  date: string;
  /** The date the row shows on the statement (ledgerEntries.postedDate). */
  postedDate: string;
  type: RowType;
  accountId: string;
  counterparty: string;
  memo: string;
  amountCents: number;
  source: "work_order" | "management_fee" | "owner_draw";
  sourceId: string;
  workOrderId?: string;
  woNumber?: number;
};

/** Deterministic sourceId of a statement's fee / draw ledger row (spec 3.5). */
export function generatedSourceId(statementId: string, propertyId: string): string {
  return `${statementId}:${propertyId}`;
}

/**
 * The ledger writes finalize makes from a built statement (spec 5.4 finalize steps 5-7):
 * - one row per included WO line, dated the WO's completion date (`date`) and posted on the line's
 *   EFFECTIVE date (`postedDate`), at property level when billPropertyLevel;
 * - one row per fee / draw line, dated and posted periodEnd, sourceId = `${statementId}:${propertyId}`;
 * - the included ledger entries (manual rows AND rent payments from the Payments page) to stamp
 *   with statementId and their posted (effective) date.
 * Roster rent is no longer prefilled (2026-11-12), so no roster_rent row is ever written.
 */
export function finalizePlan(
  built: BuiltStatement,
  statementId: string,
): {
  woRows: PlannedLedgerRow[];
  generatedRows: PlannedLedgerRow[];
  entryIds: string[];
  entryPosts: { entryId: string; postedDate: string }[];
} {
  const woRows: PlannedLedgerRow[] = [];
  const generatedRows: PlannedLedgerRow[] = [];
  const entryIds: string[] = [];
  const entryPosts: { entryId: string; postedDate: string }[] = [];
  const { additions, subtractions } = built.result.detail;
  const rowByKey = new Map(built.input.rows.map((r) => [r.key, r]));
  for (const l of [...additions, ...subtractions]) {
    const kind = lineKindOf(l.key);
    if (kind === "entry") {
      const o = built.origins[l.key];
      if (o?.kind !== "entry") throw new Error(`rosBuild: no origin for ${l.key}`);
      entryIds.push(o.entryId);
      entryPosts.push({ entryId: o.entryId, postedDate: l.date });
      continue;
    }
    if (kind === "wo") {
      const o = built.origins[l.key];
      const r = rowByKey.get(l.key);
      if (o?.kind !== "wo" || !r) throw new Error(`rosBuild: no origin for ${l.key}`);
      woRows.push({
        key: l.key,
        propertyId: l.propertyId,
        unitId: o.billPropertyLevel ? undefined : o.unitId,
        date: l.storedDate,
        postedDate: l.date,
        type: l.type,
        accountId: r.accountId,
        counterparty: r.counterparty,
        memo: l.memo,
        amountCents: l.amountCents,
        source: "work_order",
        sourceId: o.workOrderId,
        workOrderId: o.workOrderId,
        woNumber: o.number,
      });
      continue;
    }
    if (kind === "rent") throw new Error(`rosBuild: a draft has no roster-rent line (${l.key})`);
    const isFee = kind === "fee";
    const accountId = isFee ? built.feeAccountId : built.drawAccountId;
    if (accountId === null) throw new Error("rosBuild: system account missing at finalize");
    generatedRows.push({
      key: l.key,
      propertyId: l.propertyId,
      unitId: undefined,
      date: built.input.periodEnd,
      postedDate: l.date,
      type: l.type,
      accountId,
      counterparty: isFee ? built.input.companyName : (built.payeeName ?? ""),
      memo: l.memo,
      amountCents: l.amountCents,
      source: isFee ? "management_fee" : "owner_draw",
      sourceId: generatedSourceId(statementId, l.propertyId),
    });
  }
  return { woRows, generatedRows, entryIds, entryPosts };
}

/** The immutable final content (spec 5.4 finalize step 8). */
export function makeSnapshot(
  owner: BuildOwner,
  result: StatementResult,
  statementDate: string,
): StatementSnapshot {
  return {
    version: 1,
    header: {
      ownerLegalName: owner.legalName,
      footerName: footerName(owner),
      payeeName: effectivePayee(owner),
      statementDate,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
    },
    result,
  };
}

// --- a final statement's lines, from its snapshot ------------------------------------------------

export type FinalLedgerRow = {
  _id: string;
  propertyId: string;
  unitId?: string;
  accountId: string;
  counterparty: string;
  source: CalcSource;
  sourceId?: string;
  rentForMonth?: string;
};

/** The line key a billed ledger row had on its statement. */
export function keyOfBilledRow(r: FinalLedgerRow): string {
  if (r.source === "work_order" && r.sourceId) return `wo:${r.sourceId}`;
  if (r.source === "management_fee") return `fee:${r.propertyId}`;
  if (r.source === "owner_draw") return `draw:${r.propertyId}`;
  if (r.source === "roster_rent" && r.unitId) return rentKey(r.unitId);
  return `entry:${r._id}`;
}

/**
 * LineViews of a FINAL statement: the figures and text come from the snapshot; ids, account and
 * counterparty from the ledger rows stamped with the statement. Never editable.
 */
export function linesFromSnapshot(
  snapshot: StatementSnapshot,
  billedRows: FinalLedgerRow[],
  woNumbers: Record<string, number>,
): LineView[] {
  const byKey = new Map(billedRows.map((r) => [keyOfBilledRow(r), r]));
  const gen = new Map(snapshot.result.generated.map((g) => [g.propertyId, g]));
  const { additions, subtractions } = snapshot.result.detail;
  return [...additions, ...subtractions].map((l): LineView => {
    const kind = lineKindOf(l.key);
    const r = byKey.get(l.key);
    let sourceLabel: string;
    if (kind === "entry") sourceLabel = entrySourceLabel(l.source);
    else if (kind === "wo") {
      const woId = l.key.slice(3);
      sourceLabel = woNumbers[woId] !== undefined ? `WO-${woNumbers[woId]}` : "Work order";
    } else if (kind === "rent") sourceLabel = ROSTER_RENT_LABEL;
    else if (kind === "fee") sourceLabel = feeSourceLabel(gen.get(l.propertyId)?.fee.overridden === true);
    else sourceLabel = drawSourceLabel(gen.get(l.propertyId)?.draw.overridden === true);
    return {
      key: l.key,
      kind,
      side: ADDITION_TYPES.has(l.type) ? "addition" : "subtraction",
      date: l.date,
      storedDate: l.storedDate,
      carriedForward: l.carriedForward,
      propertyId: l.propertyId,
      propertyName: l.propertyName,
      unit: l.unit,
      accountId: r?.accountId ?? "",
      accountName: l.accountName,
      name: l.name,
      counterparty: r?.counterparty ?? "",
      memo: l.memo,
      amountCents: l.amountCents,
      sourceLabel,
      ...(kind === "entry" && r ? { entryId: r._id } : {}),
      ...(kind === "entry" && r?.source === "rent_payment" && r.rentForMonth !== undefined ? { rentForMonth: r.rentForMonth } : {}),
      ...(kind === "wo" ? { workOrderId: l.key.slice(3) } : {}),
      unitId: r?.unitId ?? null,
      editable: false,
    };
  });
}

/**
 * The new excludedKeys / includedKeys after a toggle. A normal line is off when it is in
 * excludedKeys; a default-excluded line (before the first statement month) is on only when it is in
 * includedKeys. The key is removed from the other list either way, so the two never disagree.
 */
export function toggledKeys(
  st: { excludedKeys: string[]; includedKeys?: string[] },
  key: string,
  exclude: boolean,
  defaultExcluded: boolean,
): { excludedKeys: string[]; includedKeys: string[] } {
  const ex = st.excludedKeys.filter((k) => k !== key);
  const inc = (st.includedKeys ?? []).filter((k) => k !== key);
  if (exclude && !defaultExcluded) ex.push(key);
  if (!exclude && defaultExcluded) inc.push(key);
  return { excludedKeys: ex, includedKeys: inc };
}

/** Snapshot size limit in UTF-8 BYTES (a Convex document is at most 1 MiB). */
export const SNAPSHOT_MAX_BYTES = 900_000;

/** True when the snapshot JSON is too big to store. Counts bytes: "—" or "“" is 3 bytes, not 1. */
export function snapshotTooLarge(json: string): boolean {
  return new TextEncoder().encode(json).length >= SNAPSHOT_MAX_BYTES;
}

/** "September 2026 statement". */
export function statementLabel(month: string): string {
  return `${formatMonth(month)} statement`;
}

// --- the DB loader -------------------------------------------------------------------------------

type DbCtx = Pick<QueryCtx, "db">;

export async function loadBuildData(
  ctx: DbCtx,
  statement: Doc<"ownerStatements">,
  statementDate: string,
): Promise<{ data: BuildData; owner: Doc<"owners"> }> {
  const orgId = statement.orgId;
  const owner = await ctx.db.get(statement.ownerId);
  if (!owner || owner.orgId !== orgId) throw new ConvexError("Owner not found.");

  const accounts = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const settings = await ctx.db
    .query("financeSettings")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();

  const ownerNames = new Map<string, string>([[owner._id, owner.legalName]]);
  const ownerName = async (id: Id<"owners">): Promise<string> => {
    const hit = ownerNames.get(id);
    if (hit !== undefined) return hit;
    const o = await ctx.db.get(id);
    const n = o && o.orgId === orgId ? o.legalName : "Unknown owner";
    ownerNames.set(id, n);
    return n;
  };

  const prev = prevMonth(statement.month);
  // The rent months the "no rent marked received" warning can look at (rentPaymentsPolicy
  // .unpaidCheckMonths narrows this by the first statement month).
  let firstCheckMonth = statement.month;
  for (let i = 0; i < RECEIVED_WINDOW_MONTHS; i++) firstCheckMonth = prevMonth(firstCheckMonth);
  const properties: BuildPropertyData[] = [];
  for (const pid of statement.propertyIds) {
    const prop = await ctx.db.get(pid);
    const property = prop && prop.orgId === orgId ? { name: prop.name } : null;
    const links = (
      await ctx.db
        .query("ownerProperties")
        .withIndex("by_property", (q) => q.eq("propertyId", pid))
        .collect()
    ).filter((l) => l.orgId === orgId);
    const linkOwnerNames: string[] = [];
    for (const l of links) linkOwnerNames.push(await ownerName(l.ownerId));

    const prevRows = await ctx.db
      .query("ownerStatementProperties")
      .withIndex("by_property_and_month", (q) => q.eq("propertyId", pid).eq("month", prev))
      .collect();
    const prevFinal = prevRows.find((r) => r.orgId === orgId && r.status === "final");
    const prevFinalOwnerName = prevFinal ? await ownerName(prevFinal.ownerId) : undefined;
    const anyFinal = await ctx.db
      .query("ownerStatementProperties")
      .withIndex("by_property_and_status", (q) => q.eq("propertyId", pid).eq("status", "final"))
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .first();

    const units = (
      await ctx.db
        .query("units")
        .withIndex("by_property", (q) => q.eq("propertyId", pid))
        .collect()
    ).filter((u) => u.orgId === orgId);

    const residents: Doc<"residents">[] = [];
    const rentRecords: Doc<"ledgerEntries">[] = [];
    for (const u of units) {
      const rows = await ctx.db
        .query("residents")
        .withIndex("by_unit", (q) => q.eq("unitId", u._id))
        .collect();
      for (const r of rows) if (r.orgId === orgId) residents.push(r);
      // Rent payments for the checked rent months, and anything dated in them (rent entered by hand).
      const paid = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_unit_and_rent_month", (q) =>
          q.eq("unitId", u._id).gte("rentForMonth", firstCheckMonth).lte("rentForMonth", statement.month),
        )
        .collect();
      const dated = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_unit_and_date", (q) =>
          q.eq("unitId", u._id).gte("date", monthStart(firstCheckMonth)).lte("date", monthEnd(statement.month)),
        )
        .collect();
      for (const e of [...paid, ...dated]) if (e.orgId === orgId && e.voided !== true) rentRecords.push(e);
    }

    const entries = (
      await ctx.db
        .query("ledgerEntries")
        .withIndex("by_property_statement_date", (q) =>
          q.eq("propertyId", pid).eq("statementId", undefined).lte("date", statement.periodEnd),
        )
        .collect()
    ).filter((e) => e.orgId === orgId);

    // Work orders: only the ones the ROS still needs, not every closed WO of the property.
    const workOrders: Doc<"workOrders">[] = [];
    const seenWo = new Set<string>();
    const addWo = (w: Doc<"workOrders">): void => {
      if (w.orgId !== orgId || seenWo.has(w._id)) return;
      seenWo.add(w._id);
      workOrders.push(w);
    };
    // 1. closed, chargeable, not billed (billable, or missing its bill -> WO_MISSING_BILL)
    const pending = await ctx.db
      .query("workOrders")
      .withIndex("by_property_and_rosPending", (q) => q.eq("propertyId", pid).eq("rosPending", true))
      .collect();
    for (const w of pending) addWo(w);
    // 2. FALLBACK until workOrderBilling.backfillRosPending has run: a WO closed before rosPending
    //    existed has no rosPending, so it is read here (only reviewed_closed ones are kept). After the
    //    backfill this only returns WOs that were never closed since (open ones), so it stays small.
    const unflagged = await ctx.db
      .query("workOrders")
      .withIndex("by_property_and_rosPending", (q) => q.eq("propertyId", pid).eq("rosPending", undefined))
      .collect();
    for (const w of unflagged) if (w.status === "reviewed_closed") addWo(w);
    // 3. awaiting the office's review (WO_AWAITING_REVIEW)
    const awaiting = await ctx.db
      .query("workOrders")
      .withIndex("by_property_and_status", (q) => q.eq("propertyId", pid).eq("status", "completed"))
      .collect();
    for (const w of awaiting) addWo(w);

    properties.push({
      propertyId: pid,
      property,
      links,
      linkOwnerNames,
      prevFinalEndingCents: prevFinal?.endingCashCents ?? null,
      prevFinalOwnerId: prevFinal?.ownerId ?? null,
      ...(prevFinalOwnerName !== undefined ? { prevFinalOwnerName } : {}),
      hasAnyFinal: anyFinal !== null,
      units,
      entries,
      residents,
      rentRecords,
      workOrders,
    });
  }

  return {
    owner,
    data: {
      statement,
      owner,
      accounts,
      properties,
      statementDate,
      ...(settings?.rosDefaultFeeBps !== undefined ? { defaultFeeBps: settings.rosDefaultFeeBps } : {}),
    },
  };
}

/** Spec 5.4 `buildStatement(ctx, statement, { statementDate })`: load + assemble (a draft). */
export async function buildStatement(
  ctx: DbCtx,
  statement: Doc<"ownerStatements">,
  opts: { statementDate: string },
): Promise<BuiltStatement & { data: BuildData; owner: Doc<"owners"> }> {
  const { data, owner } = await loadBuildData(ctx, statement, opts.statementDate);
  return { ...assembleStatement(data, statement.status === "draft"), data, owner };
}
