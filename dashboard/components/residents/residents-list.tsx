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
import {
  LeaseFollowUpActions,
  LeaseTagPill,
  MoveOutDialog,
  NewRenterDialog,
  RenewDialog,
} from "@/components/residents/lease-dialogs";
import { LEASE_FILTERS, LEASE_FILTER_LABEL } from "@/convex/leaseLib";
import { errorMessage, useToast } from "@/components/toast";
import {
  Btn,
  Card,
  CardHead,
  DataTable,
  Pagination,
  Pill,
  FilterSelect,
  FilterToolbar,
  SearchBox,
  RowMenu,
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
  const isAdmin = access?.isAdmin === true;
  // B45: an asset manager adds residents to, and edits residents of, the units they manage.
  const isAm = access?.roles.includes("asset_manager") === true;
  const properties = useQuery(api.properties.list);
  const create = useMutation(api.residents.create);
  const actions = useResidentActions(undefined, { onlyMine: !isAdmin });

  const url = useTenantUrl();
  const search = useUrlSearch();
  const paging = useUrlPaging();
  const status = readChoice(url.params.get("status"), STATUSES, "active");
  const team = readChoice(url.params.get("team"), [...TEAMS, "all"] as const, "all");
  const lease = readChoice(url.params.get("lease"), LEASE_FILTERS, "all");
  const sort = readSort(url.params.get("sort"), url.params.get("dir"), SORT_KEYS, SORT_DEFAULT);
  // The property filter is only sent once it is known to be one of the viewer's properties.
  const propertyParam = url.params.get("property") ?? "";
  const propertyKnown = properties?.some((p) => p._id === propertyParam) ?? false;
  const propertyId = propertyKnown ? (propertyParam as Id<"properties">) : undefined;

  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  // B44 lease flows opened from a row.
  const [newRenterUnit, setNewRenterUnit] = useState<string | null>(null);
  const [movingOut, setMovingOut] = useState<{ unitId: string; residentId: string } | null>(null);
  const [renewing, setRenewing] = useState<{ _id: string; fullName: string; leaseEnd?: string } | null>(null);

  const result = useQuery(
    api.residents.listPage,
    propertyParam && properties === undefined
      ? "skip"
      : {
          propertyId,
          search: search.q.trim() || undefined,
          status,
          team: team === "all" ? undefined : team,
          lease: lease === "all" ? undefined : lease,
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
    {
      key: "lease",
      ...sortable("lease", "Lease end"),
      className: "tabular-nums",
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span>{r.leaseEnd ?? "—"}</span>
          <LeaseTagPill tag={r.leaseTag} />
        </div>
      ),
    },
    {
      key: "status",
      ...sortable("status", "Status"),
      render: (r) => <Pill tone={r.active ? "ok" : "neutral"}>{r.active ? "Active" : "Inactive"}</Pill>,
    },
  );
  // Admins get the row menu; an asset manager the follow-up answers and a row menu on their own units.
  if (isAdmin || data?.rows.some((r) => r.canManage || (r.openFollowUpTaskId && r.canResolveLease))) {
    columns.push({
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      render: (r) => (
        <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          {r.openFollowUpTaskId && r.canResolveLease ? (
            <div className="flex flex-col items-end gap-1">
              <span className="text-[11.5px] text-muted-foreground">Lease ended: renewed, moving out or month-to-month?</span>
              <LeaseFollowUpActions target={r} canMoveOut={r.canManage} />
            </div>
          ) : null}
          {r.canManage ? (
            <RowMenu
              label={`Actions for ${r.fullName}`}
              items={[
                { label: "Edit", onSelect: () => actions.edit(r) },
                ...(r.active
                  ? [
                      { label: "Move out…", onSelect: () => setMovingOut({ unitId: r.unitId, residentId: r._id }) },
                      { label: "New renter for this unit…", onSelect: () => setNewRenterUnit(r.unitId) },
                      {
                        label: "Lease renewed…",
                        onSelect: () => setRenewing({ _id: r._id, fullName: r.fullName, leaseEnd: r.leaseEnd }),
                      },
                      ...(isAdmin
                        ? [
                            {
                              label: "Deactivate…",
                              danger: true,
                              title: "Remove a resident entered by mistake. To record a move-out, use Move out.",
                              onSelect: () => actions.deactivate(r),
                            },
                          ]
                        : []),
                    ]
                  : []),
              ]}
            />
          ) : null}
        </div>
      ),
    });
  }

  const filtered =
    search.q.trim() !== "" || propertyId !== undefined || team !== "all" || status !== "active" || lease !== "all";
  const clearAll = () => {
    search.setInput("");
    url.set({ q: null, property: null, team: null, status: null, lease: null });
  };

  return (
    <Card>
      <CardHead
        title="Residents"
        hint="Tenant directory used to recognise callers."
        right={
          isAdmin || isAm ? (
            <Btn variant="pri" sm onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add resident
            </Btn>
          ) : undefined
        }
      />
      <FilterToolbar
        className="mb-3.5"
        active={filtered}
        onClear={clearAll}
        search={
          <SearchBox
            id="residents-search"
            label="Search residents"
            value={search.input}
            onChange={search.setInput}
            onClear={search.clear}
            placeholder="Search name, unit, property, phone or email"
          />
        }
      >
        <FilterSelect
          label="Property"
          active={propertyId !== undefined}
          value={propertyId ?? "all"}
          onChange={(e) => url.set({ property: !e.target.value || e.target.value === "all" ? null : e.target.value })}
          className="sm:w-56"
        >
          <option value="all">All</option>
          {(properties ?? []).map((p) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Team"
          active={team !== "all"}
          value={team}
          onChange={(e) => url.set({ team: !e.target.value || e.target.value === "all" ? null : e.target.value })}
        >
          <option value="all">All</option>
          {TEAMS.map((t) => (
            <option key={t} value={t}>
              {TEAM_LABEL[t]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Status"
          active={status !== "active"}
          value={status}
          onChange={(e) => url.set({ status: !e.target.value || e.target.value === "active" ? null : e.target.value })}
          className="sm:w-52"
        >
          <option value="active">Active</option>
          <option value="inactive">Moved out / inactive</option>
          <option value="all">All residents</option>
        </FilterSelect>
        <FilterSelect
          label="Lease"
          active={lease !== "all"}
          value={lease}
          onChange={(e) => url.set({ lease: !e.target.value || e.target.value === "all" ? null : e.target.value })}
          className="sm:w-48"
        >
          {LEASE_FILTERS.map((l) => (
            <option key={l} value={l}>
              {LEASE_FILTER_LABEL[l]}
            </option>
          ))}
        </FilterSelect>
      </FilterToolbar>

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

      {actions.dialogs}
      {newRenterUnit ? <NewRenterDialog unitId={newRenterUnit} onClose={() => setNewRenterUnit(null)} /> : null}
      {movingOut ? (
        <MoveOutDialog unitId={movingOut.unitId} residentId={movingOut.residentId} onClose={() => setMovingOut(null)} />
      ) : null}
      {renewing ? (
        <RenewDialog
          residentId={renewing._id}
          fullName={renewing.fullName}
          oldLeaseEnd={renewing.leaseEnd}
          onClose={() => setRenewing(null)}
        />
      ) : null}

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
