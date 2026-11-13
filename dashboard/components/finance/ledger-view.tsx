"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { formatAmount, formatDate, formatMonth } from "@/convex/rosFormat";
import { SUBTRACTION_TYPES } from "@/convex/rosPolicy";
import {
  Btn,
  Card,
  DEFAULT_PAGE_SIZE,
  DataTable,
  FilterSelect,
  FilterToggle,
  FilterToolbar,
  PageHeader,
  Pagination,
  Pill,
  type Column,
} from "@/components/ui";
import { FinanceNav, useNow } from "./finance-nav";
import { Spinner } from "./form-bits";
import { DELETE_ENTRY, PAYMENTS_LINK, paymentsPageHref } from "./line-labels";
import { recentMonths } from "./months";
import { TransactionForm, VoidDialog, type EntryInit } from "./transaction-form";

type LedgerRow = FunctionReturnType<typeof api.ledger.list>["page"][number];

type Dialog = { kind: "add" } | { kind: "edit"; entry: EntryInit } | { kind: "void"; entryId: string; summary: string };

function entryOf(r: LedgerRow): EntryInit {
  return {
    entryId: r._id,
    propertyId: r.propertyId,
    unitId: r.unitId,
    date: r.date,
    accountId: r.accountId,
    accountName: r.accountName,
    counterparty: r.counterparty,
    memo: r.memo,
    amountCents: r.amountCents,
  };
}

const summaryOf = (r: { date: string; accountName: string; amountCents: number }) =>
  `${formatDate(r.date)} · ${r.accountName} · ${formatAmount(r.amountCents)}`;

