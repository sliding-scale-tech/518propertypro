"use client";

import { useMutation, useQuery } from "convex/react";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useToast } from "@/components/toast";
import { Modal, btnDanger, btnOutline } from "@/components/maintenance/shared";
import { AddUnitModal, type NewUnit } from "@/components/units/add-unit-modal";
import { AmSelect } from "@/components/units/am-select";
import { EditUnitModal } from "@/components/units/edit-unit-modal";
import { errorMessage, inputClass, type Manager, type UnitRow } from "@/components/units/types";
import { UnitsTable } from "@/components/units/units-table";

const MAX_BULK = 500;

/** Units of one property: stats, filters, bulk assign, add/edit/remove. Used by /units and /properties/[id]. */
export function UnitsManager({ propertyId }: { propertyId: Id<"properties"> }) {
  const toast = useToast();
  const team = useQuery(api.team.overview);

  const self = team?.members.find((m) => m.isSelf);
  const roles: string[] = self?.jobRoles ?? [];
  const isAdmin = team?.isAdmin ?? false;
  const isSimplr = roles.includes("simplr_admin");
  // Mirrors the server gates (units.ts / audit.ts); the server remains the boundary.
  const canEdit = isAdmin || isSimplr || roles.includes("executive") || roles.includes("maintenance_lead");
  const canHistory = isAdmin || isSimplr || roles.includes("executive");
  const canView = !!team && (isAdmin || roles.length === 0 || roles.some((r) => r !== "technician"));

  const units = useQuery(api.units.list, canView ? { propertyId } : "skip");

  const createUnit = useMutation(api.units.create);
  const updateUnit = useMutation(api.units.update);
  const removeUnit = useMutation(api.units.remove);
  const assign = useMutation(api.units.assignAssetManager);
  const bulkAssign = useMutation(api.units.bulkAssignAssetManager);
  const setAvailability = useMutation(api.units.setAvailability);

  const [search, setSearch] = useState("");
  const [amFilter, setAmFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAm, setBulkAm] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<UnitRow | null>(null);
  const [removing, setRemoving] = useState<UnitRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const managers: Manager[] = useMemo(
    () =>
      (team?.members ?? [])
        .filter((m) => m.jobRoles.includes("asset_manager"))
        .map((m) => ({ userId: m.userId, name: m.name })),
    [team],
  );

  const all = useMemo(() => units ?? [], [units]);
  const visibleUnits = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter(
      (u) =>
        (amFilter === "all" || u.assetManagerUserId === amFilter) &&
        (!q || u.unitNumber.toLowerCase().includes(q)),
    );
  }, [all, search, amFilter]);

  const availableCount = all.filter((u) => u.available).length;
  const perAm = managers.map((m) => ({
    ...m,
    count: all.filter((u) => u.assetManagerUserId === m.userId).length,
  }));

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

  const canToggle = (u: UnitRow) => canEdit || (roles.includes("asset_manager") && u.isMine);

  const onSelect = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const onSelectAll = (on: boolean) =>
    setSelected(on ? new Set(visibleUnits.slice(0, MAX_BULK).map((u) => u._id)) : new Set());

  // Only ids that still exist count; a deleted unit must not linger in the bulk request.
  const selectedIds = all.filter((u) => selected.has(u._id)).map((u) => u._id);

  if (team === undefined) {
    return <p className="py-10 text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      {team && canView && canEdit ? (
        <div className="flex justify-end">
          <button
            onClick={() => setAdding(true)}
            disabled={managers.length === 0}
            className="flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
            Add unit
          </button>
        </div>
      ) : null}

      {!team ? (
        <p className="text-sm text-muted-foreground">No team found for this account.</p>
      ) : !canView ? (
        <p className="text-sm text-muted-foreground">You don&apos;t have access to units.</p>
      ) : (
        <>
          {canEdit && managers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-5 text-center">
              <p className="text-sm">Give someone the Asset manager role on the Team page first.</p>
              <Link href="/team" className="mt-1 inline-block text-sm font-semibold text-primary underline">
                Open Team
              </Link>
            </div>
          ) : null}

          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Total units</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{all.length}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Available</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{availableCount}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Units per asset manager</p>
              {perAm.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">No asset managers</p>
              ) : (
                <ul className="mt-1 max-h-20 space-y-0.5 overflow-y-auto text-sm">
                  {perAm.map((m) => (
                    <li key={m.userId} className="flex justify-between gap-2">
                      <span className="truncate">{m.name}</span>
                      <span className="font-semibold tabular-nums">{m.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search unit number"
                aria-label="Search unit number"
                className={`${inputClass} pl-9`}
              />
            </div>
            <select
              value={amFilter}
              onChange={(e) => setAmFilter(e.target.value)}
              aria-label="Filter by asset manager"
              className={`${inputClass} sm:w-56`}
            >
              <option value="all">All asset managers</option>
              {managers.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          {canEdit && selectedIds.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/40 p-3 sm:flex-row sm:items-center">
              <span className="text-sm font-medium">{selectedIds.length} selected</span>
              <div className="sm:ml-auto sm:w-56">
                <AmSelect
                  managers={managers}
                  value={bulkAm}
                  onChange={setBulkAm}
                  label="Asset manager for selected units"
                  placeholder="Assign to…"
                />
              </div>
              <button
                disabled={!bulkAm || busy || selectedIds.length > MAX_BULK}
                onClick={async () => {
                  setBusy(true);
                  const ok = await run(
                    () =>
                      bulkAssign({
                        unitIds: selectedIds as Id<"units">[],
                        assetManagerUserId: bulkAm as Id<"users">,
                      }),
                    "Asset manager assigned",
                  );
                  setBusy(false);
                  if (ok) setSelected(new Set());
                }}
                className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Assign asset manager
              </button>
            </div>
          ) : null}

          {units === undefined ? (
            <p className="text-sm text-muted-foreground">Loading units…</p>
          ) : visibleUnits.length === 0 ? (
            <p className="rounded-xl border border-border py-10 text-center text-sm text-muted-foreground">
              {all.length === 0 ? "No units yet." : "No units match your filters."}
            </p>
          ) : (
            <UnitsTable
              units={visibleUnits}
              managers={managers}
              canEdit={canEdit}
              canHistory={canHistory}
              canToggle={canToggle}
              onEdit={canEdit ? setEditing : undefined}
              onRemove={isAdmin ? setRemoving : undefined}
              selected={selected}
              onSelect={onSelect}
              onSelectAll={onSelectAll}
              busyId={busyId}
              onAssign={async (unitId, userId) => {
                setBusyId(unitId);
                await run(() => assign({ unitId, assetManagerUserId: userId }), "Asset manager updated");
                setBusyId(null);
              }}
              onAvailability={async (unitId, available) => {
                setBusyId(unitId);
                await run(() => setAvailability({ unitId, available }), "Availability updated");
                setBusyId(null);
              }}
            />
          )}
        </>
      )}

      {adding ? (
        <AddUnitModal
          managers={managers}
          busy={busy}
          onClose={() => setAdding(false)}
          onSubmit={async (unit: NewUnit) => {
            setBusy(true);
            const ok = await run(() => createUnit({ propertyId, ...unit }), "Unit added");
            setBusy(false);
            if (ok) setAdding(false);
          }}
        />
      ) : null}

      {editing ? (
        <EditUnitModal
          unit={editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSubmit={async (patch) => {
            setBusy(true);
            const ok = await run(() => updateUnit({ unitId: editing._id, ...patch }), "Unit updated");
            setBusy(false);
            if (ok) setEditing(null);
          }}
        />
      ) : null}

      {removing ? (
        <Modal title={`Remove unit ${removing.unitNumber}?`} onClose={() => setRemoving(null)}>
          <p className="text-sm text-muted-foreground">This permanently deletes the unit. It cannot be undone.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button className={btnOutline} onClick={() => setRemoving(null)}>
              Cancel
            </button>
            <button
              className={btnDanger}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const ok = await run(() => removeUnit({ unitId: removing._id }), "Unit removed");
                setBusy(false);
                if (ok) setRemoving(null);
              }}
            >
              Remove unit
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
