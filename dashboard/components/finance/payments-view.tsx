"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { CheckCheck, Lock } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { MAX_BULK_MARK, TEAM_LABELS, type Team } from "@/convex/rentPaymentsPolicy";
import { formatCurrency, formatDate, formatMonth, nextMonth } from "@/convex/rosFormat";
import { Btn, Card, Chips, DataTable, Field, Kpi, KpiRow, PageHeader, Pill, Select, cx, type Column } from "@/components/ui";
import { FinanceNav, useNow } from "./finance-nav";
import { Checkbox, LinkBtn, Spinner } from "./form-bits";
import { currentMonth, pickMonth, recentMonths } from "./months";
import {
  BulkMarkDialog,
  EditPaymentDialog,
  MarkDialog,
  UndoPaymentDialog,
  type PaymentInit,
  type PaymentUnit,
} from "./payment-dialogs";

type ListData = FunctionReturnType<typeof api.rentPayments.list>;
type Row = ListData["rows"][number];
type StatusFilter = "" | "unpaid" | "paid" | "not_markable";

type Dialog =
  | { kind: "mark"; unit: PaymentUnit }
  | { kind: "bulk"; units: PaymentUnit[] }
  | { kind: "edit"; payment: PaymentInit }
  | { kind: "undo"; payment: PaymentInit };

const TEAMS = Object.keys(TEAM_LABELS) as Team[];
const STATUS_OPTIONS: StatusFilter[] = ["", "unpaid", "paid", "not_markable"];

function unitOf(r: Row): PaymentUnit {
  return { unitId: r.unitId, unit: r.unit, propertyName: r.propertyName, tenants: r.tenants, rentCents: r.rentCents };
}

function paymentOf(r: Row): PaymentInit | null {
  const p = r.payment;
  if (!p || p.kind !== "payment") return null;
  return {
    ...unitOf(r),
    entryId: p.entryId,
    amountCents: p.amountCents,
    receivedDate: p.receivedDate,
    method: p.method,
    note: p.note,
  };
}

function StatusCell({ r }: { r: Row }) {
  if (r.status === "paid") {
    return (
      <div className="flex flex-col items-start gap-0.5">
        <Pill tone="ok" dot>
          Paid
        </Pill>
        {r.payment?.kind === "ledger" ? <span className="text-[11.5px] text-muted-foreground">Entered in the ledger</span> : null}
      </div>
    );
  }
  if (r.status === "unpaid") {
    return (
      <Pill tone="warn" dot>
        Unpaid
      </Pill>
    );
  }
  return (
    <div className="flex flex-col items-start gap-0.5">
      <Pill tone="neutral">Not markable</Pill>
      {r.reason ? <span className="text-[11.5px] text-muted-foreground">{r.reason}</span> : null}
    </div>
  );
}

