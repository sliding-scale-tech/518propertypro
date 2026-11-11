"use client";

import { useMutation, useQuery } from "convex/react";
import { History, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Dialog } from "@/components/properties/dialog";
import { errorMessage, useToast } from "@/components/toast";
import { AddUnitModal, type NewUnit } from "@/components/units/add-unit-modal";
import { EditUnitModal } from "@/components/units/edit-unit-modal";
import { formatRent, type Manager, type UnitRow } from "@/components/units/types";
import { UnitHistory } from "@/components/units/unit-history";
import { Btn, Card, CardHead, DataTable, IconBtn, Pill, Select, Toggle, type Column } from "@/components/ui";

/**
 * Unit inventory for one property. Every unit always has an asset manager: the select's first
 * option ("Same as property") assigns the property default, it never clears the field.
 * Edit controls render only when `canEdit` (admin view); the server enforces the same gate.
 */
export function UnitInventory({
  propertyId,
  defaultAmId,
  managers,
  canEdit,
  canToggleOwn = false,
  canHistory,
}: {
  propertyId: Id<"properties">;
  defaultAmId?: Id<"users">;
  managers: Manager[];
  canEdit: boolean;
  /** Asset-manager view: may toggle availability on units they manage (not ones they only cover). */
  canToggleOwn?: boolean;
  canHistory: boolean;
}) {
  const toast = useToast();
  const units = useQuery(api.units.list, { propertyId });
  const residents = useQuery(api.residents.list, { propertyId });
  const createUnit = useMutation(api.units.create);
  const updateUnit = useMutation(api.units.update);
  const removeUnit = useMutation(api.units.remove);
  const assign = useMutation(api.units.assignAssetManager);
  const setAvailability = useMutation(api.units.setAvailability);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<UnitRow | null>(null);
  const [removing, setRemoving] = useState<UnitRow | null>(null);
  const [history, setHistory] = useState<UnitRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const tenantsByUnit = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of residents ?? []) {
      map.set(r.unitId, [...(map.get(r.unitId) ?? []), r.fullName]);
    }
    return map;
  }, [residents]);

  const rows = useMemo(
    () => [...(units ?? [])].sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true })),
    [units],
  );

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
        className="min-w-48"
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
        {!known && (isOverride || !defaultAmId) ? (
          <option value={u.assetManagerUserId}>{u.assetManagerName}</option>
        ) : null}
        {managers.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.name}
          </option>
        ))}
      </Select>
    );
  };

  const columns: Column<UnitRow>[] = [
    {
      key: "unit",
      header: "Unit",
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
      header: "Tenant",
      render: (u) => {
        const names = tenantsByUnit.get(u._id);
        return names?.length ? names.join(", ") : <span className="text-faint">{residents === undefined ? "…" : "Vacant"}</span>;
      },
    },
    { key: "rent", header: "Rent", align: "right", className: "tabular-nums", render: (u) => formatRent(u.rent) },
    { key: "am", header: "Asset manager", render: amCell },
    {
      key: "avail",
      header: "Available",
      render: (u) =>
        canEdit || (canToggleOwn && u.isMine && !u.covering) ? (
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
        ) : (
          <span className="flex items-center gap-2">
            {canToggleOwn ? (
              <Toggle label={`Unit ${u.unitNumber} available`} checked={u.available} disabled onChange={() => {}} />
            ) : (
              <Pill tone={u.available ? "ok" : "neutral"}>{u.available ? "Available" : "Unavailable"}</Pill>
            )}
            {u.covering ? <Pill tone="acc">Covering</Pill> : null}
          </span>
        ),
    },
  ];
  if (canEdit) {
    columns.push({
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      render: (u) => (
        <div className="flex items-center justify-end gap-1.5">
          {canHistory ? (
            <IconBtn label={`History for unit ${u.unitNumber}`} onClick={() => setHistory(u)}>
              <History />
            </IconBtn>
          ) : null}
          <IconBtn label={`Edit unit ${u.unitNumber}`} onClick={() => setEditing(u)}>
            <Pencil />
          </IconBtn>
          <IconBtn label={`Remove unit ${u.unitNumber}`} onClick={() => setRemoving(u)}>
            <Trash2 />
          </IconBtn>
        </div>
      ),
    });
  }

  return (
    <Card>
      <CardHead
        title="Unit inventory"
        right={
          canEdit ? (
            <Btn variant="pri" sm onClick={() => setAdding(true)} disabled={managers.length === 0}>
              <Plus className="h-3.5 w-3.5" />
              Add unit
            </Btn>
          ) : (
            "Asset manager can be set per unit"
          )
        }
        hint={canEdit ? "Asset manager can be set per unit. Every unit always has one." : undefined}
      />
      {units === undefined ? (
        <p className="text-sm text-muted-foreground">Loading units…</p>
      ) : (
        <DataTable
          caption="Unit inventory"
          columns={columns}
          rows={rows}
          rowKey={(u) => u._id}
          empty="No units yet."
        />
      )}

      {adding ? (
        <AddUnitModal
          managers={managers}
          defaultAmId={defaultAmId}
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

      {history ? (
        <Dialog title={`Unit ${history.unitNumber} · asset manager history`} onClose={() => setHistory(null)}>
          <UnitHistory unitId={history._id} managers={managers} />
        </Dialog>
      ) : null}

      {removing ? (
        <Dialog title={`Remove unit ${removing.unitNumber}?`} onClose={() => setRemoving(null)}>
          <p className="text-sm text-muted-foreground">This permanently deletes the unit. It cannot be undone.</p>
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
