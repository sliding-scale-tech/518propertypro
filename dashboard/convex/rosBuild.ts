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
import { COMPANY_NAME, MAX_AMOUNT_CENTS, PROPERTY_LEVEL, businessDate, formatMonth, isIsoDate, monthStart, naturalCompare, prevMonth } from "./rosFormat";
import {
  ADDITION_TYPES,
  MAX_STATEMENT_LINES,
  MSG,
  RENT_MSG,
  RENT_SKIP_TEXT,
  ROSTER_RENT_LABEL,
  ROSTER_RENT_MEMO,
  cmpStr,
  effectiveFee,
  finalizeProblem,
  rentPrefillDecision,
  selectWorkOrders,
  type RentSkipCode,
  type RowType,
  type WoForBilling,
} from "./rosPolicy";

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
  /** Roster occupancy / lease type: "vacant" ones get no rent line (rosPolicy.rosterSaysVacant). */
  occupancy?: string;
  leaseType?: string;
};

/** A resident row (residents table): only active ones name the tenant on a rent line. */
export type BuildResident = { unitId: string; fullName: string; active: boolean };

/** The accountant's edits to a prefilled rent line (ownerStatements.rentOverrides). */
export type BuildRentOverride = {
  unitId: string;
  amountCents?: number;
  date?: string;
  counterparty?: string;
  memo?: string;
};

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
  rentOverrides?: BuildRentOverride[];
  /** Set = the accountant confirmed the rent lines; valid only while rentCheckedHash matches. */
  rentCheckedAt?: number;
  rentCheckedHash?: string;
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
  /** Residents of the property's units (roster-rent tenant names). Absent = none loaded. */
  residents?: BuildResident[];
  /**
   * Extra ledger rows (any owner, billed or not) dated inside the period, used ONLY for the roster
   * rent "already recorded" check; they never go on the statement from here.
   */
  rentRecorded?: BuildEntry[];
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

export type LineKind = "entry" | "wo" | "fee" | "draw" | "rent";

/** The roster values of a prefilled rent line (what "Reset to roster" goes back to). */
export type RentDefault = { amountCents: number; date: string; counterparty: string; memo: string };

/** A unit that got no roster-rent line, and why ("Not prefilled" card). */
export type RentSkip = {
  propertyId: string;
  propertyName: string;
  unitId: string;
  unit: string;
  code: RentSkipCode;
  reason: string;
};

export type RentSummary = {
  /** Roster-rent lines on the statement, included and removed. */
  lineCount: number;
  /** Fingerprint of every rent line (roster and Rent Income ledger rows); null = no roster-rent line. */
  hash: string | null;
  /** True while the stored confirmation matches the current rent lines. */
  checked: boolean;
  skipped: RentSkip[];
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
  /** Roster-rent lines only: the roster values, and whether the accountant changed any of them. */
  rentDefault?: RentDefault;
  rentEdited?: boolean;
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
  | { kind: "entry"; entryId: string; source: CalcSource; unitId: string | null }
  | { kind: "wo"; workOrderId: string; number: number; unitId: string; billPropertyLevel: boolean }
  | { kind: "rent"; unitId: string; rentDefault: RentDefault; edited: boolean };

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
  rent: RentSummary;
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

/** Key of a unit's roster-rent line. */
export function rentKey(unitId: string): string {
  return `rent:${unitId}`;
}

/** Deterministic sourceId of the roster-rent ledger row finalize writes for a unit. */
export function rentSourceId(statementId: string, unitId: string): string {
  return `${statementId}:${unitId}`;
}

/**
 * The effective rent line of a unit: the roster values with the accountant's overrides on top. An
 * override field that isn't valid (amount not 1..MAX cents, date outside the period, blank text) is
 * ignored, so a bad stored value can never reach the statement.
 */
export function applyRentOverride(
  def: RentDefault,
  ov: BuildRentOverride | undefined,
  periodStart: string,
  periodEnd: string,
): { value: RentDefault; edited: boolean } {
  if (!ov) return { value: def, edited: false };
  const a = ov.amountCents;
  const amountCents = typeof a === "number" && Number.isSafeInteger(a) && a > 0 && a <= MAX_AMOUNT_CENTS ? a : def.amountCents;
  const d = ov.date;
  const date = typeof d === "string" && isIsoDate(d) && d >= periodStart && d <= periodEnd ? d : def.date;
  const counterparty = (typeof ov.counterparty === "string" ? ov.counterparty.trim() : "") || def.counterparty;
  const memo = (typeof ov.memo === "string" ? ov.memo.trim() : "") || def.memo;
  const value = { amountCents, date, counterparty, memo };
  const edited =
    amountCents !== def.amountCents || date !== def.date || counterparty !== def.counterparty || memo !== def.memo;
  return { value, edited };
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
  }
}

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