/** `/owner-statements/payments`: mark rent received per unit per rent month (spec 6.8). */
export function PaymentsView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const now = useNow();
  const thisMonth = currentMonth(now);
  // Next month too: rent paid early can be marked ahead.
  const months = useMemo(
    () => [{ value: nextMonth(thisMonth), label: formatMonth(nextMonth(thisMonth)) }, ...recentMonths(now)],
    [now, thisMonth],
  );
  const month = pickMonth(params.get("month"), months) ?? thisMonth;
  const rawTeam = params.get("team") ?? "";
  const team = (TEAMS as string[]).includes(rawTeam) ? rawTeam : "";
  const ownerId = params.get("owner") ?? "";
  const propertyId = params.get("property") ?? "";
  const rawStatus = params.get("status") ?? "";
  const status: StatusFilter = (STATUS_OPTIONS as string[]).includes(rawStatus) ? (rawStatus as StatusFilter) : "";

  const data = useQuery(api.rentPayments.list, {
    month,
    category: team || null,
    ownerId: ownerId || null,
    propertyId: propertyId || null,
    status: status || null,
  });

  // Selection is per view: it starts empty whenever the month or a filter changes.
  const viewKey = `${month}|${team}|${ownerId}|${propertyId}|${status}`;
  const [selection, setSelection] = useState<{ key: string; ids: Set<string> }>({ key: viewKey, ids: new Set() });
  const selected = selection.key === viewKey ? selection.ids : new Set<string>();
  const setSelected = (ids: Set<string>) => setSelection({ key: viewKey, ids });
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // A property filter from another team would hide everything.
    if (key === "team") next.delete("property");
    router.replace(`${pathname}?${next.toString()}`);
  };

  const rows = data?.rows ?? [];
  const markable = rows.filter((r) => r.canMark);
  const selectedRows = markable.filter((r) => selected.has(r.unitId));
  const allOn = markable.length > 0 && markable.slice(0, MAX_BULK_MARK).every((r) => selected.has(r.unitId));

  const toggle = (unitId: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(unitId);
    else next.delete(unitId);
    setSelected(next);
  };

  const columns: Column<Row>[] = [
    {
      key: "select",
      header: (
        <label className="inline-flex items-center">
          <span className="sr-only">Select every unpaid unit shown</span>
          <Checkbox
            checked={allOn}
            disabled={markable.length === 0}
            onChange={(on) => setSelected(on ? new Set(markable.slice(0, MAX_BULK_MARK).map((r) => r.unitId)) : new Set())}
          />
        </label>
      ),
      render: (r) =>
        r.canMark ? (
          <label className="inline-flex items-center">
            <span className="sr-only">{`Select Unit ${r.unit} at ${r.propertyName}`}</span>
            <Checkbox
              checked={selected.has(r.unitId)}
              disabled={!selected.has(r.unitId) && selected.size >= MAX_BULK_MARK}
              onChange={(on) => toggle(r.unitId, on)}
            />
          </label>
        ) : null,
    },
    {
      key: "property",
      header: "Property",
      render: (r) => (
        <div className={cx("min-w-[9rem]", r.status === "not_markable" && "opacity-55")}>
          <div className="font-medium">{r.propertyName}</div>
          <div className="text-[11.5px] text-muted-foreground">{r.teamLabel}</div>
        </div>
      ),
    },
    {
      key: "unit",
      header: "Unit",
      className: "whitespace-nowrap",
      render: (r) => <span className={cx(r.status === "not_markable" && "opacity-55")}>{r.unit}</span>,
    },
    {
      key: "tenant",
      header: "Tenant",
      render: (r) => (
        <span className={cx("block max-w-[200px] whitespace-normal", r.status === "not_markable" && "opacity-55")}>
          {r.payment?.counterparty || (r.tenants.length > 0 ? r.tenants.join(" & ") : <span className="text-faint">—</span>)}
        </span>
      ),
    },
    {
      key: "owner",
      header: "Owner",
      render: (r) => (
        <span className={cx("block max-w-[180px] whitespace-normal", r.status === "not_markable" && "opacity-55")}>
          {r.ownerName ?? <span className="text-faint">No owner</span>}
        </span>
      ),
    },
    {
      key: "rent",
      header: "Rent",
      align: "right",
      className: "whitespace-nowrap tabular-nums",
      render: (r) => (
        <span className={cx(r.status === "not_markable" && "opacity-55")}>
          {r.payment ? formatCurrency(r.payment.amountCents) : r.rentCents !== null ? formatCurrency(r.rentCents) : "—"}
        </span>
      ),
    },
    { key: "status", header: "Status", render: (r) => <StatusCell r={r} /> },
    {
      key: "received",
      header: "Received",
      render: (r) =>
        r.payment ? (
          <div className="min-w-[7rem]">
            <div className="tabular-nums">{formatDate(r.payment.receivedDate)}</div>
            {r.payment.methodLabel || r.payment.note ? (
              <div className="max-w-[180px] whitespace-normal text-[11.5px] text-muted-foreground">
                {[r.payment.methodLabel, r.payment.note].filter(Boolean).join(" · ")}
              </div>
            ) : null}
          </div>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (r) => <RowActions r={r} onDialog={setDialog} />,
    },
  ];

  return (
    <div className="pb-10">
      <PageHeader
        title="Payments"
        subtitle="Mark rent received for each unit and month. A payment goes on the owner statement for the month it was received (cash basis), always for the full roster rent."
      />
      <FinanceNav active="payments" />

      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Rent month" htmlFor="pay-month">
            <Select id="pay-month" value={month} onChange={(e) => setParam("month", e.target.value || "")}>
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Team" htmlFor="pay-team">
            <Select id="pay-team" value={team} onChange={(e) => setParam("team", e.target.value || "")}>
              <option value="">All teams</option>
              {TEAMS.map((t) => (
                <option key={t} value={t}>
                  {TEAM_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Owner" htmlFor="pay-owner">
            <Select id="pay-owner" value={ownerId} onChange={(e) => setParam("owner", e.target.value || "")}>
              <option value="">All owners</option>
              {(data?.filters.owners ?? []).map((o) => (
                <option key={o.ownerId} value={o.ownerId}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Property" htmlFor="pay-property">
            <Select id="pay-property" value={propertyId} onChange={(e) => setParam("property", e.target.value || "")}>
              <option value="">All properties</option>
              {(data?.filters.properties ?? [])
                .filter((p) => !team || p.category === team)
                .map((p) => (
                  <option key={p.propertyId} value={p.propertyId} data-sublabel={p.teamLabel}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>

        {data === undefined ? (
          <Spinner label="Loading rent payments…" />
        ) : (
          <>
            <KpiRow>
              <Kpi label="Paid" value={data.summary.paid} sub={`${formatCurrency(data.summary.receivedCents)} received`} />
              <Kpi
                label="Unpaid"
                value={data.summary.unpaid}
                sub={`${formatCurrency(data.summary.unpaidCents)} expected`}
                subTone={data.summary.unpaid > 0 ? "down" : "muted"}
              />
              <Kpi label="Not markable" value={data.summary.notMarkable} sub="Owner collects, vacant or no rent" />
              <Kpi label={`Received for ${data.monthLabel}`} value={formatCurrency(data.summary.receivedCents)} />
            </KpiRow>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Chips<StatusFilter>
                label="Status"
                value={status}
                onChange={(v) => setParam("status", v)}
                options={[
                  { value: "", label: `All (${data.summary.total})` },
                  { value: "unpaid", label: `Unpaid (${data.summary.unpaid})` },
                  { value: "paid", label: `Paid (${data.summary.paid})` },
                  { value: "not_markable", label: `Not markable (${data.summary.notMarkable})` },
                ]}
              />
              <div className="ml-auto flex items-center gap-2">
                {selectedRows.length > 0 ? (
                  <Btn sm onClick={() => setSelected(new Set())}>
                    Clear selection
                  </Btn>
                ) : null}
                <Btn
                  sm
                  variant="pri"
                  disabled={selectedRows.length === 0}
                  title={selectedRows.length === 0 ? "Tick the unpaid units to mark first." : undefined}
                  onClick={() => setDialog({ kind: "bulk", units: selectedRows.map(unitOf) })}
                >
                  <CheckCheck aria-hidden className="h-3.5 w-3.5" /> Mark selected received
                  {selectedRows.length > 0 ? ` (${selectedRows.length})` : ""}
                </Btn>
              </div>
            </div>
            {selected.size >= MAX_BULK_MARK ? (
              <p className="mt-2 text-[12px] text-muted-foreground">
                At most {MAX_BULK_MARK} units can be marked at a time. Mark these, then select the rest.
              </p>
            ) : null}
            {data.truncated ? (
              <p className="mt-2 rounded-xl border border-warning-ink/30 bg-warning-soft px-3 py-2 text-[12.5px] text-warning-ink">
                This team has more units than the page can show at once. Filter by team or property to see them all.
              </p>
            ) : null}

            <div className="mt-3">
              <DataTable
                caption={`Rent payments for ${data.monthLabel}`}
                columns={columns}
                rows={rows}
                rowKey={(r) => r.unitId}
                empty={
                  team || ownerId || propertyId || status
                    ? "No units match these filters."
                    : "No units yet. Units come from the property rosters."
                }
              />
            </div>
          </>
        )}
      </Card>

      {data && dialog?.kind === "mark" ? (
        <MarkDialog
          unit={dialog.unit}
          month={data.month}
          today={data.today}
          earliest={data.earliestReceivedDate}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {data && dialog?.kind === "bulk" ? (
        <BulkMarkDialog
          units={dialog.units}
          month={data.month}
          today={data.today}
          earliest={data.earliestReceivedDate}
          onClose={() => setDialog(null)}
          onDone={() => setSelected(new Set())}
        />
      ) : null}
      {data && dialog?.kind === "edit" ? (
        <EditPaymentDialog
          payment={dialog.payment}
          month={data.month}
          today={data.today}
          earliest={data.earliestReceivedDate}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {data && dialog?.kind === "undo" ? (
        <UndoPaymentDialog payment={dialog.payment} month={data.month} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

function RowActions({ r, onDialog }: { r: Row; onDialog: (d: Dialog) => void }) {
  if (r.status === "unpaid") {
    if (!r.canMark) {
      return (
        <div className="flex max-w-[240px] flex-col items-end gap-1 text-right">
          <span className="whitespace-normal text-[11.5px] text-danger-ink">{r.ownerProblem}</span>
          <LinkBtn href="/owner-statements/owners">Owners page</LinkBtn>
        </div>
      );
    }
    return (
      <Btn sm variant="pri" onClick={() => onDialog({ kind: "mark", unit: unitOf(r) })}>
        Mark received
      </Btn>
    );
  }
  if (r.status !== "paid" || !r.payment) return null;
  if (r.payment.kind === "ledger") {
    return (
      <div className="flex max-w-[220px] flex-col items-end gap-1 text-right">
        <span className="whitespace-normal text-[11.5px] text-muted-foreground">{r.payment.lockedReason}</span>
        <LinkBtn href="/owner-statements/ledger">Ledger</LinkBtn>
      </div>
    );
  }
  if (r.payment.locked) {
    return (
      <div className="flex max-w-[220px] flex-col items-end gap-1 text-right">
        <Pill tone="neutral" title={r.payment.lockedReason ?? undefined}>
          <Lock aria-hidden className="h-3 w-3" /> Locked
        </Pill>
        {r.payment.lockedReason ? (
          <span className="whitespace-normal text-[11.5px] text-muted-foreground">{r.payment.lockedReason}</span>
        ) : null}
        {r.payment.statementId ? (
          <Link href={`/owner-statements/${r.payment.statementId}`} className="text-[12px] font-medium text-primary hover:underline">
            Open statement
          </Link>
        ) : null}
      </div>
    );
  }
  const payment = paymentOf(r);
  if (!payment) return null;
  return (
    <div className="flex justify-end gap-1.5">
      <Btn sm onClick={() => onDialog({ kind: "edit", payment })}>
        Edit
      </Btn>
      <Btn sm variant="dng" onClick={() => onDialog({ kind: "undo", payment })}>
        Undo
      </Btn>
    </div>
  );
}
