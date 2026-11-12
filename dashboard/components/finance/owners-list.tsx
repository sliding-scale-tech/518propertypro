"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { UserPlus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import {
  Card,
  DataTable,
  PageHeader,
  Pagination,
  Pill,
  SearchBox,
  SortHeader,
  Toggle,
  ariaSortOf,
  paginate,
  readSort,
  toggleSort,
  useUrlPaging,
  useUrlSearch,
  type Column,
} from "@/components/ui";
import { DefaultFeeButton, useDefaultFeeLine } from "./default-fee-dialog";
import { FinanceNav } from "./finance-nav";
import { LinkBtn, Spinner } from "./form-bits";
import { OWNER_SORT_DEFAULT, OWNER_SORT_KEYS, ownersView, type OwnerSortKey } from "./list-finders";
import { NeedsOwnerCard } from "./needs-owner";
import { normalizeSearch } from "./payments-search";

type OwnerRow = FunctionReturnType<typeof api.owners.list>[number];

/** "adam@example.com" -> "a***@example.com" (the list never shows full addresses, spec 6.5). */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** `/owner-statements/owners`: the rental owners (spec 6.5). */
export function OwnersList() {
  const router = useRouter();
  const [showInactive, setShowInactive] = useState(false);
  const owners = useQuery(api.owners.list, { includeInactive: showInactive });
  const feeLine = useDefaultFeeLine();
  const pathname = usePathname();
  const params = useSearchParams();
  const [problemsOnly, setProblemsOnly] = useState(false);
  const search = useUrlSearch();
  const q = normalizeSearch(search.q);
  const sort = readSort(params.get("sort"), params.get("dir"), OWNER_SORT_KEYS, OWNER_SORT_DEFAULT);
  const onSort = (key: OwnerSortKey) => {
    const next = toggleSort(sort, key);
    const isDefault = next.key === OWNER_SORT_DEFAULT.key && next.dir === OWNER_SORT_DEFAULT.dir;
    const u = new URLSearchParams(params.toString());
    if (isDefault) {
      u.delete("sort");
      u.delete("dir");
    } else {
      u.set("sort", next.key);
      u.set("dir", next.dir);
    }
    u.delete("page");
    const qs = u.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };
  const sortable = (key: OwnerSortKey, label: string, align: "left" | "right" = "left") => ({
    header: <SortHeader label={label} sortKey={key} sort={sort} onSort={onSort} align={align} />,
    sort: ariaSortOf(sort, key),
  });
  const visible = ownersView(owners ?? [], { q, problemsOnly, sort });
  const paging = useUrlPaging();
  const paged = paginate(visible, paging.page, paging.pageSize);

  const columns: Column<OwnerRow>[] = [
    {
      key: "name",
      ...sortable("name", "Legal name"),
      render: (o) => (
        <span className="font-medium">
          {o.legalName}
          {!o.active ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(inactive)</span> : null}
        </span>
      ),
    },
    { key: "contact", ...sortable("contact", "Contact"), render: (o) => o.contactName || <span className="text-faint">Not set</span> },
    {
      key: "emails",
      header: "Emails",
      render: (o) =>
        o.emails.length === 0 ? (
          <span className="text-faint">None</span>
        ) : (
          <span className="text-muted-foreground">{o.emails.map(maskEmail).join(", ")}</span>
        ),
    },
    {
      key: "fee",
      header: "Fee %",
      align: "right",
      className: "tabular-nums whitespace-nowrap",
      // The range of the owner's property fees (each property: its own fee, else the default).
      render: (o) => o.feeRange ?? <span className="text-faint">No properties</span>,
    },
    { key: "props", ...sortable("properties", "Properties", "right"), align: "right", className: "tabular-nums", render: (o) => o.propertyCount },
    {
      key: "problems",
      ...sortable("problems", "Problems"),
      render: (o) =>
        o.problems.length === 0 && o.coOwnedPropertyNames.length === 0 ? (
          <span className="text-faint">None</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {o.problems.map((p) => (
              <Pill key={p} tone="bad">
                {p}
              </Pill>
            ))}
            {o.coOwnedPropertyNames.length > 0 ? (
              <Pill tone="warn" title={o.coOwnedPropertyNames.join(", ")}>
                {o.coOwnedPropertyNames.length} co-owned
              </Pill>
            ) : null}
          </div>
        ),
    },
  ];

  return (
    <div className="pb-10">
      <PageHeader
        title="Owners"
        subtitle={`Rental owners, their owner draw payee and linked properties.${feeLine ? ` ${feeLine}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <DefaultFeeButton />
            <LinkBtn href="/owner-statements/owners/new" primary className="!rounded-xl !px-3.5 !py-2 !text-[13.5px]">
              <UserPlus aria-hidden className="h-4 w-4" /> Add owner
            </LinkBtn>
          </div>
        }
      />
      <FinanceNav active="owners" />
      <NeedsOwnerCard />
      <Card>
        <div className="mb-3">
          <SearchBox
            id="owners-search"
            label="Search owners"
            value={search.input}
            onChange={search.setInput}
            onClear={search.clear}
            placeholder="Search owner, contact, email or property"
          />
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2">
            <Toggle
              checked={showInactive}
              label="Show inactive owners"
              onChange={(v) => {
                setShowInactive(v);
                paging.resetPage();
              }}
            />
            <span className="text-[13px]">Show inactive owners</span>
          </div>
          <div className="flex items-center gap-2">
            <Toggle
              checked={problemsOnly}
              label="Only owners with problems"
              onChange={(v) => {
                setProblemsOnly(v);
                paging.resetPage();
              }}
            />
            <span className="text-[13px]">Only owners with problems</span>
          </div>
        </div>
        {owners === undefined ? (
          <Spinner label="Loading owners…" />
        ) : (
          <>
            <DataTable
              caption="Owners"
              columns={columns}
              rows={paged.rows}
              rowKey={(o) => o._id}
              onRowClick={(o) => router.push(`/owner-statements/owners/${o._id}`)}
              empty={
                q ? (
                  <span>
                    No owners match &ldquo;{search.q.trim()}&rdquo;.{" "}
                    <button type="button" onClick={search.clear} className="font-medium text-primary hover:underline">
                      Clear search
                    </button>
                  </span>
                ) : problemsOnly ? (
                  "No owners with problems."
                ) : (
                  "No owners yet. Add one with “Add owner”, or import the owner list."
                )
              }
            />
            <Pagination
              label="Owners pages"
              page={paged.page}
              pageSize={paged.pageSize}
              total={paged.total}
              onPage={paging.setPage}
              onPageSize={paging.setPageSize}
            />
          </>
        )}
      </Card>
    </div>
  );
}
