/**
 * Rental Owner Statement (ROS): a StatementResult turned into display strings. Used by the on-screen
 * preview, the PDF and the golden test, so all three show exactly the same text.
 * Spec: docs/specs/ros-build-spec.md section 4.3.
 *
 * Pure: no Convex imports, erasable TypeScript only.
 */

import type { Cols, DetailLine, StatementResult } from "./rosCalc";
import { COMPANY_ADDRESS_LINES, COMPANY_NAME, formatAmount, formatCurrency, formatDate, formatPeriod, generatedStamp } from "./rosFormat";

/** "section" = bold label, empty values; "total" = bold + $ values; "grand" = bold + $ values + double rule below. */
export type ViewRow = { kind: "row" | "section" | "total" | "grand"; label: string; values: string[] };

export type DetailViewLine = {
  date: string;
  property: string;
  unit: string;
  account: string;
  name: string;
  memo: string;
  amount: string;
  balance: string;
};

export type StatementView = {
  header: {
    title: "Rental Owner Statement";
    periodLabel: "Statement period";
    period: string;
    dateLabel: "Statement date";
    date: string;
    preparedBy: [string, string, string];
  };
  summary: { title: "Summary by property"; columns: string[]; rows: ViewRow[] };
  incomeStatement: { title: "Income statement"; columns: string[]; rows: ViewRow[] };
  detail: {
    title: "Detail transactions";
    columns: ["Date", "Property", "Unit", "Account", "Name", "Memo", "Amount", "Balance"];
    beginning: { label: string; balance: string };
    additionsTitle: "Additions to cash";
    additions: DetailViewLine[];
    additionsTotal: { label: "Total from additions to cash"; amount: string };
    subtractionsTitle: "Subtractions from cash";
    subtractions: DetailViewLine[];
    subtractionsTotal: { label: "Total from subtractions from cash"; amount: string };
    ending: { label: string; balance: string };
  };
};

export const ALL_PROPERTIES = "All properties";
const EN_DASH = "–";

function vals(c: Cols, fmt: (cents: number) => string): string[] {
  return [...c.byProperty.map(fmt), fmt(c.total)];
}

function row(label: string, c: Cols): ViewRow {
  return { kind: "row", label, values: vals(c, formatAmount) };
}
function total(label: string, c: Cols): ViewRow {
  return { kind: "total", label, values: vals(c, formatCurrency) };
}
function grand(label: string, c: Cols): ViewRow {
  return { kind: "grand", label, values: vals(c, formatCurrency) };
}

function detailLine(l: DetailLine): DetailViewLine {
  return {
    date: formatDate(l.date),
    property: l.propertyName,
    unit: l.unit,
    account: l.accountName,
    name: l.name,
    memo: l.memo,
    amount: formatAmount(l.amountCents),
    balance: formatAmount(l.balanceCents),
  };
}

export function buildView(result: StatementResult, header: { statementDate: string }): StatementView {
  const columns = [...result.columns.map((c) => c.name), ALL_PROPERTIES];
  const section = (label: string): ViewRow => ({ kind: "section", label, values: columns.map(() => "") });
  const s = result.summary;
  const is = result.incomeStatement;
  const d = result.detail;

  return {
    header: {
      title: "Rental Owner Statement",
      periodLabel: "Statement period",
      period: formatPeriod(result.periodStart, result.periodEnd),
      dateLabel: "Statement date",
      date: formatDate(header.statementDate),
      preparedBy: [`Prepared By: ${COMPANY_NAME}`, COMPANY_ADDRESS_LINES[0], COMPANY_ADDRESS_LINES[1]],
    },
    summary: {
      title: "Summary by property",
      columns,
      rows: [
        total("Beginning cash balance", s.beginning),
        section("+ Additions to cash"),
        row("Income", s.income),
        row("Owner contributions", s.ownerContributions),
        row("Other additions", s.otherAdditions),
        section(`${EN_DASH} Subtractions from cash`),
        row("Expenses", s.expenses),
        row("Owner draws", s.ownerDraws),
        row("Other subtractions", s.otherSubtractions),
        total("Ending cash balance", s.ending),
        section(`${EN_DASH} Adjustments`),
        row("Tenant security deposits and early payments", s.depositsAndEarlyPayments),
        row("Property reserve", s.propertyReserve),
        row("Unpaid bills", s.unpaidBills),
        row("Pending ePay payments", s.pendingEpay),
        grand("Available for payment", s.available),
      ],
    },
    incomeStatement: {
      title: "Income statement",
      columns,
      rows: [
        section("Income"),
        ...is.income.accounts.map((a) => row(a.name, a.values)),
        total("Total income", is.income.total),
        section("Expense"),
        ...is.expense.accounts.map((a) => row(a.name, a.values)),
        total("Total expenses", is.expense.total),
        grand("Net income", is.netIncome),
      ],
    },
    detail: {
      title: "Detail transactions",
      columns: ["Date", "Property", "Unit", "Account", "Name", "Memo", "Amount", "Balance"],
      beginning: {
        label: `Beginning cash balance as of ${formatDate(result.periodStart)}`,
        balance: formatCurrency(d.beginningCents),
      },
      additionsTitle: "Additions to cash",
      additions: d.additions.map(detailLine),
      additionsTotal: { label: "Total from additions to cash", amount: formatCurrency(d.totalAdditionsCents) },
      subtractionsTitle: "Subtractions from cash",
      subtractions: d.subtractions.map(detailLine),
      subtractionsTotal: { label: "Total from subtractions from cash", amount: formatCurrency(d.totalSubtractionsCents) },
      ending: {
        label: `Ending cash balance as of ${formatDate(result.periodEnd)}`,
        balance: formatCurrency(d.endingCents),
      },
    },
  };
}

/** "Adam Nye - Generated 10/16/2026 09:26:36". */
export function footerLeft(footerName: string, generatedMs: number): string {
  return `${footerName} - Generated ${generatedStamp(generatedMs)}`;
}

/** "Page 1". */
export function pageLabel(n: number): string {
  return `Page ${n}`;
}
