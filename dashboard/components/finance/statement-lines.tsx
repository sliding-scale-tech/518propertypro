"use client";

import { useMutation } from "convex/react";
import { ChevronDown, Plus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { LineView } from "@/convex/rosBuild";
import { formatAmount, formatCurrency, formatDate } from "@/convex/rosFormat";
import { Btn, Card, DataTable, Pill, cx, type Column } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { serverError } from "@/lib/form-errors";
import { BillingDialog } from "./billing-dialog";
import type { StatementData } from "./finalize-dialogs";
import { LinkBtn } from "./form-bits";
import { GeneratedDialog } from "./generated-dialog";
import { LEAVE_OFF } from "./line-labels";
import { LinesTable, type LineActions } from "./lines-table";
import { groupByProperty, linesForStep } from "./statement-steps";
import { TransactionForm, VoidDialog, type EntryInit } from "./transaction-form";
import { ANCHOR, REVEAL_EVENT } from "./warning-links";

type Dialog =
  | { kind: "add"; side: "addition" | "subtraction"; propertyId?: string }
  | { kind: "edit"; entry: EntryInit }
  | { kind: "void"; entryId: string; summary: string }
  | { kind: "billing"; workOrderId: string; label: string }
  | { kind: "generated"; propertyId: string; which: "fee" | "draw" };

function entryOf(l: LineView): EntryInit {
  return {
    entryId: l.entryId ?? "",
    propertyId: l.propertyId,
    unitId: l.unitId ?? null,
    date: l.storedDate,
    accountId: l.accountId,
    accountName: l.accountName,
    counterparty: l.counterparty,
    memo: l.memo,
    amountCents: l.amountCents,
  };
}

export type StatementActions = {
  /** null on a final or discarded statement (read-only). */
  lineActions: LineActions | null;
  busyKey: string | null;
  openAdd: (side: "addition" | "subtraction", propertyId?: string) => void;
  openGenerated: (propertyId: string, which: "fee" | "draw") => void;
  includeLine: (l: LineView) => void;
  setGeneratedExcluded: (propertyId: string, which: "fee" | "draw", excluded: boolean) => void;
  /** The open dialog, rendered once by the page. */
  dialogs: ReactNode;
};

/**
 * Every line action of the draft editor (spec 6.3): edit / leave off / put back / delete manual
 * rows, WO billing, fee and draw overrides and skips. Shared by the Money in, Money out and Fees &
 * payout steps; the page renders `dialogs` once.
 */
export function useStatementActions(data: StatementData): StatementActions {
  const excludeLine = useMutation(api.ownerStatements.excludeLine);
  const includeLineM = useMutation(api.ownerStatements.includeLine);
  const setGenerated = useMutation(api.ownerStatements.setGenerated);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const { statement } = data;
  const sid = statement._id as string;
  const isDraft = statement.status === "draft";
  const period = { month: statement.month, start: statement.periodStart, end: statement.periodEnd };
  const propertyIds = data.properties.map((p) => p.propertyId);

  async function act(key: string, run: () => Promise<unknown>, done: string) {
    setBusyKey(key);
    try {
      await run();
      toast.success(done);
    } catch (e) {
      toast.error(serverError(e).message);
    } finally {
      setBusyKey(null);
    }
  }

  const setGeneratedExcluded = (propertyId: string, which: "fee" | "draw", excluded: boolean) =>
    void act(
      `${which}:${propertyId}`,
      () => setGenerated({ statementId: sid, propertyId, kind: which, excluded }),
      excluded
        ? which === "fee"
          ? "Management fee skipped this month."
          : "Owner draw skipped this month."
        : which === "fee"
          ? "Management fee put back."
          : "Owner draw put back.",
    );

  const lineActions: LineActions | null = isDraft
    ? {
        busyKey,
        onEditEntry: (l) => setDialog({ kind: "edit", entry: entryOf(l) }),
        onEditBilling: (l) => l.workOrderId && setDialog({ kind: "billing", workOrderId: l.workOrderId, label: l.sourceLabel }),
        onEditGenerated: (l) =>
          setDialog({ kind: "generated", propertyId: l.propertyId, which: l.kind === "fee" ? "fee" : "draw" }),
        onDeleteEntry: (l) =>
          l.entryId &&
          setDialog({
            kind: "void",
            entryId: l.entryId,
            summary: `${formatDate(l.storedDate)} · ${l.accountName} · ${formatAmount(l.amountCents)}`,
          }),
        onExclude: (l) => void act(l.key, () => excludeLine({ statementId: sid, key: l.key }), LEAVE_OFF.toast),
        onSkipGenerated: (l) => setGeneratedExcluded(l.propertyId, l.kind === "fee" ? "fee" : "draw", true),
      }
    : null;

  const genProp = dialog?.kind === "generated" ? data.properties.find((p) => p.propertyId === dialog.propertyId) : undefined;
  const close = () => setDialog(null);

  const dialogs = (
    <>
      {dialog?.kind === "add" ? (
        <TransactionForm
          mode="add"
          side={dialog.side}
          allowedPropertyIds={propertyIds}
          defaultPropertyId={dialog.propertyId}
          period={period}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === "edit" ? (
        <TransactionForm
          mode="edit"
          entry={dialog.entry}
          allowedPropertyIds={propertyIds}
          period={period}
          onClose={close}
          onVoid={() =>
            setDialog({
              kind: "void",
              entryId: dialog.entry.entryId,
              summary: `${formatDate(dialog.entry.date)} · ${dialog.entry.accountName} · ${formatAmount(dialog.entry.amountCents)}`,
            })
          }
        />
      ) : null}
      {dialog?.kind === "void" ? <VoidDialog entryId={dialog.entryId} summary={dialog.summary} onClose={close} /> : null}
      {dialog?.kind === "billing" ? (
        <BillingDialog workOrderId={dialog.workOrderId} woLabel={dialog.label} onClose={close} />
      ) : null}
      {dialog?.kind === "generated" && genProp ? (
        <GeneratedDialog
          statementId={sid}
          propertyId={genProp.propertyId}
          propertyName={genProp.name}
          kind={dialog.which}
          fee={genProp.fee}
          draw={genProp.draw}
          onClose={close}
        />
      ) : null}
    </>
  );

  return {
    lineActions,
    busyKey,
    openAdd: (side, propertyId) => isDraft && setDialog({ kind: "add", side, propertyId }),
    openGenerated: (propertyId, which) => isDraft && setDialog({ kind: "generated", propertyId, which }),
    includeLine: (l) =>
      void act(l.key, () => includeLineM({ statementId: sid, key: l.key }), LEAVE_OFF.putBackToast),
    setGeneratedExcluded,
    dialogs,
  };
}

const COPY = {
  in: {
    title: "Money in",
    intro: "Rent payments and other income on this statement, by property.",
    empty: "No money in for this property. Rent shows here once it is marked received on the Payments page.",
    subtotal: "Money in",
    total: "Total money in",
    leftOffEmpty: "No income is left off this statement.",
  },
  out: {
    title: "Money out",
    intro: "Work orders and other expenses, by property. The management fee and owner draw are on Fees & payout.",
    empty: "No expenses for this property.",
    subtotal: "Money out",
    total: "Total money out (before fee and draw)",
    leftOffEmpty: "No expenses are left off this statement.",
  },
} as const;

/** Steps 2 and 3: the statement's additions or its expenses, grouped by property with subtotals. */
export function LinesStep({
  data,
  step,
  ctl,
  banner,
}: {
  data: StatementData;
  step: "in" | "out";
  ctl: StatementActions;
  /** The warnings about this step (rendered above the lines). */
  banner?: ReactNode;
}) {
  const { statement } = data;
  const isDraft = statement.status === "draft";
  const copy = COPY[step];
  const lines = linesForStep(data.lines, step);
  const groups = groupByProperty(lines, data.properties);
  const multi = groups.length > 1;
  // "Total money in" is the server's total of additions to cash; money out has no server total
  // that leaves out the fee and the draw, so it is the sum of the lines shown.
  const total = step === "in" ? data.view.detail.additionsTotal.amount : formatCurrency(lines.reduce((n, l) => n + l.amountCents, 0));
  const leftOff = linesForStep(data.excludedLines, step);
  const side = step === "in" ? "addition" : "subtraction";

  const actionsRow = isDraft ? (
    <div className="flex flex-wrap items-center gap-2">
      {step === "in" ? (
        <LinkBtn href={`/payments?month=${statement.month}&owner=${encodeURIComponent(data.owner._id)}`}>
          Record rent on Payments page
        </LinkBtn>
      ) : null}
      <Btn sm variant="pri" onClick={() => ctl.openAdd(side)}>
        <Plus aria-hidden className="h-3.5 w-3.5" /> {step === "in" ? "Add income" : "Add expense"}
      </Btn>
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-[640px] text-[13px] text-muted-foreground">{copy.intro}</p>
        {actionsRow}
      </div>
      {banner}
      {groups.map((g) => (
        <Card key={g.propertyId}>
          {multi ? (
            <div className="mb-3 flex flex-wrap items-baseline gap-2">
              <h3 className="text-[15px] font-semibold">{g.name}</h3>
              <span className="text-[12.5px] text-muted-foreground">
                {g.lines.length} {g.lines.length === 1 ? "line" : "lines"}
              </span>
              {isDraft ? (
                <button
                  type="button"
                  onClick={() => ctl.openAdd(side, g.propertyId)}
                  className="ml-auto inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[12.5px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <Plus aria-hidden className="h-3.5 w-3.5" /> {step === "in" ? "Add income here" : "Add expense here"}
                </button>
              ) : null}
            </div>
          ) : null}
          <LinesTable
            lines={g.lines}
            showProperty={false}
            total={multi ? formatCurrency(g.subtotalCents) : total}
            totalLabel={multi ? `${copy.subtotal}: ${g.name}` : copy.total}
            actions={ctl.lineActions}
            draft={isDraft}
            empty={copy.empty}
            caption={`${copy.title}: ${g.name}`}
          />
        </Card>
      ))}
      {multi ? (
        <div className="flex justify-end gap-6 rounded-2xl border border-border bg-muted/60 px-[22px] py-3 text-[14px] font-semibold">
          <span>{copy.total}</span>
          <span className="tabular-nums">{total}</span>
        </div>
      ) : null}
      {isDraft ? (
        <LeftOffSection
          lines={leftOff}
          showProperty={multi}
          busyKey={ctl.busyKey}
          onInclude={ctl.includeLine}
          empty={copy.leftOffEmpty}
        />
      ) : null}
    </div>
  );
}

/**
 * "Left off this statement" for one side (collapsed; the count in the title). A Check item's
 * "Show left-off lines" (revealSection) opens it.
 */
function LeftOffSection({
  lines,
  showProperty,
  busyKey,
  onInclude,
  empty,
}: {
  lines: LineView[];
  showProperty: boolean;
  busyKey: string | null;
  onInclude: (l: LineView) => void;
  empty: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onReveal = () => setOpen(true);
    el.addEventListener(REVEAL_EVENT, onReveal);
    return () => el.removeEventListener(REVEAL_EVENT, onReveal);
  }, []);

  const columns: Column<LineView>[] = [
    {
      key: "date",
      header: "Date",
      className: "whitespace-nowrap tabular-nums",
      render: (l) => <div className="min-w-[6.5rem]">{formatDate(l.storedDate)}</div>,
    },
    ...(showProperty ? [{ key: "property", header: "Property", render: (l: LineView) => l.propertyName } as Column<LineView>] : []),
    { key: "unit", header: "Unit", render: (l) => l.unit },
    { key: "account", header: "Account", render: (l) => l.accountName },
    { key: "name", header: "Name", render: (l) => l.name },
    {
      key: "memo",
      header: "Memo",
      render: (l) => (
        <div className="min-w-[10rem] max-w-[320px] whitespace-normal break-words">
          <span title={l.memo}>{l.memo}</span>
          {l.note ? <div className="mt-0.5 text-[11.5px] text-warning-ink">{l.note}</div> : null}
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      className: "whitespace-nowrap tabular-nums",
      render: (l) => formatAmount(l.amountCents),
    },
    { key: "source", header: "Source", render: (l) => <Pill>{l.sourceLabel}</Pill> },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (l) => (
        <Btn sm disabled={busyKey === l.key} onClick={() => onInclude(l)}>
          {LEAVE_OFF.putBack}
        </Btn>
      ),
    },
  ];

  return (
    <div id={ANCHOR.leftOff} ref={ref} tabIndex={-1} className="outline-none">
      <Card className="!bg-muted/30">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 text-left text-[14px] font-semibold"
        >
          {LEAVE_OFF.cardTitle} ({lines.length})
          <ChevronDown aria-hidden className={cx("ml-auto h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        {open ? (
          <>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Lines left off stay unbilled and come back on next month&apos;s draft. Lines dated before the owner&apos;s
              first statement month start here (rent payments received before it too); put one back only if it
              wasn&apos;t billed in Buildium. Other rent payments can&apos;t be left off: undo one on the Payments page
              instead.
            </p>
            <div className="mt-3">
              <DataTable columns={columns} rows={lines} rowKey={(l) => l.key} empty={empty} />
            </div>
          </>
        ) : null}
      </Card>
    </div>
  );
}
