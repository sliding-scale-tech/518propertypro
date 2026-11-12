/**
 * Rental Owner Statement (ROS): the statement engine. Pure and deterministic.
 * Spec: docs/specs/ros-build-spec.md section 4.2. Golden check: scripts/probes/ros_golden.test.mjs.
 *
 * No Convex imports, erasable TypeScript only. All money is integer cents; the only rounding is the
 * management fee (percentOf: half up, once per property row).
 *
 * computeStatement throws a plain Error (not ConvexError) on inconsistent input: the server has
 * already validated everything a user can type, so a throw here is a programming error.
 */

import {
  MAX_AMOUNT_CENTS,
  PROPERTY_LEVEL,
  assertCents,
  formatBps,
  formatCurrency,
  formatPeriod,
  isIsoDate,
  naturalCompare,
  percentOf,
} from "./rosFormat";
import { ADDITION_TYPES, MSG, cmpStr, isRowType, type RowType } from "./rosPolicy";

export type { RowType } from "./rosPolicy";

export type CalcAccount = { id: string; name: string; kind: RowType; feeBase: boolean; systemKey?: string };

export type CalcSource =
  | "manual"
  | "work_order"
  | "management_fee"
  | "owner_draw"
  | "opening_balance"
  | "stripe"
  | "roster_rent"
  | "rent_payment";

export type CalcRow = {
  key: string; // "entry:<id>" | "wo:<id>" | "rent:<unitId>" (fee/draw rows are produced by the engine)
  propertyId: string;
  unitLabel: string | null; // null = Property level
  date: string; // stored date (WO: business date of completion, see 5.6)
  accountId: string;
  counterparty: string;
  memo: string;
  amountCents: number; // integer > 0
  source: CalcSource;
  seq: number; // final tie-break: entry createdAt, or WO completedAt (ms)
};

export type CalcProperty = {
  id: string;
  name: string; // properties.name, e.g. "108 Jackson Avenue"
  beginningCashCents: number; // signed
  securityDepositsCents: number; // sum of units' securityDepositHeldCents (undefined -> 0)
  earlyPaymentsCents: number;
  propertyReserveCents: number;
  unpaidBillsCents: number;
  pendingEpayCents: number; // 0 in Phase 1
  /**
   * This property's management fee in basis points (its own fee, else the org default; resolved by
   * rosBuild with rosPolicy.effectiveFee). Absent = fall back to `owner.managementFeeBps` (old
   * inputs and tests only); null after that = no fee at all -> FEE_NOT_SET.
   */
  feeBps?: number | null;
  fee: { amountOverrideCents: number | null; memoOverride: string | null; excluded: boolean };
  draw: { amountOverrideCents: number | null; excluded: boolean };
};

export type CalcInput = {
  periodStart: string;
  periodEnd: string;
  /**
   * `legalName` is not in spec 4.2's CalcInput, but the FEE_NOT_SET and PAYEE_MISSING messages
   * (5.8) need it. `payeeName` should be effectivePayee(owner). `managementFeeBps` is only the
   * fallback for a property without `feeBps` (the fee is per property since 2026-11-11).
   */
  owner: { legalName: string; payeeName: string | null; managementFeeBps?: number | null };
  companyName: string; // COMPANY_NAME
  properties: CalcProperty[]; // column order
  accounts: CalcAccount[]; // must include systemKey management_fees and owner_draw (when a fee/draw row is produced)
  rows: CalcRow[]; // INCLUDED rows only (exclusions already removed), date <= periodEnd
};

export type Cols = { byProperty: number[]; total: number }; // byProperty[i] matches properties[i]

export type DetailLine = {
  key: string;
  propertyId: string;
  date: string; // effective date = max(stored date, periodStart)
  storedDate: string;
  carriedForward: boolean;
  propertyName: string;
  unit: string; // label or "Property level"
  accountName: string;
  name: string;
  memo: string;
  amountCents: number;
  balanceCents: number;
  source: CalcRow["source"];
  type: RowType;
};

export type StatementWarning = {
  code: string;
  /** The property the warning is about, so the UI can link to its settings on the owner page. */
  propertyId?: string;
  /** The work order the warning is about (WO_MISSING_BILL, WO_AWAITING_REVIEW), for a link. */
  workOrderId?: string;
  /** RENT_UNPAID: the rent month, so the UI links to the Payments page for it. */
  rentMonth?: string;
  message: string;
  blocking: boolean;
};

