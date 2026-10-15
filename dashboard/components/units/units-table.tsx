"use client";

import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { Fragment, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { AmSelect } from "./am-select";
import { formatRent, type Manager, type UnitRow } from "./types";
import { UnitHistory } from "./unit-history";

type Props = {
  units: UnitRow[];
  managers: Manager[];
  canEdit: boolean;
  canHistory: boolean;
  canToggle: (u: UnitRow) => boolean;
  selected: Set<string>;
  onSelect: (id: string, on: boolean) => void;
  onSelectAll: (on: boolean) => void;
  onAssign: (unitId: Id<"units">, userId: Id<"users">) => void;
  onAvailability: (unitId: Id<"units">, available: boolean) => void;
  busyId: string | null;
  onEdit?: (u: UnitRow) => void;
  onRemove?: (u: UnitRow) => void;
};

function Actions({ unit, p }: { unit: UnitRow; p: Props }) {
  return (
    <div className="flex items-center gap-1">
      {p.onEdit ? (
        <button
          type="button"
          aria-label={`Edit unit ${unit.unitNumber}`}
          onClick={() => p.onEdit?.(unit)}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
        >
          <Pencil className="h-4 w-4" />
        </button>
      ) : null}
      {p.onRemove ? (
        <button
          type="button"
          aria-label={`Remove unit ${unit.unitNumber}`}
          onClick={() => p.onRemove?.(unit)}
          className="rounded-lg p-1.5 text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

function AvailToggle({
  unit,
  enabled,
  onChange,
}: {
  unit: UnitRow;
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  if (!enabled) {
    return (
      <span className={`text-xs font-medium ${unit.available ? "text-emerald-600" : "text-muted-foreground"}`}>
        {unit.available ? "Available" : "Unavailable"}
      </span>
    );
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={unit.available}
      aria-label={`Unit ${unit.unitNumber} available`}
      onClick={() => onChange(!unit.available)}
      className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${
        unit.available ? "bg-primary" : "bg-slate-300"
      }`}
    >
      <span
        className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          unit.available ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function Yours({ unit }: { unit: UnitRow }) {
  return unit.isMine ? (
    <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600">Yours</span>
  ) : null;
}

function Intake({ unit }: { unit: UnitRow }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        unit.maintenanceIntakeActive ? "bg-emerald-50 text-emerald-600" : "bg-muted text-muted-foreground"
      }`}
    >
      {unit.maintenanceIntakeActive ? "On" : "Off"}
    </span>
  );
}

export function UnitsTable(p: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const allSelected = p.units.length > 0 && p.units.every((u) => p.selected.has(u._id));

  const amCell = (u: UnitRow) =>
    p.canEdit ? (
      <AmSelect
        compact
        managers={p.managers}
        value={u.assetManagerUserId}
        disabled={p.busyId === u._id}
        label={`Asset manager for unit ${u.unitNumber}`}
        onChange={(id) => id !== u.assetManagerUserId && p.onAssign(u._id, id)}
      />
    ) : (
      <span>{u.assetManagerName}</span>
    );

  const history = (u: UnitRow) =>
    p.canHistory && open === u._id ? (
      <div className="bg-muted/30 px-4 py-3">
        <p className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Asset manager history
        </p>
        <UnitHistory unitId={u._id} managers={p.managers} />
      </div>
    ) : null;

  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-xl border border-border sm:block">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/45 text-left text-[11px] tracking-wide text-muted-foreground uppercase">
              <th className="w-10 px-3 py-3">
                {p.canEdit ? (
                  <input
                    type="checkbox"
                    aria-label="Select all units"
                    checked={allSelected}
                    onChange={(e) => p.onSelectAll(e.target.checked)}
                  />
                ) : null}
              </th>
              <th className="px-3 py-3 font-medium">Unit</th>
              <th className="px-3 py-3 font-medium">Floor</th>
              <th className="px-3 py-3 font-medium">Beds</th>
              <th className="px-3 py-3 font-medium">Baths</th>
              <th className="px-3 py-3 font-medium">Rent</th>
              <th className="px-3 py-3 font-medium">Available</th>
              <th className="px-3 py-3 font-medium">Asset manager</th>
              <th className="px-3 py-3 font-medium">Maint. intake</th>
              {p.onEdit || p.onRemove ? <th className="px-3 py-3 font-medium">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {p.units.map((u) => (
              <Fragment key={u._id}>
                <tr className="border-b border-border last:border-0">
                  <td className="px-3 py-3">
                    {p.canEdit ? (
                      <input
                        type="checkbox"
                        aria-label={`Select unit ${u.unitNumber}`}
                        checked={p.selected.has(u._id)}
                        onChange={(e) => p.onSelect(u._id, e.target.checked)}
                      />
                    ) : null}
                  </td>
                  <td className="px-3 py-3 font-semibold">
                    {p.canHistory ? (
                      <button
                        type="button"
                        aria-expanded={open === u._id}
                        onClick={() => setOpen(open === u._id ? null : u._id)}
                        className="flex items-center gap-1"
                      >
                        {open === u._id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        {u.unitNumber}
                      </button>
                    ) : (
                      u.unitNumber
                    )}
                  </td>
                  <td className="px-3 py-3 tabular-nums">{u.floor ?? "—"}</td>
                  <td className="px-3 py-3">{u.bedrooms}</td>
                  <td className="px-3 py-3 tabular-nums">{u.bathrooms ?? "—"}</td>
                  <td className="px-3 py-3 tabular-nums">{formatRent(u.rent)}</td>
                  <td className="px-3 py-3">
                    <AvailToggle unit={u} enabled={p.canToggle(u)} onChange={(v) => p.onAvailability(u._id, v)} />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center">
                      {amCell(u)}
                      <Yours unit={u} />
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <Intake unit={u} />
                  </td>
                  {p.onEdit || p.onRemove ? (
                    <td className="px-3 py-3">
                      <Actions unit={u} p={p} />
                    </td>
                  ) : null}
                </tr>
                {p.canHistory && open === u._id ? (
                  <tr className="border-b border-border">
                    <td colSpan={10} className="p-0">
                      {history(u)}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 sm:hidden">
        {p.units.map((u) => (
          <div key={u._id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              {p.canEdit ? (
                <input
                  type="checkbox"
                  aria-label={`Select unit ${u.unitNumber}`}
                  checked={p.selected.has(u._id)}
                  onChange={(e) => p.onSelect(u._id, e.target.checked)}
                />
              ) : null}
              <span className="text-base font-semibold">Unit {u.unitNumber}</span>
              <span className="ml-auto">
                <AvailToggle unit={u} enabled={p.canToggle(u)} onChange={(v) => p.onAvailability(u._id, v)} />
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {u.bedrooms} bd · {u.bathrooms ?? "—"} ba · Floor {u.floor ?? "—"} · {formatRent(u.rent)}
            </p>
            <div className="mt-3 flex items-center text-sm">
              <div className="min-w-0 flex-1">{amCell(u)}</div>
              <Yours unit={u} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Maintenance intake: <Intake unit={u} />
            </p>
            {p.onEdit || p.onRemove ? (
              <div className="mt-2">
                <Actions unit={u} p={p} />
              </div>
            ) : null}
            {p.canHistory ? (
              <button
                type="button"
                onClick={() => setOpen(open === u._id ? null : u._id)}
                className="mt-2 text-xs font-medium text-primary"
              >
                {open === u._id ? "Hide history" : "Show history"}
              </button>
            ) : null}
            {history(u)}
          </div>
        ))}
      </div>
    </>
  );
}
