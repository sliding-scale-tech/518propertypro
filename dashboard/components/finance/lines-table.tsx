"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { LineView } from "@/convex/rosBuild";
import { formatAmount } from "@/convex/rosFormat";
import { Btn, DataTable, Pill, RowMenu, type Column, type RowMenuItem } from "@/components/ui";
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
  caption,
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
  /** Screen-reader table name. */
  caption?: string;
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
      <DataTable
        columns={columns}
        rows={lines}
        rowKey={(l) => l.key}
        empty={empty}
        caption={caption}
        // A click on a row opens its edit dialog (the same as its Edit button).
        onRowClick={actions ? (l) => primaryAction(l, actions)?.run() : undefined}
        rowClickable={actions ? (l) => primaryAction(l, actions) !== null && actions.busyKey !== l.key : undefined}
      />
      <div className="flex justify-end gap-6 px-3.5 text-[13.5px] font-semibold">
        <span>{totalLabel}</span>
        <span className="tabular-nums">{total}</span>
      </div>
    </div>
  );
}

/** The row's main edit action (also what a click on the row opens), or null when it has none. */
function primaryAction(l: LineView, a: LineActions): { label: string; run: () => void } | null {
  if (l.kind === "entry") return canEditEntryLine(l) ? { label: "Edit", run: () => a.onEditEntry(l) } : null;
  if (l.kind === "wo") return l.editable ? { label: "Edit billing", run: () => a.onEditBilling(l) } : null;
  if (l.kind === "fee" || l.kind === "draw") {
    return l.editable ? { label: l.kind === "fee" ? "Edit" : "Edit amount", run: () => a.onEditGenerated(l) } : null;
  }
  return null;
}

function RowActions({ line: l, actions: a }: { line: LineView; actions: LineActions }) {
  const router = useRouter();
  const busy = a.busyKey === l.key;
  if (!l.editable && l.kind !== "entry") return null;
  const primary = primaryAction(l, a);
  // A rent payment is changed or undone on the Payments page only (the link is in the Source cell);
  // canLeaveOffLine allows only taking back a "put back" of one that is off by default.
  const more: RowMenuItem[] = [];
  if (l.kind === "entry") {
    if (canLeaveOffLine(l)) more.push({ label: LEAVE_OFF.button, title: LEAVE_OFF.tooltip, onSelect: () => a.onExclude(l) });
    if (canDeleteLine(l)) more.push({
        label: `${DELETE_ENTRY.button}…`,
        title: l.onRentAccount ? PAYMENTS_LINK.legacyRentTooltip : undefined,
        onSelect: () => a.onDeleteEntry(l),
        danger: true,
      });
  } else if (l.kind === "wo") {
    more.push({ label: LEAVE_OFF.button, title: LEAVE_OFF.tooltip, onSelect: () => a.onExclude(l) });
    if (l.workOrderId) {
      const href = `/work-orders/${l.workOrderId}`;
      more.push({ label: "Open work order", onSelect: () => router.push(href) });
    }
  } else if (l.kind === "fee" || l.kind === "draw") {
    more.push({ label: "Skip this month", onSelect: () => a.onSkipGenerated(l) });
  }
  if (!primary && more.length === 0) return null;
  return (
    <div className="flex items-center justify-end gap-1.5">
      {primary ? (
        <Btn sm onClick={primary.run} disabled={busy}>
          {primary.label}
        </Btn>
      ) : null}
      {more.length > 0 ? (
        busy ? (
          <span className="inline-flex h-7 w-7 items-center justify-center" aria-label="Working…">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin text-muted-foreground" />
          </span>
        ) : (
          <RowMenu label={`More actions for ${l.accountName} ${formatAmount(l.amountCents)}`} items={more} />
        )
      ) : null}
    </div>
  );
}