export type GeneratedFee = {
  baseCents: number;
  bps: number | null;
  computedCents: number;
  amountCents: number;
  memo: string;
  overridden: boolean;
  excluded: boolean;
};

export type GeneratedDraw = { suggestedCents: number; amountCents: number; overridden: boolean; excluded: boolean };

export type StatementResult = {
  periodStart: string;
  periodEnd: string;
  columns: { propertyId: string; name: string }[];
  summary: {
    beginning: Cols;
    income: Cols;
    ownerContributions: Cols;
    otherAdditions: Cols;
    expenses: Cols;
    ownerDraws: Cols;
    otherSubtractions: Cols;
    ending: Cols;
    depositsAndEarlyPayments: Cols;
    propertyReserve: Cols;
    unpaidBills: Cols;
    pendingEpay: Cols;
    available: Cols;
  };
  incomeStatement: {
    income: { accounts: { accountId: string; name: string; values: Cols }[]; total: Cols };
    expense: { accounts: { accountId: string; name: string; values: Cols }[]; total: Cols };
    netIncome: Cols;
  };
  detail: {
    beginningCents: number;
    additions: DetailLine[];
    totalAdditionsCents: number;
    subtractions: DetailLine[];
    totalSubtractionsCents: number;
    endingCents: number;
  };
  generated: { propertyId: string; fee: GeneratedFee; draw: GeneratedDraw }[];
  warnings: StatementWarning[];
};

export type StatementSnapshot = {
  version: 1;
  header: {
    ownerLegalName: string;
    footerName: string;
    payeeName: string | null;
    statementDate: string;
    periodStart: string;
    periodEnd: string;
  };
  result: StatementResult;
};

export const FEE_SEQ = Number.MAX_SAFE_INTEGER - 1;
export const DRAW_SEQ = Number.MAX_SAFE_INTEGER;
export const OWNER_DRAW_MEMO = "Owner Draw";

// --- small helpers ---------------------------------------------------------------------------------

function fail(msg: string): never {
  throw new Error(`computeStatement: ${msg}`);
}

function checkSum(n: number): number {
  assertCents(n);
  return n;
}

function nonNegInt(n: unknown, what: string): number {
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) fail(`${what} must be a non-negative integer, got ${String(n)}`);
  return n;
}

function overrideValue(n: unknown, what: string): number | null {
  if (n === null || n === undefined) return null;
  return nonNegInt(n, what);
}

/** Two-person contact text ("Ann / Bob", "Ann and Bob", "Ann & Bob") gives no derived payee. */
function looksLikeTwoPeople(s: string): boolean {
  return s.includes("/") || s.includes("&") || / and /i.test(s);
}

/**
 * Owner draw "Name" (ASSUMPTION A12): payeeName if set, else "first last" from the contact, else
 * null. Also null when the contact holds two people ("/", " and ", "&").
 */
export function effectivePayee(owner: {
  payeeName?: string | null;
  contactFirstName?: string | null;
  contactLastName?: string | null;
}): string | null {
  const payee = owner.payeeName?.trim();
  if (payee) return payee;
  const first = owner.contactFirstName?.trim() ?? "";
  const last = owner.contactLastName?.trim() ?? "";
  if (looksLikeTwoPeople(first) || looksLikeTwoPeople(last)) return null;
  return `${first} ${last}`.trim() || null;
}

/** PDF footer name (ASSUMPTION A12): "first last" from the contact, else the legal name. */
export function footerName(owner: {
  contactFirstName?: string | null;
  contactLastName?: string | null;
  legalName: string;
}): string {
  const first = owner.contactFirstName?.trim() ?? "";
  const last = owner.contactLastName?.trim() ?? "";
  return `${first} ${last}`.trim() || owner.legalName;
}

/** The Name column: "Unit 2nd Floor - David Roberts", or the counterparty alone at property level. */
export function displayName(unitLabel: string | null, counterparty: string): string {
  return unitLabel ? `Unit ${unitLabel} - ${counterparty}` : counterparty;
}

