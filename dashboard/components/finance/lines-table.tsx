"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { LineView } from "@/convex/rosBuild";
import { formatAmount } from "@/convex/rosFormat";
import { Btn, DataTable, Pill, type Column } from "@/components/ui";
import { TONE_SOFT, cx } from "@/components/ui/cx";
import {
  DELETE_ENTRY,
  LEAVE_OFF,
  PAYMENTS_LINK,
  canDeleteLine,
  canEditEntryLine,
  canLeaveOffLine,
  carriedForwardTag,
  isRentPaymentLine,
  lineDateCell,
  paymentsPageHref,
} from "./line-labels";

export type LineActions = {
  onEditEntry: (l: LineView) => void;
  onEditBilling: (l: LineView) => void;
  onEditGenerated: (l: LineView) => void;
  /** Leave the line off this month (ownerStatements.excludeLine). */
  onExclude: (l: LineView) => void;
  /** Manual, unbilled line: open the Delete dialog (ledger.voidEntry). */
  onDeleteEntry: (l: LineView) => void;
  onSkipGenerated: (l: LineView) => void;
  /** The line key whose action is in flight. */
  busyKey: string | null;
};

function sourceTone(l: LineView): "neutral" | "acc" | "vio" | "warn" | "ok" {
  if (l.kind === "wo") return "acc";
  if (l.kind === "rent" || isRentPaymentLine(l)) return "ok";
  if (l.kind === "fee" || l.kind === "draw") return l.sourceLabel.includes("edited") ? "warn" : "vio";
  return "neutral";
}

/**
 * One side of the draft (Additions to cash / Subtractions from cash), spec 6.3 item 2. Every figure
 * is the server's: amounts are LineView cents shown with formatAmount, the total is the view string.
 */
export function LinesTable({
  lines,
  showProperty,
  total,
  totalLabel,
  actions,
  empty,
  draft,
}: {
  lines: LineView[];
  showProperty: boolean;
  total: string;
  totalLabel: string;
  /** null = read-only (final statement). */
  actions: LineActions | null;
  empty: ReactNode;
  /** The statement is a draft (the carried-forward pill says the line is not on a final statement yet). */
  draft: boolean;
}) {
  const columns: Column<LineView>[] = [
    {
      key: "date",
      header: "Date",
      className: "whitespace-nowrap",
      render: (l) => {
        const cell = lineDateCell(l);
        return (
          <div className="min-w-[6.5rem]">
            <div className="tabular-nums">{cell.date}</div>
            {cell.posts ? <div className="text-[11px] tabular-nums text-muted-foreground">{cell.posts}</div> : null}
          </div>
        );
      },
    },
    ...(showProperty
      ? [{ key: "property", header: "Property", render: (l: LineView) => l.propertyName } as Column<LineView>]
      : []),
    { key: "unit", header: "Unit", className: "whitespace-nowrap", render: (l) => l.unit },
    { key: "account", header: "Account", render: (l) => l.accountName },
    { key: "name", header: "Name", render: (l) => l.name },
    {
      key: "memo",
      header: "Memo",
      render: (l) => (
        <span className="block min-w-[10rem] max-w-[320px] whitespace-normal break-words" title={l.memo}>
          {l.memo}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      className: "whitespace-nowrap tabular-nums",
      render: (l) => formatAmount(l.amountCents),
    },
    {
      key: "source",
      header: "Source",
      render: (l) => {
        const tag = carriedForwardTag(l, draft);
        return (
          <div className="flex min-w-[8rem] flex-col items-start gap-1">
            <Pill tone={sourceTone(l)} title={isRentPaymentLine(l) ? PAYMENTS_LINK.tooltip : undefined}>
              {l.sourceLabel}
            </Pill>
            {isRentPaymentLine(l) ? (
              <Link
                href={paymentsPageHref(l)}
                title={PAYMENTS_LINK.tooltip}
                className="whitespace-nowrap text-[12px] font-medium text-primary hover:underline"
              >
                {draft ? PAYMENTS_LINK.edit : PAYMENTS_LINK.view}
              </Link>
            ) : null}
            {tag ? (
              <span
                className={cx(
                  "inline-block max-w-[220px] rounded-[10px] px-[9px] py-0.5 text-[11.5px] font-medium leading-4",
                  TONE_SOFT.warn,
                )}
              >
                {tag}
              </span>
            ) : null}
          </div>
        );
      },
    },
  ];
  if (actions) {
    columns.push({
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (l) => <RowActions line={l} actions={actions} />,
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <DataTable columns={columns} rows={lines} rowKey={(l) => l.key} empty={empty} />
      <div className="flex justify-end gap-6 px-3.5 text-[13.5px] font-semibold">
        <span>{totalLabel}</span>
        <span className="tabular-nums">{total}</span>
      </div>
    </div>
  );
}

function RowActions({ line: l, actions: a }: { line: LineView; actions: LineActions }) {
  const busy = a.busyKey === l.key;
  if (!l.editable && l.kind !== "entry") return null;
  // A rent payment is changed or undone on the Payments page only (the link is in the Source cell);
  // canLeaveOffLine allows only taking back a "put back" of one that is off by default.
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {l.kind === "entry" ? (
        <>
          {canEditEntryLine(l) ? (
            <Btn sm onClick={() => a.onEditEntry(l)} disabled={busy}>
              Edit
            </Btn>
          ) : null}
          {canLeaveOffLine(l) ? (
            <Btn sm onClick={() => a.onExclude(l)} disabled={busy} title={LEAVE_OFF.tooltip}>
              {LEAVE_OFF.button}
            </Btn>
          ) : null}
          {canDeleteLine(l) ? (
            <Btn
              sm
              variant="dng"
              onClick={() => a.onDeleteEntry(l)}
              disabled={busy}
              title={l.onRentAccount ? PAYMENTS_LINK.legacyRentTooltip : undefined}
            >
              {DELETE_ENTRY.button}
            </Btn>
          ) : null}
        </>
      ) : null}
      {l.kind === "wo" ? (
        <>
          <Btn sm onClick={() => a.onEditBilling(l)} disabled={busy}>
            Edit billing
          </Btn>
          <Btn sm onClick={() => a.onExclude(l)} disabled={busy} title={LEAVE_OFF.tooltip}>
            {LEAVE_OFF.button}
          </Btn>
          {l.workOrderId ? (
            <Link
              href={`/work-orders/${l.workOrderId}`}
              className="self-center whitespace-nowrap px-1 text-[12.5px] font-medium text-primary hover:underline"
            >
              Open work order
            </Link>
          ) : null}
        </>
      ) : null}
      {l.kind === "fee" || l.kind === "draw" ? (
        <>
          <Btn sm onClick={() => a.onEditGenerated(l)} disabled={busy}>
            {l.kind === "fee" ? "Edit" : "Edit amount"}
          </Btn>
          <Btn sm onClick={() => a.onSkipGenerated(l)} disabled={busy}>
            Skip this month
          </Btn>
        </>
      ) : null}
    </div>
  );
}
