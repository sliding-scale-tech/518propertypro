"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { FilePlus2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { formatCurrency } from "@/convex/rosFormat";
import { TEAM_LABELS, type Team } from "@/convex/rentPaymentsPolicy";
import {
  Btn,
  Card,
  FilterSelect,
  FilterToolbar,
  DataTable,
  PageHeader,
  Pagination,
  Pill,
  SearchBox,
  SortHeader,
  ariaSortOf,
  paginate,
  readSort,
  toggleSort,
  useUrlPaging,
  useUrlSearch,
  type Column,
} from "@/components/ui";
import { FinanceNav, useNow } from "./finance-nav";
import { LinkBtn, Spinner } from "./form-bits";
import { GenerateDialog } from "./generate-dialog";
import {
  STATEMENT_SORT_DEFAULT,
  STATEMENT_SORT_KEYS,
  STATEMENT_STATUS_KEYS,
  statementsView,
  type StatementSortKey,
  type StatementStatusKey,
} from "./list-finders";
import { defaultStatementMonth, formatStamp, pickMonth, recentMonths } from "./months";
import { normalizeSearch } from "./payments-search";

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

const TEAMS = Object.keys(TEAM_LABELS) as Team[];
type StatusFilter = StatementStatusKey | "";

/** `/owner-statements`: statements by month (spec 6.2), with search, filters, sorting and pages. */
export function StatementsList() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const now = useNow();
  const months = recentMonths(now);
  const month = pickMonth(params.get("month"), months) ?? defaultStatementMonth(now);
  const rawTeam = params.get("team") ?? "";
  const team = (TEAMS as string[]).includes(rawTeam) ? rawTeam : "";
  const rawStatus = params.get("status") ?? "";
  const status: StatusFilter = (STATEMENT_STATUS_KEYS as readonly string[]).includes(rawStatus) ? (rawStatus as StatementStatusKey) : "";
  const sort = readSort(params.get("sort"), params.get("dir"), STATEMENT_SORT_KEYS, STATEMENT_SORT_DEFAULT);

  const data = useQuery(api.ownerStatements.list, { month });
  const [generate, setGenerate] = useState<{ ownerId: string } | null>(null);

  /** Set URL params ("" removes one; the default sort is left out); any change goes back to page 1. */
  const setParams = (updates: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };
  const onSort = (key: StatementSortKey) => {
    const next = toggleSort(sort, key);
    const isDefault = next.key === STATEMENT_SORT_DEFAULT.key && next.dir === STATEMENT_SORT_DEFAULT.dir;
    setParams({ sort: isDefault ? "" : next.key, dir: isDefault ? "" : next.dir });
  };

  const search = useUrlSearch();
  const q = normalizeSearch(search.q);
  const view = statementsView(data ? rowsOf(data) : [], { q, team, status, sort });
  const paging = useUrlPaging();
  const paged = paginate(view.visible, paging.page, paging.pageSize);

  const sortable = (key: StatementSortKey, label: string, align: "left" | "right" = "left") => ({
    header: <SortHeader label={label} sortKey={key} sort={sort} onSort={onSort} align={align} />,
    sort: ariaSortOf(sort, key),
  });

  const columns: Column<Row>[] = [
    {
      key: "owner",
      ...sortable("owner", "Owner"),
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
      ...sortable("status", "Status"),
      render: (r) => <StatusPill status={r.statement ? r.statement.status : null} />,
    },
    {
      key: "ending",
      ...sortable("ending", "Ending cash", "right"),
      align: "right",
      className: "tabular-nums",
      render: (r) =>
        r.statement?.status === "final" && r.statement.endingCashCents !== undefined
          ? formatCurrency(r.statement.endingCashCents)
          : "",
    },
    {
      key: "available",
      ...sortable("available", "Available for payment", "right"),
      align: "right",
      className: "tabular-nums",
      render: (r) =>
        r.statement?.status === "final" && r.statement.availableCents !== undefined
          ? formatCurrency(r.statement.availableCents)
          : "",
    },
    {
      key: "updated",
      ...sortable("updated", "Updated"),
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

  const filtered = Boolean(q || team || status);
  const defaultMonth = defaultStatementMonth(now);

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
        <FilterToolbar
          className="mb-3.5"
          active={filtered || month !== defaultMonth}
          onClear={() => {
            search.setInput("");
            setParams({ month: "", team: "", status: "", q: "" });
          }}
          search={
            <SearchBox
              id="ros-search"
              label="Search statements"
              value={search.input}
              onChange={search.setInput}
              onClear={search.clear}
              placeholder="Search owner, owner email, property or address"
            />
          }
        >
          <FilterSelect
            label="Month"
            active={month !== defaultMonth}
            value={month}
            onChange={(e) => e.target.value && setParams({ month: e.target.value === defaultMonth ? "" : e.target.value })}
            className="sm:w-52"
          >
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Team"
            active={team !== ""}
            value={team || "all"}
            onChange={(e) => setParams({ team: !e.target.value || e.target.value === "all" ? "" : e.target.value })}
          >
            <option value="all">All</option>
            {TEAMS.map((t) => (
              <option key={t} value={t}>
                {TEAM_LABELS[t]}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Status"
            active={status !== ""}
            value={status || "all"}
            onChange={(e) => setParams({ status: !e.target.value || e.target.value === "all" ? "" : e.target.value })}
            className="sm:w-56"
          >
            <option value="all">All ({view.counts.all})</option>
            <option value="not_started">Not started ({view.counts.not_started})</option>
            <option value="draft">Draft ({view.counts.draft})</option>
            <option value="final">Final ({view.counts.final})</option>
          </FilterSelect>
        </FilterToolbar>
        {data === undefined ? (
          <Spinner label="Loading statements…" />
        ) : (
          <>
            <div>
              <DataTable
                caption={`Owner statements for ${month}`}
                columns={columns}
                rows={paged.rows}
                rowKey={(r) => r.key}
                // A row with a statement opens it (its Open / Generate buttons keep their own action).
                rowClickable={(r) => r.statement !== null}
                onRowClick={(r) => {
                  if (r.statement) router.push(`/owner-statements/${r.statement.statementId}`);
                }}
                empty={
                  q ? (
                    <span>
                      No statements match &ldquo;{search.q.trim()}&rdquo;.{" "}
                      <button type="button" onClick={search.clear} className="font-medium text-primary hover:underline">
                        Clear search
                      </button>
                    </span>
                  ) : filtered ? (
                    "No statements match these filters."
                  ) : (
                    <span>
                      No owners yet. Add owners or import them first.{" "}
                      <Link href="/owner-statements/owners" className="font-medium text-primary hover:underline">
                        Go to Owners
                      </Link>
                    </span>
                  )
                }
              />
              <Pagination
                label="Owner statements pages"
                page={paged.page}
                pageSize={paged.pageSize}
                total={paged.total}
                onPage={paging.setPage}
                onPageSize={paging.setPageSize}
              />
            </div>
          </>
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