/** "Management Fee 9/1/2026 - 9/30/2026 (5.00% of $4,333.87)". */
export function feeMemo(periodStart: string, periodEnd: string, bps: number, baseCents: number): string {
  return `Management Fee ${formatPeriod(periodStart, periodEnd)} (${formatBps(bps)}% of ${formatCurrency(baseCents)})`;
}

/** The detail's running balance must land on the summary's ending cash. Throws Error if not. */
export function assertEndingInvariant(detailEndingCents: number, summaryEndingCents: number): void {
  if (detailEndingCents !== summaryEndingCents) {
    throw new Error(
      `computeStatement: detail ending ${String(detailEndingCents)} does not match summary ending ${String(summaryEndingCents)}`,
    );
  }
}

// --- the engine ------------------------------------------------------------------------------------

type WorkRow = CalcRow & { effDate: string; carriedForward: boolean; type: RowType; colIndex: number; accountName: string };

function sortRank(r: WorkRow): number {
  if (ADDITION_TYPES.has(r.type)) return 0;
  if (r.type === "owner_draw") return 2;
  if (r.source === "management_fee") return 1;
  return 0;
}

/**
 * Detail order (spec 4.2 step 6): effective date, rank (fee just before the draw, the draw last),
 * then stored date (so carried-forward rows lead the period's first day; this key only matters on
 * periodStart and is an addition to the spec's list), column, Property level before units, natural
 * unit, natural account name, seq, key.
 */
function compareDetail(a: WorkRow, b: WorkRow): number {
  return (
    cmpStr(a.effDate, b.effDate) ||
    sortRank(a) - sortRank(b) ||
    cmpStr(a.date, b.date) ||
    a.colIndex - b.colIndex ||
    (a.unitLabel === null ? (b.unitLabel === null ? 0 : -1) : b.unitLabel === null ? 1 : naturalCompare(a.unitLabel, b.unitLabel)) ||
    naturalCompare(a.accountName, b.accountName) ||
    a.seq - b.seq ||
    cmpStr(a.key, b.key)
  );
}

