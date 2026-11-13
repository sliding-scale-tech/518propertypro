"use client";

import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatCurrency, formatMonth } from "@/convex/rosFormat";
import { Dialog } from "@/components/properties/dialog";
import { errorMessage, useToast } from "@/components/toast";
import { AddUnitModal, type NewUnit } from "@/components/units/add-unit-modal";
import { ChangeRentDialog, type ChangeRentTarget } from "@/components/units/change-rent";
import { formatRent, type Manager, type UnitRow } from "@/components/units/types";
import { UnitDrawer, type UnitDrawerMode, type UnitRentNow } from "@/components/units/unit-drawer";
import { normalizeSearch } from "@/components/finance/payments-search";
import {
  UNIT_AVAILABILITY_FILTERS,
  UNIT_SORT_DEFAULT,
  UNIT_SORT_KEYS,
  unitsView,
  type UnitAvailabilityFilter,
  type UnitSortKey,
} from "@/components/properties/property-finders";
import {
  Btn,
  Card,
  CardHead,
  DataTable,
  Pagination,
  Pill,
  RowMenu,
  SearchBox,
  Select,
  SortHeader,
  Toggle,
  ariaSortOf,
  paginate,
  readSort,
  toggleSort,
  useUrlPaging,
  useUrlSearch,
  type Column,
  type RowMenuItem,
} from "@/components/ui";

// This list shares the page with the properties list's URL keys, so its own keys are prefixed.
const P = "units_";

/**
 * The property's units: Unit · Tenant · Rent/month · Status · Asset manager · ⋯. A row click (or
 * Enter) opens the unit drawer (details, rent and its history, actions). Every unit always has an
 * asset manager: the select's first option ("Same as property") assigns the property default, it
 * never clears the field. Who can do what follows the server: Add / Edit / Remove and the asset
 * manager for the admin view (`canEdit`), Change rent for admin + accountant (`canChangeRent`),
 * availability for the admin view and an asset manager on their own units.
 */
