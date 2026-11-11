"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { FilePlus2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { formatCurrency } from "@/convex/rosFormat";
import { Btn, Card, DataTable, Field, PageHeader, Pill, Select, type Column } from "@/components/ui";
import { FinanceNav, useNow } from "./finance-nav";
import { LinkBtn, Spinner } from "./form-bits";
import { GenerateDialog } from "./generate-dialog";
import { defaultStatementMonth, formatStamp, pickMonth, recentMonths } from "./months";

type ListData = FunctionReturnType<typeof api.ownerStatements.list>;
type OwnerRow = ListData["owners"][number];

type Row = {
  key: string;
  owner: OwnerRow;
  statement: OwnerRow["statements"][number] | null;
  /** The owner still has eligible properties not on any statement this month. */
  canGenerateMore: boolean;
};

function rowsOf(data: ListData): Row[] {
  const out: Row[] = [];
  for (const o of data.owners) {
    if (o.statements.length === 0) {
      out.push({ key: o.ownerId, owner: o, statement: null, canGenerateMore: o.active });
      continue;
    }
    const covered = o.statements.reduce((n, s) => n + s.propertyNames.length, 0);
    o.statements.forEach((s, i) =>
      out.push({
        key: s.statementId,
        owner: o,
        statement: s,
        canGenerateMore: o.active && i === o.statements.length - 1 && covered < o.eligiblePropertyCount,
      }),
    );
  }
  return out;
}

function PropertyNames({ names }: { names: string[] }) {
  if (names.length === 0) return <span className="text-faint">None</span>;
  const shown = names.slice(0, 2).join(", ");
  const more = names.length - 2;
  return (
    <span title={names.join(", ")} className="inline-block max-w-[260px] truncate align-middle">
      {shown}
      {more > 0 ? <span className="text-muted-foreground"> +{more}</span> : null}
    </span>
  );
}

export function StatusPill({ status }: { status: "draft" | "final" | "discarded" | null }) {
  if (status === "final") return <Pill tone="ok">Final</Pill>;
  if (status === "draft") return <Pill tone="warn">Draft</Pill>;
  if (status === "discarded") return <Pill tone="bad">Discarded</Pill>;
  return <Pill tone="neutral">Not started</Pill>;
}

/** `/owner-statements`: statements by month (spec 6.2). */
export function StatementsList() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const now = useNow();
  const months = recentMonths(now);
  const month = pickMonth(params.get("month"), months) ?? defaultStatementMonth(now);

  const data = useQuery(api.ownerStatements.list, { month });
  const [generate, setGenerate] = useState<{ ownerId: string } | null>(null);

  const setMonth = (m: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("month", m);
    router.replace(`${pathname}?${next.toString()}`);
  };

  const columns: Column<Row>[] = [
    {
      key: "owner",
      header: "Owner",
      render: (r) => (
        <span className="font-medium">
          {r.owner.legalName}
          {!r.owner.active ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(inactive)</span> : null}
        </span>
      ),
    },
    {
      key: "properties",
      header: "Properties",
      render: (r) =>
        r.statement ? (
          <PropertyNames names={r.statement.propertyNames} />
        ) : (
          <span className="text-muted-foreground">
            {r.owner.eligiblePropertyCount} eligible {r.owner.eligiblePropertyCount === 1 ? "property" : "properties"}
          </span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusPill status={r.statement ? r.statement.status : null} />,
    },
    {
      key: "ending",
      header: "Ending cash",
      align: "right",
      className: "tabular-nums",
      render: (r) =>
        r.statement?.status === "final" && r.statement.endingCashCents !== undefined
          ? formatCurrency(r.statement.endingCashCents)
          : "",
    },
    {
      key: "available",
      header: "Available for payment",
      align: "right",
      className: "tabular-nums",
      render: (r) =>
        r.statement?.status === "final" && r.statement.availableCents !== undefined
          ? formatCurrency(r.statement.availableCents)
          : "",
    },
    {
      key: "updated",
      header: "Updated",
      render: (r) => (r.statement ? <span className="text-muted-foreground">{formatStamp(r.statement.updatedAt)}</span> : ""),
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      render: (r) => (
        <div className="flex justify-end gap-2">
          {r.statement ? (
            <LinkBtn href={`/owner-statements/${r.statement.statementId}`} primary={r.statement.status === "draft"}>
              Open
            </LinkBtn>
          ) : null}
          {r.canGenerateMore ? (
            <Btn sm variant={r.statement ? "default" : "pri"} onClick={() => setGenerate({ ownerId: r.owner.ownerId })}>
              Generate
            </Btn>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="pb-10">
      <PageHeader
        title="Owner statements"
        subtitle="Monthly Rental Owner Statements, built from the ledger and closed work orders."
        actions={
          <Btn variant="pri" onClick={() => setGenerate({ ownerId: "" })}>
            <FilePlus2 aria-hidden className="h-4 w-4" /> Generate statement
          </Btn>
        }
      />
      <FinanceNav active="statements" />
      <Card>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="Month" htmlFor="ros-month" className="w-[220px]">
            <Select id="ros-month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)}>
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {data === undefined ? (
          <Spinner label="Loading statements…" />
        ) : (
          <DataTable
            caption={`Owner statements for ${month}`}
            columns={columns}
            rows={rowsOf(data)}
            rowKey={(r) => r.key}
            empty={
              <span>
                No owners yet. Add owners or import them first.{" "}
                <Link href="/owner-statements/owners" className="font-medium text-primary hover:underline">
                  Go to Owners
                </Link>
              </span>
            }
          />
        )}
      </Card>
      {generate ? (
        <GenerateDialog
          months={months}
          initialOwnerId={generate.ownerId}
          initialMonth={month}
          onClose={() => setGenerate(null)}
        />
      ) : null}
    </div>
  );
}