/** `/owner-statements/ledger`: manual transactions and everything billed (spec 6.4). */
export function LedgerView() {
  const now = useNow();
  const months = recentMonths(now);
  const [ownerId, setOwnerId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [month, setMonth] = useState("");
  const [includeVoided, setIncludeVoided] = useState(false);
  // Cursor of each page visited (the last one is the page shown) and the row count of each page left behind.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [counts, setCounts] = useState<number[]>([]);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const owners = useQuery(api.owners.list, { includeInactive: true });
  const opts = useQuery(api.ledger.formOptions, {});
  const cursor = cursors[cursors.length - 1];
  const page = useQuery(api.ledger.list, {
    ownerId: ownerId || null,
    propertyId: propertyId || null,
    month: month || null,
    includeVoided,
    cursor,
    pageSize,
  });

  const resetPaging = () => {
    setCursors([null]);
    setCounts([]);
  };

  const columns: Column<LedgerRow>[] = [
    {
      key: "date",
      header: "Date",
      className: "whitespace-nowrap tabular-nums",
      // A billed row shows the date it has on its statement; a carried-forward one also its own date.
      render: (r) =>
        r.postedDate ? (
          <div>
            <div>{formatDate(r.postedDate)}</div>
            <div className="text-[11px] text-muted-foreground">Dated {formatDate(r.date)}</div>
          </div>
        ) : (
          formatDate(r.date)
        ),
    },
    { key: "property", header: "Property", render: (r) => r.propertyName },
    { key: "unit", header: "Unit", className: "whitespace-nowrap", render: (r) => r.unit },
    { key: "account", header: "Account", render: (r) => r.accountName },
    { key: "name", header: "Name", render: (r) => r.name },
    {
      key: "memo",
      header: "Memo",
      render: (r) => (
        <span className="line-clamp-2 max-w-[260px]" title={r.memo}>
          {r.memo}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      className: "whitespace-nowrap tabular-nums",
      // Subtractions get a leading minus in this table only; statements show positive amounts.
      render: (r) => (SUBTRACTION_TYPES.has(r.type) ? `−${formatAmount(r.amountCents)}` : formatAmount(r.amountCents)),
    },
    {
      key: "source",
      header: "Source",
      render: (r) => (
        <div className="flex flex-col items-start gap-1">
          <Pill tone={r.source === "rent_payment" ? "ok" : "neutral"}>{r.sourceLabel}</Pill>
          {r.source === "rent_payment" && r.rentForMonth ? (
            <Link
              href={paymentsPageHref({ rentForMonth: r.rentForMonth, propertyId: r.propertyId })}
              className="whitespace-nowrap text-[12px] font-medium text-primary hover:underline"
            >
              {`${formatMonth(r.rentForMonth)} rent →`}
            </Link>
          ) : null}
        </div>
      ),
    },
    {
      key: "statement",
      header: "Statement",
      render: (r) =>
        r.voided ? (
          <span title={r.voidReason ?? undefined}>
            <Pill tone="bad">Deleted</Pill>
          </span>
        ) : r.statementId ? (
          <Link href={`/owner-statements/${r.statementId}`} className="text-primary hover:underline">
            {r.statementLabel ?? "Statement"}
          </Link>
        ) : (
          <span className="text-muted-foreground">Unbilled</span>
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (r) =>
        r.editable ? (
          <div className="flex justify-end gap-1.5">
            {/* Rent Income rows entered by hand can still be deleted, but rent is changed on the Payments page. */}
            {r.onRentAccount ? null : (
              <Btn sm onClick={() => setDialog({ kind: "edit", entry: entryOf(r) })}>
                Edit
              </Btn>
            )}
            <Btn
              sm
              variant="dng"
              title={r.onRentAccount ? PAYMENTS_LINK.legacyRentTooltip : undefined}
              onClick={() => setDialog({ kind: "void", entryId: r._id, summary: summaryOf(r) })}
            >
              {DELETE_ENTRY.button}
            </Btn>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="pb-10">
      <PageHeader
        title="Ledger"
        subtitle="Every owner transaction: rows entered by hand, rent marked received on the Payments page, plus work orders, fees and draws once a statement is final."
        actions={
          <Btn variant="pri" onClick={() => setDialog({ kind: "add" })}>
            <Plus aria-hidden className="h-4 w-4" /> Add transaction
          </Btn>
        }
      />
      <FinanceNav active="ledger" />
      <Card>
        <FilterToolbar
          className="mb-3.5"
          active={ownerId !== "" || propertyId !== "" || month !== "" || includeVoided}
          onClear={() => {
            setOwnerId("");
            setPropertyId("");
            setMonth("");
            setIncludeVoided(false);
            resetPaging();
          }}
        >
          <FilterSelect
            label="Owner"
            active={ownerId !== ""}
            value={ownerId || "all"}
            onChange={(e) => {
              setOwnerId(!e.target.value || e.target.value === "all" ? "" : e.target.value);
              resetPaging();
            }}
            className="sm:w-56"
          >
            <option value="all">All</option>
            {(owners ?? []).map((o) => (
              <option key={o._id} value={o._id}>
                {o.legalName}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Property"
            active={propertyId !== ""}
            value={propertyId || "all"}
            onChange={(e) => {
              setPropertyId(!e.target.value || e.target.value === "all" ? "" : e.target.value);
              resetPaging();
            }}
            className="sm:w-56"
          >
            <option value="all">All</option>
            {(opts?.properties ?? []).map((p) => (
              <option key={p.propertyId} value={p.propertyId}>
                {p.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Month"
            active={month !== ""}
            value={month || "all"}
            onChange={(e) => {
              setMonth(!e.target.value || e.target.value === "all" ? "" : e.target.value);
              resetPaging();
            }}
            className="sm:w-52"
          >
            <option value="all">Any</option>
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </FilterSelect>
          <FilterToggle
            label="Show deleted"
            pressed={includeVoided}
            onChange={(v) => {
              setIncludeVoided(v);
              resetPaging();
            }}
          />
        </FilterToolbar>

        {page === undefined ? (
          <Spinner label="Loading transactions…" />
        ) : (
          <>
            <DataTable
                caption="Ledger transactions"
                columns={columns}
                rows={page.page}
                rowKey={(r) => r._id}
                // A row that can be edited opens Edit when clicked (its buttons keep their own action).
                rowClickable={(r) => r.editable && !r.onRentAccount}
                onRowClick={(r) => setDialog({ kind: "edit", entry: entryOf(r) })}
                empty={
                  ownerId || propertyId || month
                    ? "No transactions match these filters."
                    : "No transactions yet. Record rent on the Payments page; add landscaping and other rows with “Add transaction”."
                }
              />
            {/* Cursor paging (no total): Previous / Next only, same bar as every other list. */}
            <Pagination
              label="Ledger pages"
              page={cursors.length}
              pageSize={pageSize}
              rowsOnPage={page.page.length}
              rowsBefore={counts.reduce((a, b) => a + b, 0)}
              hasNext={!page.isDone}
              onPage={(p) => {
                if (p < cursors.length) {
                  setCursors((c) => c.slice(0, p));
                  setCounts((c) => c.slice(0, p - 1));
                } else if (p === cursors.length + 1 && !page.isDone) {
                  setCursors((c) => [...c, page.continueCursor]);
                  setCounts((c) => [...c, page.page.length]);
                }
              }}
              onPageSize={(n) => {
                setPageSize(n);
                resetPaging();
              }}
            />
          </>
        )}
      </Card>

      {dialog?.kind === "add" ? (
        <TransactionForm mode="add" defaultPropertyId={propertyId || undefined} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "edit" ? (
        <TransactionForm
          mode="edit"
          entry={dialog.entry}
          onClose={() => setDialog(null)}
          onVoid={() => setDialog({ kind: "void", entryId: dialog.entry.entryId, summary: summaryOf(dialog.entry) })}
        />
      ) : null}
      {dialog?.kind === "void" ? (
        <VoidDialog entryId={dialog.entryId} summary={dialog.summary} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}