export function UnitInventory({
  propertyId,
  propertyName,
  defaultAmId,
  managers,
  canEdit,
  canToggleOwn = false,
  canHistory,
  canChangeRent = false,
}: {
  propertyId: Id<"properties">;
  propertyName: string;
  defaultAmId?: Id<"users">;
  managers: Manager[];
  canEdit: boolean;
  /** Asset-manager view: may toggle availability on units they manage (not ones they only cover). */
  canToggleOwn?: boolean;
  canHistory: boolean;
  /** Admin view + accountant: Change rent and the rent history. */
  canChangeRent?: boolean;
}) {
  const toast = useToast();
  const units = useQuery(api.units.list, { propertyId });
  const residents = useQuery(api.residents.list, { propertyId });
  const rentNow = useQuery(api.units.rentSummary, { propertyId });
  const createUnit = useMutation(api.units.create);
  const updateUnit = useMutation(api.units.update);
  const removeUnit = useMutation(api.units.remove);
  const assign = useMutation(api.units.assignAssetManager);
  const setAvailability = useMutation(api.units.setAvailability);

  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<{ id: string; mode: UnitDrawerMode } | null>(null);
  const [rentFor, setRentFor] = useState<ChangeRentTarget | null>(null);
  const [removing, setRemoving] = useState<UnitRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const tenantsByUnit = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of residents ?? []) {
      map.set(r.unitId, [...(map.get(r.unitId) ?? []), r.fullName]);
    }
    return map;
  }, [residents]);
  const rentByUnit = useMemo(() => new Map<string, UnitRentNow>((rentNow ?? []).map((r) => [r.unitId, r])), [rentNow]);

  // Rent/month (and its sort) is the rent THIS month: the rent history when there is one.
  const rows = useMemo(
    () =>
      (units ?? []).map((u) => {
        const now = rentByUnit.get(u._id);
        return now ? { ...u, rent: now.cents !== null ? now.cents / 100 : undefined } : u;
      }),
    [units, rentByUnit],
  );
  const tenantsOf = (u: UnitRow) => tenantsByUnit.get(u._id) ?? [];

  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const search = useUrlSearch(`${P}q`, `${P}page`);
  const q = normalizeSearch(search.q);
  const rawFilter = params.get(`${P}filter`) ?? "";
  const filter = (UNIT_AVAILABILITY_FILTERS as readonly string[]).includes(rawFilter) ? (rawFilter as UnitAvailabilityFilter) : "";
  const sort = readSort(params.get(`${P}sort`), params.get(`${P}dir`), UNIT_SORT_KEYS, UNIT_SORT_DEFAULT);
  const paging = useUrlPaging(P);
  /** Set URL params ("" removes one); any change goes back to page 1. */
  const setParams = (updates: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete(`${P}page`);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const onSort = (key: UnitSortKey) => {
    const nextSort = toggleSort(sort, key);
    const isDefault = nextSort.key === UNIT_SORT_DEFAULT.key && nextSort.dir === UNIT_SORT_DEFAULT.dir;
    setParams({ [`${P}sort`]: isDefault ? "" : nextSort.key, [`${P}dir`]: isDefault ? "" : nextSort.dir });
  };
  const sortable = (key: UnitSortKey, label: string, align: "left" | "right" = "left") => ({
    header: <SortHeader label={label} sortKey={key} sort={sort} onSort={onSort} align={align} />,
    sort: ariaSortOf(sort, key),
  });
  const visible = unitsView(rows, tenantsOf, { q, filter, sort });
  const paged = paginate(visible, paging.page, paging.pageSize);
  const openUnit = open ? (units ?? []).find((u) => u._id === open.id) : undefined;

  const defaultName =
    managers.find((m) => m.userId === defaultAmId)?.name ??
    rows.find((u) => u.assetManagerUserId === defaultAmId)?.assetManagerName ??
    "property default";

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      return true;
    } catch (err) {
      toast(errorMessage(err), "error");
      return false;
    }
  };
  const label = (u: UnitRow) => `Unit ${u.unitNumber} · ${propertyName}`;

  const amCell = (u: UnitRow) => {
    const isOverride = !!defaultAmId && u.assetManagerUserId !== defaultAmId;
    if (!canEdit) {
      return (
        <span className={isOverride ? "font-medium text-primary" : undefined}>
          {isOverride ? u.assetManagerName : defaultAmId ? `Same as property · ${u.assetManagerName}` : u.assetManagerName}
        </span>
      );
    }
    const known = managers.some((m) => m.userId === u.assetManagerUserId);
    return (
      <Select
        aria-label={`Asset manager for unit ${u.unitNumber}`}
        className="min-w-44"
        highlight={isOverride}
        disabled={busyId === u._id}
        value={isOverride || !defaultAmId ? u.assetManagerUserId : ""}
        onChange={async (e) => {
          const next = (e.target.value || defaultAmId) as Id<"users"> | undefined;
          if (!next || next === u.assetManagerUserId) return;
          setBusyId(u._id);
          await run(() => assign({ unitId: u._id, assetManagerUserId: next }), "Asset manager updated");
          setBusyId(null);
        }}
      >
        {defaultAmId ? <option value="">Same as property · {defaultName}</option> : null}
        {!known && (isOverride || !defaultAmId) ? <option value={u.assetManagerUserId}>{u.assetManagerName}</option> : null}
        {managers.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.name}
          </option>
        ))}
      </Select>
    );
  };

  const statusCell = (u: UnitRow) => {
    const occupied = tenantsOf(u).length > 0;
    const canToggle = canEdit || (canToggleOwn && u.isMine && !u.covering);
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={occupied ? "ok" : "neutral"}>{residents === undefined ? "…" : occupied ? "Occupied" : "Vacant"}</Pill>
        {canToggle ? (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <Toggle
              label={`Unit ${u.unitNumber} available`}
              checked={u.available}
              disabled={busyId === u._id}
              onChange={async (available) => {
                setBusyId(u._id);
                await run(() => setAvailability({ unitId: u._id, available }), "Availability updated");
                setBusyId(null);
              }}
            />
            Available
          </span>
        ) : u.available ? (
          <Pill tone="acc">Available</Pill>
        ) : null}
        {u.covering ? <Pill tone="acc">Covering</Pill> : null}
      </div>
    );
  };

  const menuItems = (u: UnitRow): RowMenuItem[] => [
    ...(canEdit ? [{ label: "Edit unit", onSelect: () => setOpen({ id: u._id, mode: "edit" }) }] : []),
    ...(canChangeRent ? [{ label: "Change rent…", onSelect: () => setRentFor({ unitId: u._id, label: label(u) }) }] : []),
    ...(canChangeRent || canHistory ? [{ label: "View history", onSelect: () => setOpen({ id: u._id, mode: "view" }) }] : []),
    ...(canEdit ? [{ label: "Remove unit…", danger: true, onSelect: () => setRemoving(u) }] : []),
  ];

  const columns: Column<UnitRow>[] = [
    {
      key: "unit",
      ...sortable("unit", "Unit"),
      render: (u) => (
        <div>
          <span className="font-semibold">{u.unitNumber}</span>
          <div className="text-xs text-muted-foreground">
            {u.bedrooms}
            {u.bathrooms !== undefined ? ` · ${u.bathrooms} ba` : ""}
            {u.floor !== undefined ? ` · floor ${u.floor}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "tenant",
      ...sortable("tenant", "Tenant"),
      render: (u) => {
        const names = tenantsByUnit.get(u._id);
        return names?.length ? names.join(", ") : <span className="text-faint">{residents === undefined ? "…" : "—"}</span>;
      },
    },
    {
      key: "rent",
      ...sortable("rent", "Rent / month", "right"),
      align: "right",
      className: "tabular-nums whitespace-nowrap",
      render: (u) => {
        const now = rentByUnit.get(u._id);
        if (!now) return formatRent(u.rent);
        return (
          <div>
            <span className="font-medium">{now.cents !== null ? formatCurrency(now.cents) : <span className="text-faint">Not set</span>}</span>
            {now.upcoming ? (
              <div className="text-[11.5px] text-muted-foreground">
                {formatCurrency(now.upcoming.cents)} from {formatMonth(now.upcoming.month)}
              </div>
            ) : null}
          </div>
        );
      },
    },
    { key: "status", ...sortable("available", "Status"), render: statusCell },
    { key: "am", ...sortable("manager", "Asset manager"), render: amCell },
  ];
  if (canEdit || canChangeRent || canHistory) {
    columns.push({
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (u) => <RowMenu label={`Actions for unit ${u.unitNumber}`} items={menuItems(u)} />,
    });
  }

  return (
    <Card>
      <CardHead
        title="Units"
        right={
          canEdit ? (
            <Btn variant="pri" sm onClick={() => setAdding(true)} disabled={managers.length === 0}>
              <Plus className="h-3.5 w-3.5" />
              Add unit
            </Btn>
          ) : undefined
        }
        hint="Click a unit to see its details, rent and history."
      />
      {units === undefined ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading units…</p>
      ) : (
        <>
          {rows.length > 0 ? (
            <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_220px]">
              <SearchBox
                id="units-search"
                label="Search units"
                value={search.input}
                onChange={search.setInput}
                onClear={search.clear}
                placeholder="Search unit, tenant, asset manager or status"
              />
              <Select aria-label="Show units" value={filter} onChange={(e) => setParams({ [`${P}filter`]: e.target.value || "" })}>
                <option value="">All units</option>
                <option value="available">Available</option>
                <option value="unavailable">Unavailable</option>
                <option value="vacant">Vacant (no tenant)</option>
              </Select>
            </div>
          ) : null}
          <DataTable
            caption="Units"
            columns={columns}
            rows={paged.rows}
            rowKey={(u) => u._id}
            onRowClick={(u) => setOpen({ id: u._id, mode: "view" })}
            empty={
              rows.length === 0 ? (
                canEdit ? "No units yet. Add the first one with Add unit." : "No units yet."
              ) : q ? (
                <span>
                  No units match &ldquo;{search.q.trim()}&rdquo;.{" "}
                  <button type="button" onClick={search.clear} className="font-medium text-primary hover:underline">
                    Clear search
                  </button>
                </span>
              ) : (
                "No units match this filter."
              )
            }
          />
          <Pagination
            label="Unit pages"
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            onPage={paging.setPage}
            onPageSize={paging.setPageSize}
          />
        </>
      )}

      {adding ? (
        <AddUnitModal
          managers={managers}
          defaultAmId={defaultAmId}
          onClose={() => setAdding(false)}
          onSave={(unit: NewUnit) => createUnit({ propertyId, ...unit })}
        />
      ) : null}

      {open && openUnit ? (
        <UnitDrawer
          key={`${openUnit._id}-${open.mode}`}
          unit={openUnit}
          propertyName={propertyName}
          tenants={tenantsOf(openUnit)}
          rent={rentByUnit.get(openUnit._id)}
          managers={managers}
          initialMode={open.mode}
          canEdit={canEdit}
          canChangeRent={canChangeRent}
          canHistory={canHistory}
          onSave={(patch) => updateUnit({ unitId: openUnit._id, ...patch })}
          onRemove={() => {
            setOpen(null);
            setRemoving(openUnit);
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}

      {rentFor ? <ChangeRentDialog target={rentFor} onClose={() => setRentFor(null)} /> : null}

      {removing ? (
        <Dialog title={`Remove unit ${removing.unitNumber}?`} onClose={() => setRemoving(null)}>
          <p className="text-sm text-muted-foreground">This permanently deletes the unit and its rent history. It cannot be undone.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Btn onClick={() => setRemoving(null)}>Cancel</Btn>
            <Btn
              variant="dng"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const ok = await run(() => removeUnit({ unitId: removing._id }), "Unit removed");
                setBusy(false);
                if (ok) setRemoving(null);
              }}
            >
              Remove unit
            </Btn>
          </div>
        </Dialog>
      ) : null}
    </Card>
  );
}
