"use client";

import { useMutation, useQuery } from "convex/react";
import { ChevronDown, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { LineView } from "@/convex/rosBuild";
import { formatAmount, formatDate } from "@/convex/rosFormat";
import { Btn, Card, CardHead, DataTable, Pill, Seg, cx, type Column } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { serverError } from "@/lib/form-errors";
import { AdjustmentsCard } from "./adjustments-card";
import { BillingDialog } from "./billing-dialog";
import { FinanceNav } from "./finance-nav";
import { LinkBtn, Spinner } from "./form-bits";
import { GeneratedDialog } from "./generated-dialog";
import { HistoryCard } from "./history-card";
import { LEAVE_OFF } from "./line-labels";
import { LinesTable, type LineActions } from "./lines-table";
import { SidePanel, type StatementData } from "./side-panel";
import { StatementPreview } from "./statement-preview";
import { StatusPill } from "./statements-list";
import { TransactionForm, VoidDialog, type EntryInit } from "./transaction-form";
import { ANCHOR, REVEAL_EVENT } from "./warning-links";
import { WarningsCard } from "./warnings-card";

type Tab = "transactions" | "preview";

type Dialog =
  | { kind: "add" }
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

/** `/owner-statements/[id]`: the draft editor, or the read-only final statement (spec 6.3). */
export function StatementPage({ statementId }: { statementId: string }) {
  const data = useQuery(api.ownerStatements.get, { statementId });
  const [tab, setTab] = useState<Tab | null>(null);

  if (data === undefined) {
    return (
      <div className="pb-10">
        <FinanceNav active="statements" />
        <Spinner label="Building the statement…" />
      </div>
    );
  }

  const { statement, owner } = data;
  const isDraft = statement.status === "draft";
  const current: Tab = tab ?? (isDraft ? "transactions" : "preview");

  return (
    <div className="pb-10">
      <nav aria-label="Breadcrumb" className="mb-2 text-[12.5px] text-muted-foreground">
        <Link href="/owner-statements" className="hover:text-foreground hover:underline">
          Owner reports
        </Link>
        <span aria-hidden> / </span>
        <Link href={`/owner-statements/owners/${owner._id}`} className="hover:text-foreground hover:underline">
          {owner.legalName}
        </Link>
        <span aria-hidden> / </span>
        <Link href={`/owner-statements?month=${statement.month}`} className="hover:text-foreground hover:underline">
          {statement.monthLabel}
        </Link>
      </nav>
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-balance text-[28px] font-bold leading-[1.2] tracking-[-0.02em]">
          {owner.legalName}: {statement.monthLabel}
        </h1>
        <StatusPill status={statement.status} />
      </header>

      {statement.status === "discarded" ? (
        <div className="mb-5 rounded-2xl border border-danger-ink/30 bg-danger-soft px-4 py-3 text-[13.5px] text-danger-ink">
          This draft was discarded. Nothing on it was billed. Generate the month again from the statements list.
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Seg<Tab>
            label="Statement view"
            value={current}
            onChange={setTab}
            options={[
              { value: "transactions", label: "Transactions" },
              { value: "preview", label: "Preview" },
            ]}
          />
          {current === "preview" ? (
            <StatementPreview view={data.view} draft={isDraft} />
          ) : (
            <TransactionsTab data={data} />
          )}
        </div>
        <aside className="min-w-0">
          <SidePanel data={data} onFinalized={() => setTab("preview")} />
        </aside>
      </div>
    </div>
  );
}

function TransactionsTab({ data }: { data: StatementData }) {
  const excludeLine = useMutation(api.ownerStatements.excludeLine);
  const includeLine = useMutation(api.ownerStatements.includeLine);
  const setGenerated = useMutation(api.ownerStatements.setGenerated);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const { statement } = data;
  const sid = statement._id as string;
  const isDraft = statement.status === "draft";
  const showProperty = data.properties.length > 1;
  const period = { month: statement.month, start: statement.periodStart, end: statement.periodEnd };

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

  const actions: LineActions | null = isDraft
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
        onSkipGenerated: (l) =>
          void act(
            l.key,
            () => setGenerated({ statementId: sid, propertyId: l.propertyId, kind: l.kind, excluded: true }),
            l.kind === "fee" ? "Management fee skipped this month." : "Owner draw skipped this month.",
          ),
      }
    : null;

  const additions = data.lines.filter((l) => l.side === "addition");
  const subtractions = data.lines.filter((l) => l.side === "subtraction");
  const genProp = dialog?.kind === "generated" ? data.properties.find((p) => p.propertyId === dialog.propertyId) : undefined;

  return (
    <>
      {isDraft ? (
        <WarningsCard blocking={data.warnings.blocking} info={data.warnings.info} ownerId={data.owner._id} />
      ) : null}

      <Card>
        <CardHead
          title="Additions to cash"
          right={
            isDraft ? (
              <div className="flex flex-wrap items-center gap-2">
                <LinkBtn
                  href={`/payments?month=${statement.month}&owner=${encodeURIComponent(data.owner._id)}`}
                >
                  Record rent on Payments page
                </LinkBtn>
                <Btn sm variant="pri" onClick={() => setDialog({ kind: "add" })}>
                  <Plus aria-hidden className="h-3.5 w-3.5" /> Add transaction
                </Btn>
              </div>
            ) : undefined
          }
        />
        <LinesTable
          lines={additions}
          showProperty={showProperty}
          total={data.view.detail.additionsTotal.amount}
          totalLabel={data.view.detail.additionsTotal.label}
          actions={actions}
          draft={isDraft}
          empty="No additions this month. Rent shows here once it is marked received on the Payments page."
        />
      </Card>

      <Card>
        <CardHead title="Subtractions from cash" />
        <LinesTable
          lines={subtractions}
          showProperty={showProperty}
          total={data.view.detail.subtractionsTotal.amount}
          totalLabel={data.view.detail.subtractionsTotal.label}
          actions={actions}
          draft={isDraft}
          empty="No subtractions this month."
        />
      </Card>

      {isDraft ? (
        <ExcludedCard
          data={data}
          busyKey={busyKey}
          onInclude={(l) =>
            void act(l.key, () => includeLine({ statementId: sid, key: l.key }), LEAVE_OFF.putBackToast)
          }
          onIncludeGenerated={(propertyId, kind) =>
            void act(
              `${kind}:${propertyId}`,
              () => setGenerated({ statementId: sid, propertyId, kind, excluded: false }),
              kind === "fee" ? "Management fee put back." : "Owner draw put back.",
            )
          }
        />
      ) : null}

      <AdjustmentsCard
        statementId={sid}
        ownerId={data.owner._id}
        properties={data.properties}
        readOnly={!isDraft}
      />

      <HistoryCard statementId={sid} />

      {dialog?.kind === "add" ? (
        <TransactionForm
          mode="add"
          allowedPropertyIds={data.properties.map((p) => p.propertyId)}
          period={period}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "edit" ? (
        <TransactionForm
          mode="edit"
          entry={dialog.entry}
          allowedPropertyIds={data.properties.map((p) => p.propertyId)}
          period={period}
          onClose={() => setDialog(null)}
          onVoid={() =>
            setDialog({
              kind: "void",
              entryId: dialog.entry.entryId,
              summary: `${formatDate(dialog.entry.date)} · ${dialog.entry.accountName} · ${formatAmount(dialog.entry.amountCents)}`,
            })
          }
        />
      ) : null}
      {dialog?.kind === "void" ? (
        <VoidDialog entryId={dialog.entryId} summary={dialog.summary} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "billing" ? (
        <BillingDialog workOrderId={dialog.workOrderId} woLabel={dialog.label} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "generated" && genProp ? (
        <GeneratedDialog
          statementId={sid}
          propertyId={genProp.propertyId}
          propertyName={genProp.name}
          kind={dialog.which}
          fee={genProp.fee}
          draw={genProp.draw}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}

type ExcludedRow =
  | { kind: "line"; key: string; line: LineView }
  | { kind: "generated"; key: string; propertyId: string; propertyName: string; which: "fee" | "draw"; amountCents: number };

function ExcludedCard({
  data,
  busyKey,
  onInclude,
  onIncludeGenerated,
}: {
  data: StatementData;
  busyKey: string | null;
  onInclude: (l: LineView) => void;
  onIncludeGenerated: (propertyId: string, kind: "fee" | "draw") => void;
}) {
  const [open, setOpen] = useState(false);
  // A warning's "Show left-off lines →" (revealSection) opens the card.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const onReveal = () => setOpen(true);
    el.addEventListener(REVEAL_EVENT, onReveal);
    return () => el.removeEventListener(REVEAL_EVENT, onReveal);
  }, []);
  const rows: ExcludedRow[] = [
    ...data.excludedLines.map((l): ExcludedRow => ({ kind: "line", key: l.key, line: l })),
    ...data.properties.flatMap((p): ExcludedRow[] => [
      ...(p.fee.excluded
        ? [{ kind: "generated" as const, key: `fee:${p.propertyId}`, propertyId: p.propertyId, propertyName: p.name, which: "fee" as const, amountCents: p.fee.computedCents }]
        : []),
      ...(p.draw.excluded
        ? [{ kind: "generated" as const, key: `draw:${p.propertyId}`, propertyId: p.propertyId, propertyName: p.name, which: "draw" as const, amountCents: p.draw.suggestedCents }]
        : []),
    ]),
  ];
  const showProperty = data.properties.length > 1;

  const columns: Column<ExcludedRow>[] = [
    {
      key: "date",
      header: "Date",
      className: "whitespace-nowrap tabular-nums",
      render: (r) => <div className="min-w-[6.5rem]">{r.kind === "line" ? formatDate(r.line.storedDate) : "Month end"}</div>,
    },
    ...(showProperty
      ? [
          {
            key: "property",
            header: "Property",
            render: (r: ExcludedRow) => (r.kind === "line" ? r.line.propertyName : r.propertyName),
          } as Column<ExcludedRow>,
        ]
      : []),
    { key: "unit", header: "Unit", render: (r) => (r.kind === "line" ? r.line.unit : "") },
    {
      key: "account",
      header: "Account",
      render: (r) => (r.kind === "line" ? r.line.accountName : r.which === "fee" ? "Management fee" : "Owner draw"),
    },
    { key: "name", header: "Name", render: (r) => (r.kind === "line" ? r.line.name : "") },
    {
      key: "memo",
      header: "Memo",
      render: (r) =>
        r.kind === "line" ? (
          <div className="min-w-[10rem] max-w-[320px] whitespace-normal break-words">
            <span title={r.line.memo}>{r.line.memo}</span>
            {r.line.note ? <div className="mt-0.5 text-[11.5px] text-warning-ink">{r.line.note}</div> : null}
          </div>
        ) : (
          <span className="text-muted-foreground">Skipped this month</span>
        ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      className: "whitespace-nowrap tabular-nums",
      render: (r) => formatAmount(r.kind === "line" ? r.line.amountCents : r.amountCents),
    },
    {
      key: "source",
      header: "Source",
      render: (r) => <Pill>{r.kind === "line" ? r.line.sourceLabel : r.which === "fee" ? "Management fee" : "Owner draw"}</Pill>,
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (r) => (
        <Btn
          sm
          disabled={busyKey === r.key || (r.kind === "generated" && busyKey === `${r.which}:${r.propertyId}`)}
          onClick={() => (r.kind === "line" ? onInclude(r.line) : onIncludeGenerated(r.propertyId, r.which))}
        >
          {LEAVE_OFF.putBack}
        </Btn>
      ),
    },
  ];

  return (
    <div id={ANCHOR.leftOff} ref={cardRef} tabIndex={-1} className="outline-none">
      <Card>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 text-left text-[15px] font-semibold"
        >
          {LEAVE_OFF.cardTitle} ({rows.length})
          <ChevronDown aria-hidden className={cx("ml-auto h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Lines left off stay unbilled and come back on next month&apos;s draft. Lines dated before the owner&apos;s
          first statement month start here (rent payments received before it too); put one back only if it wasn&apos;t
          billed in Buildium. Other rent payments can&apos;t be left off: undo one on the Payments page instead.
        </p>
        {open ? (
          <div className="mt-3">
            <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} empty={LEAVE_OFF.empty} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
