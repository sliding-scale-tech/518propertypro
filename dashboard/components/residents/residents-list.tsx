"use client";

import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ResidentModal } from "@/components/residents/resident-modal";
import { useKept, useTenantUrl } from "@/components/residents/use-tenant-url";
import { readChoice } from "@/components/residents/tenant-list-params";
import { useResidentActions } from "@/components/residents/use-resident-actions";
import { errorMessage, useToast } from "@/components/toast";
import {
  Btn,
  Card,
  CardHead,
  DataTable,
  Pagination,
  Pill,
  SearchBox,
  Select,
  SortHeader,
  ariaSortOf,
  readSort,
  toggleSort,
  useUrlPaging,
  useUrlSearch,
  type Column,
} from "@/components/ui";

const SORT_KEYS = ["name", "unit", "lease", "status"] as const;
type SortKey = (typeof SORT_KEYS)[number];
const SORT_DEFAULT = { key: "name", dir: "asc" } as const;
const STATUSES = ["active", "inactive", "all"] as const;
const TEAMS = ["gold", "silver", "make_up"] as const;
const TEAM_LABEL: Record<(typeof TEAMS)[number], string> = { gold: "Gold", silver: "Silver", make_up: "Make Up" };

/** Tenant directory used to recognise callers. Embedded in the Tenants page (Residents tab). */
export function ResidentsList() {
  const toast = useToast();
  const router = useRouter();
  const access = useQuery(api.team.myAccess);
  const isAdmin = access?.view === "admin";
  const properties = useQuery(api.properties.list);
  const create = useMutation(api.residents.create);
  const actions = useResidentActions();

  const url = useTenantUrl();
  const search = useUrlSearch();
  const paging = useUrlPaging();
  const status = readChoice(url.params.get("status"), STATUSES, "active");
  const team = readChoice(url.params.get("team"), [...TEAMS, "all"] as const, "all");
  const sort = readSort(url.params.get("sort"), url.params.get("dir"), SORT_KEYS, SORT_DEFAULT);
  // The property filter is only sent once it is known to be one of the viewer's properties.
  const propertyParam = url.params.get("property") ?? "";
  const propertyKnown = properties?.some((p) => p._id === propertyParam) ?? false;
  const propertyId = propertyKnown ? (propertyParam as Id<"properties">) : undefined;

  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const result = useQuery(
    api.residents.listPage,
    propertyParam && properties === undefined
      ? "skip"
      : {
          propertyId,
          search: search.q.trim() || undefined,
          status,
          team: team === "all" ? undefined : team,
          sortKey: sort.key,
          sortDir: sort.dir,
          page: paging.page,
          pageSize: paging.pageSize,
        },
  );
  const { value: data, stale } = useKept(result);

  type Row = NonNullable<typeof data>["rows"][number];
  // The server may omit contact details for some viewers: hide the column when nothing came back.
  const showPhones = data?.showPhones ?? false;
  const showEmail = data?.showEmail ?? false;

  const onSort = (key: SortKey) => {
    const next = toggleSort(sort, key);
    const isDefault = next.key === SORT_DEFAULT.key && next.dir === SORT_DEFAULT.dir;
    url.set({ sort: isDefault ? null : next.key, dir: isDefault ? null : next.dir });
  };
  const sortable = (key: SortKey, label: string) => ({
    header: <SortHeader label={label} sortKey={key} sort={sort} onSort={onSort} />,
    sort: ariaSortOf(sort, key),
  });

  const columns: Column<Row>[] = [
    {
      key: "name",
      ...sortable("name", "Name"),
      render: (r) => (
        <Link href={`/residents/${r._id}`} className="font-semibold hover:text-primary hover:underline">
          {r.fullName}
        </Link>
      ),
    },
    { key: "unit", ...sortable("unit", "Property / unit"), render: (r) => `${r.propertyName} · ${r.unitNumber}` },
  ];
  if (showPhones) {
    columns.push({ key: "phones", header: "Phones", className: "tabular-nums", render: (r) => r.phones?.join(", ") || "—" });
  }
  if (showEmail) columns.push({ key: "email", header: "Email", render: (r) => r.email ?? "—" });
  columns.push(
    { key: "lease", ...sortable("lease", "Lease end"), className: "tabular-nums", render: (r) => r.leaseEnd ?? "—" },
    {
      key: "status",
      ...sortable("status", "Status"),
      render: (r) => <Pill tone={r.active ? "ok" : "neutral"}>{r.active ? "Active" : "Inactive"}</Pill>,
    },
  );
  if (isAdmin) {
    columns.push({
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      render: (r) => (
        <div className="flex justify-end gap-2">
          <Btn sm onClick={() => actions.edit(r)}>
            Edit
          </Btn>
          {r.active ? (
            <Btn sm variant="dng" onClick={() => actions.deactivate(r)}>
              Deactivate
            </Btn>
          ) : null}
        </div>
      ),
    });
  }

  const filtered = search.q.trim() !== "" || propertyId !== undefined || team !== "all" || status !== "active";
  const clearAll = () => {
    search.setInput("");
    url.set({ q: null, property: null, team: null, status: null });
  };

  return (
    <Card>
      <CardHead
        title="Residents"
        hint="Tenant directory used to recognise callers."
        right={
          isAdmin ? (
            <Btn variant="pri" sm onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add resident
            </Btn>
          ) : undefined
        }
      />
      <div className="mb-3.5 flex flex-col gap-3">
        <SearchBox
          id="residents-search"
          label="Search residents"
          value={search.input}
          onChange={search.setInput}
          onClear={search.clear}
          placeholder="Search name, unit, property, phone or email"
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Select
            value={propertyId ?? "all"}
            onChange={(e) => url.set({ property: e.target.value === "all" ? null : e.target.value })}
            aria-label="Filter by property"
            className="sm:w-56"
          >
            <option value="all">All properties</option>
            {(properties ?? []).map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select
            value={team}
            onChange={(e) => url.set({ team: e.target.value === "all" ? null : e.target.value })}
            aria-label="Filter by team"
            className="sm:w-40"
          >
            <option value="all">All teams</option>
            {TEAMS.map((t) => (
              <option key={t} value={t}>
                {TEAM_LABEL[t]}
              </option>
            ))}
          </Select>
          <Select
            value={status}
            onChange={(e) => url.set({ status: e.target.value === "active" ? null : e.target.value })}
            aria-label="Filter by status"
            className="sm:w-44"
          >
            <option value="active">Active</option>
            <option value="inactive">Moved out / inactive</option>
            <option value="all">All residents</option>
          </Select>
        </div>
      </div>

      {data === undefined ? (
        <p className="text-sm text-muted-foreground">Loading residents…</p>
      ) : (
        <div className={stale ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={stale}>
          <DataTable
            caption="Residents"
            columns={columns}
            rows={data.rows}
            rowKey={(r) => r._id}
            onRowClick={(r) => router.push(`/residents/${r._id}`)}
            empty={
              search.q.trim() !== "" ? (
                <span>
                  No residents match &ldquo;{search.q.trim()}&rdquo;.{" "}
                  <button type="button" onClick={clearAll} className="font-medium text-primary hover:underline">
                    Clear search and filters
                  </button>
                </span>
              ) : filtered ? (
                <span>
                  No residents match these filters.{" "}
                  <button type="button" onClick={clearAll} className="font-medium text-primary hover:underline">
                    Clear filters
                  </button>
                </span>
              ) : (
                "No residents found."
              )
            }
          />
          <Pagination
            label="Residents pages"
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPage={paging.setPage}
            onPageSize={paging.setPageSize}
          />
        </div>
      )}

      {isAdmin ? actions.dialogs : null}

      {adding ? (
        <ResidentModal
          title="Add resident"
          unitOptions={actions.unitOptions}
          busy={busy}
          initial={{ unitId: "", fullName: "", phones: [], email: "", leaseEnd: "" }}
          onClose={() => setAdding(false)}
          onSubmit={async (v) => {
            setBusy(true);
            try {
              await create({
                unitId: v.unitId as Id<"units">,
                fullName: v.fullName,
                phones: v.phones,
                email: v.email || undefined,
                leaseEnd: v.leaseEnd || undefined,
              });
              toast("Resident added");
              setAdding(false);
            } catch (err) {
              toast(errorMessage(err), "error");
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
    </Card>
  );
}