export function computeStatement(input: CalcInput): StatementResult {
  const { periodStart, periodEnd, owner, companyName } = input;

  // ---- validate the input (programming errors only) ----
  if (!isIsoDate(periodStart) || !isIsoDate(periodEnd)) fail("bad period dates");
  if (periodStart > periodEnd) fail("periodStart is after periodEnd");
  const checkBps = (b: number | null | undefined, what: string): number | null => {
    if (b === null || b === undefined) return null;
    if (!Number.isSafeInteger(b) || b < 0 || b > 10000) fail(`bad ${what} ${String(b)}`);
    return b;
  };
  const ownerBps = checkBps(owner.managementFeeBps, "managementFeeBps");
  const payee = owner.payeeName?.trim() ? owner.payeeName.trim() : null;

  const props = input.properties;
  const colOf = new Map<string, number>();
  props.forEach((p, i) => {
    if (typeof p.id !== "string" || p.id === "") fail("property without id");
    if (colOf.has(p.id)) fail(`duplicate property ${p.id}`);
    colOf.set(p.id, i);
    assertCents(p.beginningCashCents);
    nonNegInt(p.securityDepositsCents, `securityDepositsCents of ${p.id}`);
    nonNegInt(p.earlyPaymentsCents, `earlyPaymentsCents of ${p.id}`);
    nonNegInt(p.propertyReserveCents, `propertyReserveCents of ${p.id}`);
    nonNegInt(p.unpaidBillsCents, `unpaidBillsCents of ${p.id}`);
    nonNegInt(p.pendingEpayCents, `pendingEpayCents of ${p.id}`);
    overrideValue(p.fee.amountOverrideCents, `fee override of ${p.id}`);
    overrideValue(p.draw.amountOverrideCents, `draw override of ${p.id}`);
  });
  const n = props.length;
  // Each property's fee: its own feeBps, else the owner fallback (old inputs), else none.
  const bpsOf: (number | null)[] = props.map((p) =>
    p.feeBps !== undefined ? checkBps(p.feeBps, `feeBps of ${p.id}`) : ownerBps,
  );

  const accountOf = new Map<string, CalcAccount>();
  for (const a of input.accounts) {
    if (accountOf.has(a.id)) fail(`duplicate account ${a.id}`);
    if (!isRowType(a.kind)) fail(`account ${a.id} has a bad kind ${String(a.kind)}`);
    accountOf.set(a.id, a);
  }
  const feeAccount = input.accounts.find((a) => a.systemKey === "management_fees");
  const drawAccount = input.accounts.find((a) => a.systemKey === "owner_draw");

  const keys = new Set<string>();
  const work: WorkRow[] = [];
  for (const r of input.rows) {
    if (typeof r.key !== "string" || r.key === "") fail("row without key");
    if (keys.has(r.key)) fail(`duplicate row key ${r.key}`);
    keys.add(r.key);
    const col = colOf.get(r.propertyId);
    if (col === undefined) fail(`row ${r.key} has an unknown property ${r.propertyId}`);
    const acc = accountOf.get(r.accountId);
    if (!acc) fail(`row ${r.key} has an unknown account ${r.accountId}`);
    if (!isIsoDate(r.date)) fail(`row ${r.key} has a bad date ${String(r.date)}`);
    if (r.date > periodEnd) fail(`row ${r.key} is dated after the period end`);
    if (!Number.isSafeInteger(r.amountCents) || r.amountCents <= 0 || r.amountCents > MAX_AMOUNT_CENTS) {
      fail(`row ${r.key} has a bad amount ${String(r.amountCents)}`);
    }
    if (typeof r.seq !== "number" || !Number.isFinite(r.seq)) fail(`row ${r.key} has a bad seq`);
    if (r.unitLabel !== null && typeof r.unitLabel !== "string") fail(`row ${r.key} has a bad unit label`);
    work.push({
      ...r,
      effDate: r.date < periodStart ? periodStart : r.date,
      carriedForward: r.date < periodStart,
      type: acc.kind,
      colIndex: col,
      accountName: acc.name,
    });
  }

  const warnings: StatementWarning[] = [];
  const generated: StatementResult["generated"] = [];
  const zero = (): number[] => new Array<number>(n).fill(0);
  const sumBy = (pred: (r: WorkRow) => boolean): number[] => {
    const out = zero();
    for (const r of work) if (pred(r)) out[r.colIndex] = checkSum(out[r.colIndex] + r.amountCents);
    return out;
  };

  // ---- step 2: management fee, per property, each at its own % ----
  // Every property has a fee since 2026-11-11 (own fee ?? org default), so this only fires for an
  // input that gives none; kept as a guard (one warning for the statement).
  if (bpsOf.some((b) => b === null)) {
    warnings.push({ code: "FEE_NOT_SET", message: MSG.FEE_NOT_SET(owner.legalName), blocking: true });
  }
  // Only income accounts may count toward the fee (ledgerAccounts.setFeeBase enforces it); the kind
  // check here means a bad flag on another kind can never inflate an owner's fee.
  const feeBase = sumBy((r) => r.type === "income" && accountOf.get(r.accountId)!.feeBase === true);
  const feeRows: WorkRow[] = [];
  const fees: GeneratedFee[] = props.map((p, i) => {
    const base = feeBase[i];
    const override = p.fee.amountOverrideCents;
    const memoOverride = p.fee.memoOverride?.trim() ? p.fee.memoOverride.trim() : null;
    const excluded = p.fee.excluded === true;
    const overridden = override !== null || memoOverride !== null;
    const bps = bpsOf[i];
    if (bps === null) {
      return { baseCents: base, bps: null, computedCents: 0, amountCents: 0, memo: memoOverride ?? "", overridden, excluded };
    }
    const computed = percentOf(base, bps);
    let amount = excluded ? 0 : (override ?? computed);
    const memo = memoOverride ?? feeMemo(periodStart, periodEnd, bps, base);
    if (amount > MAX_AMOUNT_CENTS) {
      // Blocks finalize; the row is capped so the draft (and its PDF preview) still builds.
      warnings.push({ code: "AMOUNT_TOO_LARGE", propertyId: p.id, message: MSG.AMOUNT_TOO_LARGE("fee", p.name), blocking: true });
      amount = MAX_AMOUNT_CENTS;
    }
    if (amount > 0) {
      if (!feeAccount) fail("no account with systemKey management_fees");
      const key = `fee:${p.id}`;
      if (keys.has(key)) fail(`duplicate row key ${key}`);
      keys.add(key);
      feeRows.push({
        key,
        propertyId: p.id,
        unitLabel: null,
        date: periodEnd,
        accountId: feeAccount.id,
        counterparty: companyName,
        memo,
        amountCents: amount,
        source: "management_fee",
        seq: FEE_SEQ,
        effDate: periodEnd,
        carriedForward: false,
        type: feeAccount.kind,
        colIndex: i,
        accountName: feeAccount.name,
      });
    }
    return { baseCents: base, bps, computedCents: computed, amountCents: amount, memo, overridden, excluded };
  });
  work.push(...feeRows);

  // ---- step 3: owner draw, per property ----
  const addsBefore = sumBy((r) => ADDITION_TYPES.has(r.type));
  const subsBefore = sumBy((r) => !ADDITION_TYPES.has(r.type)); // expense (incl. fee) + other_subtraction + ledger owner_draw
  let payeeWarned = false;
  const drawRows: WorkRow[] = [];
  const draws: GeneratedDraw[] = props.map((p, i) => {
    const cashBeforeDraw = checkSum(p.beginningCashCents + addsBefore[i] - subsBefore[i]);
    const suggested = Math.max(0, cashBeforeDraw - p.propertyReserveCents - p.unpaidBillsCents);
    const override = p.draw.amountOverrideCents;
    const excluded = p.draw.excluded === true;
    let amount = excluded ? 0 : (override ?? suggested);
    if (amount > MAX_AMOUNT_CENTS) {
      // Blocks finalize; the row is capped so the draft (and its PDF preview) still builds.
      warnings.push({ code: "AMOUNT_TOO_LARGE", propertyId: p.id, message: MSG.AMOUNT_TOO_LARGE("draw", p.name), blocking: true });
      amount = MAX_AMOUNT_CENTS;
    }
    if (amount > 0) {
      if (payee === null && !payeeWarned) {
        payeeWarned = true;
        warnings.push({ code: "PAYEE_MISSING", message: MSG.PAYEE_MISSING(owner.legalName), blocking: true });
      }
      if (!drawAccount) fail("no account with systemKey owner_draw");
      const key = `draw:${p.id}`;
      if (keys.has(key)) fail(`duplicate row key ${key}`);
      keys.add(key);
      drawRows.push({
        key,
        propertyId: p.id,
        unitLabel: null,
        date: periodEnd,
        accountId: drawAccount.id,
        counterparty: payee ?? "",
        memo: OWNER_DRAW_MEMO,
        amountCents: amount,
        source: "owner_draw",
        seq: DRAW_SEQ,
        effDate: periodEnd,
        carriedForward: false,
        type: drawAccount.kind,
        colIndex: i,
        accountName: drawAccount.name,
      });
    }
    if (suggested === 0 && override === null && !excluded) {
      warnings.push({ code: "NO_DRAW", propertyId: p.id, message: MSG.NO_DRAW(p.name, cashBeforeDraw), blocking: false });
    }
    return { suggestedCents: suggested, amountCents: amount, overridden: override !== null, excluded };
  });
  work.push(...drawRows);
  props.forEach((p, i) => generated.push({ propertyId: p.id, fee: fees[i], draw: draws[i] }));

  // ---- step 4: summary ----
  const cols = (byProperty: number[]): Cols => {
    let total = 0;
    for (const v of byProperty) total = checkSum(total + v);
    return { byProperty, total };
  };
  const ofType = (t: RowType): number[] => sumBy((r) => r.type === t);
  const beginning = props.map((p) => p.beginningCashCents);
  const income = ofType("income");
  const ownerContributions = ofType("owner_contribution");
  const otherAdditions = ofType("other_addition");
  const expenses = ofType("expense");
  const ownerDraws = ofType("owner_draw");
  const otherSubtractions = ofType("other_subtraction");
  const ending = props.map((_, i) =>
    checkSum(
      beginning[i] + income[i] + ownerContributions[i] + otherAdditions[i] - expenses[i] - ownerDraws[i] - otherSubtractions[i],
    ),
  );
  const deposits = props.map((p) => checkSum(p.securityDepositsCents + p.earlyPaymentsCents));
  const reserve = props.map((p) => p.propertyReserveCents);
  const unpaid = props.map((p) => p.unpaidBillsCents);
  const pending = props.map((p) => p.pendingEpayCents);
  const available = props.map((_, i) => checkSum(ending[i] - deposits[i] - reserve[i] - unpaid[i] - pending[i]));

  props.forEach((p, i) => {
    if (ending[i] < 0) {
      warnings.push({ code: "NEGATIVE_ENDING", propertyId: p.id, message: MSG.NEGATIVE_ENDING(p.name, ending[i]), blocking: false });
    }
  });

  const summary: StatementResult["summary"] = {
    beginning: cols(beginning),
    income: cols(income),
    ownerContributions: cols(ownerContributions),
    otherAdditions: cols(otherAdditions),
    expenses: cols(expenses),
    ownerDraws: cols(ownerDraws),
    otherSubtractions: cols(otherSubtractions),
    ending: cols(ending),
    depositsAndEarlyPayments: cols(deposits),
    propertyReserve: cols(reserve),
    unpaidBills: cols(unpaid),
    pendingEpay: cols(pending),
    available: cols(available),
  };

  // ---- step 5: income statement ----
  const group = (kind: "income" | "expense") => {
    const used = input.accounts.filter((a) => a.kind === kind && work.some((r) => r.accountId === a.id));
    used.sort((a, b) => naturalCompare(a.name, b.name) || cmpStr(a.id, b.id));
    const accounts = used.map((a) => ({ accountId: a.id, name: a.name, values: cols(sumBy((r) => r.accountId === a.id)) }));
    const total = cols(props.map((_, i) => accounts.reduce((s, a) => checkSum(s + a.values.byProperty[i]), 0)));
    return { accounts, total };
  };
  const incomeGroup = group("income");
  const expenseGroup = group("expense");
  const netIncome = cols(props.map((_, i) => checkSum(incomeGroup.total.byProperty[i] - expenseGroup.total.byProperty[i])));

  // ---- step 6: detail ----
  const toLine = (r: WorkRow, balanceCents: number): DetailLine => ({
    key: r.key,
    propertyId: r.propertyId,
    date: r.effDate,
    storedDate: r.date,
    carriedForward: r.carriedForward,
    propertyName: props[r.colIndex].name,
    unit: r.unitLabel ?? PROPERTY_LEVEL,
    accountName: r.accountName,
    name: displayName(r.unitLabel, r.counterparty),
    memo: r.memo,
    amountCents: r.amountCents,
    balanceCents,
    source: r.source,
    type: r.type,
  });
  const addRows = work.filter((r) => ADDITION_TYPES.has(r.type)).sort(compareDetail);
  const subRows = work.filter((r) => !ADDITION_TYPES.has(r.type)).sort(compareDetail);
  const beginningCents = summary.beginning.total;
  let balance = beginningCents;
  let totalAdditionsCents = 0;
  const additions = addRows.map((r) => {
    balance = checkSum(balance + r.amountCents);
    totalAdditionsCents = checkSum(totalAdditionsCents + r.amountCents);
    return toLine(r, balance);
  });
  let totalSubtractionsCents = 0;
  const subtractions = subRows.map((r) => {
    balance = checkSum(balance - r.amountCents);
    totalSubtractionsCents = checkSum(totalSubtractionsCents + r.amountCents);
    return toLine(r, balance);
  });
  assertEndingInvariant(balance, summary.ending.total);

  // statement-level blocking warnings first, then per-property info in column order
  const order = (w: StatementWarning): number => (w.blocking ? 0 : 1);
  const colIdx = (w: StatementWarning): number => (w.propertyId === undefined ? -1 : colOf.get(w.propertyId)!);
  const indexed = warnings.map((w, i) => ({ w, i }));
  indexed.sort((a, b) => order(a.w) - order(b.w) || colIdx(a.w) - colIdx(b.w) || a.i - b.i);

  return {
    periodStart,
    periodEnd,
    columns: props.map((p) => ({ propertyId: p.id, name: p.name })),
    summary,
    incomeStatement: { income: incomeGroup, expense: expenseGroup, netIncome },
    detail: { beginningCents, additions, totalAdditionsCents, subtractions, totalSubtractionsCents, endingCents: balance },
    generated,
    warnings: indexed.map((x) => x.w),
  };
}