/** `propertyId` / `workOrderId` (when the warning is about one) let the UI link to where it's fixed. */
export type WarningView = { code: string; message: string; propertyId?: string; workOrderId?: string };

export function splitWarnings(warnings: StatementWarning[]): { blocking: WarningView[]; info: WarningView[] } {
  const view = (w: StatementWarning): WarningView => ({
    code: w.code,
    message: w.message,
    ...(w.propertyId !== undefined ? { propertyId: w.propertyId } : {}),
    ...(w.workOrderId !== undefined ? { workOrderId: w.workOrderId } : {}),
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
  const rentAccount = accounts.find((a) => a.systemKey === "rent_income") ?? null;
  const rentAccountIds = new Set(accounts.filter((a) => a.systemKey === "rent_income").map((a) => a._id));
  const rentOv = new Map((st.rentOverrides ?? []).map((o) => [o.unitId, o]));
  const rentSkipped: RentSkip[] = [];
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

    // manual (and later Stripe) ledger rows
    for (const e of pd.entries) {
      if (e.propertyId !== pid || e.statementId !== undefined || e.voided === true) continue;
      if (e.ownerId !== st.ownerId || e.date > st.periodEnd) continue;
      const unitLabel = e.unitId !== undefined ? (unitLabelOf.get(e.unitId) ?? null) : null;
      take(
        entryToCalcRow(e, unitLabel),
        { kind: "entry", entryId: e._id, source: e.source, unitId: e.unitId ?? null },
        e.date < floorDate ? MSG.ENTRY_BEFORE_START_NOTE : undefined,
      );
    }

    // roster rent (until Stripe): one Rent Income line per occupied unit, dated periodStart, unless
    // the unit is skipped (each skip is listed in rent.skipped, so nothing is dropped silently)
    if (rentAccount !== null) {
      const tenantsOf = new Map<string, string[]>();
      for (const r of pd.residents ?? []) {
        if (!r.active) continue;
        const list = tenantsOf.get(r.unitId) ?? [];
        list.push(r.fullName);
        tenantsOf.set(r.unitId, list);
      }
      // A non-voided Rent Income row for the unit dated inside the period (any owner, billed or not):
      // the rent is already recorded (by hand now, Stripe later), so it is not prefilled twice.
      const recorded = new Set<string>();
      for (const e of [...pd.entries, ...(pd.rentRecorded ?? [])]) {
        if (e.voided === true || e.unitId === undefined || e.propertyId !== pid || !rentAccountIds.has(e.accountId)) continue;
        if (e.date < st.periodStart || e.date > st.periodEnd) continue;
        recorded.add(e.unitId);
      }
      const units = [...pd.units].sort((a, b) => naturalCompare(a.unitNumber, b.unitNumber) || cmpStr(a._id, b._id));
      for (const u of units) {
        const d = rentPrefillDecision({
          rent: u.rent,
          rentPaidTo: u.rentPaidTo,
          tenants: tenantsOf.get(u._id) ?? [],
          alreadyRecorded: recorded.has(u._id),
          occupancy: u.occupancy,
          leaseType: u.leaseType,
        });
        if (!d.ok) {
          rentSkipped.push({
            propertyId: pid,
            propertyName: name,
            unitId: u._id,
            unit: u.unitNumber,
            code: d.code,
            reason: d.code === "already_recorded" ? RENT_SKIP_TEXT.already_recorded(st.month) : RENT_SKIP_TEXT[d.code],
          });
          if (d.code === "invalid_rent") {
            dbWarnings.push({ code: "RENT_INVALID", propertyId: pid, message: RENT_MSG.INVALID(u.unitNumber, name), blocking: false });
          }
          continue;
        }
        const def: RentDefault = { amountCents: d.amountCents, date: st.periodStart, counterparty: d.counterparty, memo: ROSTER_RENT_MEMO };
        const { value, edited } = applyRentOverride(def, rentOv.get(u._id), st.periodStart, st.periodEnd);
        take(
          {
            key: rentKey(u._id),
            propertyId: pid,
            unitLabel: u.unitNumber,
            date: value.date,
            accountId: rentAccount._id,
            counterparty: value.counterparty,
            memo: value.memo,
            amountCents: value.amountCents,
            source: "roster_rent",
            seq: 0,
          },
          { kind: "rent", unitId: u._id, rentDefault: def, edited },
        );
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

  if (rentAccount === null && data.properties.some((pd) => pd.units.length > 0)) {
    dbWarnings.push({ code: "RENT_ACCOUNT_MISSING", message: RENT_MSG.ACCOUNT_MISSING, blocking: false });
  }

  // The rent confirmation: a fingerprint of every rent line (roster lines and Rent Income ledger
  // rows, on or off). Only statements with a roster-rent line need it; any change voids it.
  const rentRows = [
    ...included.map((r) => ({ r, on: true })),
    ...excludedRows.map((r) => ({ r, on: false })),
  ].filter(({ r }) => r.key.startsWith("rent:") || rentAccountIds.has(r.accountId));
  const rosterRentCount = rentRows.filter(({ r }) => r.key.startsWith("rent:")).length;
  const rentHash =
    rosterRentCount === 0
      ? null
      : hashString(
          JSON.stringify(
            rentRows
              .map(({ r, on }) => [r.key, on, r.propertyId, r.unitLabel, r.date, r.accountId, r.amountCents, r.counterparty, r.memo])
              .sort((a, b) => cmpStr(a[0] as string, b[0] as string)),
          ),
        );
  const rentChecked = rentHash !== null && st.rentCheckedAt !== undefined && st.rentCheckedHash === rentHash;
  if (rentHash !== null && !rentChecked) {
    dbWarnings.push({ code: "RENT_NOT_CHECKED", message: RENT_MSG.NOT_CHECKED(st.month), blocking: true });
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
      return withDefaultOff(view.kind === "rent" ? { ...view, note: RENT_MSG.REMOVED_NOTE } : view, defaultOff);
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
    rent: {
      lineCount: rosterRentCount,
      hash: rentHash,
      checked: rentChecked,
      skipped: rentSkipped,
    },
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
      editable: isDraft && origin.source === "manual",
    };
  }
  if (origin.kind === "rent") {
    return {
      ...base,
      sourceLabel: ROSTER_RENT_LABEL,
      unitId: origin.unitId,
      editable: isDraft,
      rentDefault: origin.rentDefault,
      rentEdited: origin.edited,
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
  source: "work_order" | "management_fee" | "owner_draw" | "roster_rent";
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
 * - one Rent Income row per included roster-rent line (unit level, dated and posted on the line's
 *   date, which is inside the period), sourceId = `${statementId}:${unitId}`;
 * - the included ledger entries to stamp with statementId and their posted (effective) date.
 */
export function finalizePlan(
  built: BuiltStatement,
  statementId: string,
): {
  woRows: PlannedLedgerRow[];
  generatedRows: PlannedLedgerRow[];
  rentRows: PlannedLedgerRow[];
  entryIds: string[];
  entryPosts: { entryId: string; postedDate: string }[];
} {
  const woRows: PlannedLedgerRow[] = [];
  const rentRows: PlannedLedgerRow[] = [];
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
    if (kind === "rent") {
      const o = built.origins[l.key];
      const r = rowByKey.get(l.key);
      if (o?.kind !== "rent" || !r) throw new Error(`rosBuild: no origin for ${l.key}`);
      rentRows.push({
        key: l.key,
        propertyId: l.propertyId,
        unitId: o.unitId,
        date: l.storedDate,
        postedDate: l.date,
        type: l.type,
        accountId: r.accountId,
        counterparty: r.counterparty,
        memo: l.memo,
        amountCents: l.amountCents,
        source: "roster_rent",
        sourceId: rentSourceId(statementId, o.unitId),
      });
      continue;
    }
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
  return { woRows, generatedRows, rentRows, entryIds, entryPosts };
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
  // Defensive input for the roster-rent "already recorded" check: this owner's BILLED rows dated in
  // the period (unbilled ones are in `entries`). By the statement invariants there are none while
  // the month has a draft, but a rent prefill must never double a recorded payment.
  const billedInPeriod = (
    await ctx.db
      .query("ledgerEntries")
      .withIndex("by_owner_and_date", (q) =>
        q.eq("ownerId", statement.ownerId).gte("date", statement.periodStart).lte("date", statement.periodEnd),
      )
      .collect()
  ).filter((e) => e.orgId === orgId && e.statementId !== undefined);
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
    for (const u of units) {
      const rows = await ctx.db
        .query("residents")
        .withIndex("by_unit", (q) => q.eq("unitId", u._id))
        .collect();
      for (const r of rows) if (r.orgId === orgId) residents.push(r);
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
      rentRecorded: billedInPeriod.filter((e) => e.propertyId === pid),
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
