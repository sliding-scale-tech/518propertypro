"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Banknote, History, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { formatCurrency, formatMonth } from "@/convex/rosFormat";
import { Btn, Drawer, DrawerSection, KeyValue, Pill } from "@/components/ui";
import { formatStamp } from "@/components/finance/months";
import { ChangeRentForm } from "./change-rent";
import { UnitEditForm, type UnitPatch } from "./edit-unit-modal";
import type { Manager, UnitRow } from "./types";
import { UnitHistory } from "./unit-history";

/** One row of units.rentSummary: the unit's rent THIS month (rent history, else roster) and its next change. */
export type UnitRentNow = FunctionReturnType<typeof api.units.rentSummary>[number];

export type UnitDrawerMode = "view" | "edit" | "rent";

const PAID_TO: Record<string, string> = {
  company: "Paid to the company",
  owner_direct: "Owner collects rent directly",
  included_in_other_unit: "Included in another unit's rent",
};
const OCCUPANCY: Record<string, string> = {
  occupied: "Occupied",
  occupied_leaving: "Occupied (leaving)",
  vacant: "Vacant",
  vacant_not_ready: "Vacant, not rent ready",
};
const LEASE: Record<string, string> = { fixed: "Fixed term", month_to_month: "Month to month", vacant: "Vacant", unknown: "Unknown" };

/** "Rent $1,250.00/month (from November 2026)" for the Edit unit form and the drawer. */
export function rentLine(rent: UnitRentNow | undefined): string {
  if (!rent) return "Rent —";
  if (rent.cents === null) return "No rent set";
  return `Rent ${formatCurrency(rent.cents)}/month (${rent.fromMonth ? `from ${formatMonth(rent.fromMonth)}` : "from the roster"})`;
}

/**
 * The unit drawer (whole-row click on the property's unit table): details, the rent now and its
 * history, and the unit's actions. Edit unit and Change rent open inline (a dialog over a drawer
 * would fight it for Escape and focus). Who sees what follows the server: Edit / Remove for the admin
 * view, Change rent and the rent history for admin + accountant, the asset manager history for the
 * admin view.
 */
export function UnitDrawer({
  unit,
  propertyName,
  tenants,
  rent,
  managers,
  initialMode = "view",
  canEdit,
  canChangeRent,
  canHistory,
  onSave,
  onRemove,
  onClose,
}: {
  unit: UnitRow;
  propertyName: string;
  tenants: string[];
  rent: UnitRentNow | undefined;
  managers: Manager[];
  initialMode?: UnitDrawerMode;
  canEdit: boolean;
  canChangeRent: boolean;
  canHistory: boolean;
  onSave: (patch: UnitPatch) => Promise<unknown>;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<UnitDrawerMode>(initialMode);
  const occupied = tenants.length > 0;
  const label = `Unit ${unit.unitNumber} · ${propertyName}`;
  const rentAction =
    canChangeRent && mode === "edit" ? (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13.5px] font-medium tabular-nums">{rentLine(rent)}</span>
        <Btn sm onClick={() => setMode("rent")}>
          <Banknote aria-hidden className="h-3.5 w-3.5" />
          Change rent
        </Btn>
      </div>
    ) : mode === "edit" ? (
      <span className="text-[13.5px] tabular-nums">{rentLine(rent)}</span>
    ) : null;

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={propertyName}
      headerTop={
        <>
          <Pill tone={occupied ? "ok" : "neutral"}>{occupied ? "Occupied" : "Vacant"}</Pill>
          {unit.available ? <Pill tone="acc">Available</Pill> : null}
          {unit.covering ? <Pill tone="acc">Covering</Pill> : null}
        </>
      }
      title={
        mode === "edit" ? `Edit unit ${unit.unitNumber}` : mode === "rent" ? `Change rent · Unit ${unit.unitNumber}` : `Unit ${unit.unitNumber}`
      }
    >
      {mode === "edit" && canEdit ? (
        <UnitEditForm unit={unit} rent={rentAction} onSave={onSave} onDone={() => setMode("view")} onCancel={() => setMode("view")} />
      ) : mode === "rent" && canChangeRent ? (
        <ChangeRentForm
          target={{ unitId: unit._id, label }}
          onDone={() => setMode("view")}
          onCancel={() => setMode("view")}
        />
      ) : (
        <>
          {canEdit || canChangeRent ? (
            <div className="flex flex-wrap gap-2">
              {canEdit ? (
                <Btn sm onClick={() => setMode("edit")}>
                  <Pencil aria-hidden className="h-3.5 w-3.5" />
                  Edit unit
                </Btn>
              ) : null}
              {canChangeRent ? (
                <Btn sm onClick={() => setMode("rent")}>
                  <Banknote aria-hidden className="h-3.5 w-3.5" />
                  Change rent
                </Btn>
              ) : null}
              {canEdit ? (
                <Btn sm variant="dng" className="ml-auto" onClick={onRemove}>
                  <Trash2 aria-hidden className="h-3.5 w-3.5" />
                  Remove unit
                </Btn>
              ) : null}
            </div>
          ) : null}

          <DrawerSection title="Rent">
            <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-3">
              <div className="text-[20px] font-semibold tabular-nums">
                {rent ? (rent.cents !== null ? `${formatCurrency(rent.cents)}` : "No rent set") : "—"}
                {rent?.cents != null ? <span className="ml-1 text-[13px] font-normal text-muted-foreground">/ month</span> : null}
              </div>
              <div className="text-xs text-muted-foreground">
                {rent ? (rent.fromMonth ? `Since ${formatMonth(rent.fromMonth)}` : rent.hasHistory ? "Before the first rent change" : "From the roster") : ""}
              </div>
              {rent?.upcoming ? (
                <div className="mt-1.5 text-[12.5px] text-foreground">
                  Changes to <b className="font-semibold tabular-nums">{formatCurrency(rent.upcoming.cents)}</b> from {formatMonth(rent.upcoming.month)}.
                </div>
              ) : null}
            </div>
          </DrawerSection>

          <DrawerSection title="Details">
            <KeyValue
              items={[
                { label: "Tenant", value: tenants.length > 0 ? tenants.join(", ") : <span className="text-muted-foreground">Vacant (no tenant on file)</span> },
                { label: "Unit type", value: unit.bedrooms || "—" },
                { label: "Baths", value: unit.bathrooms !== undefined ? String(unit.bathrooms) : "—" },
                { label: "Floor", value: unit.floorRaw ?? (unit.floor !== undefined ? String(unit.floor) : "—") },
                ...(unit.parking ? [{ label: "Parking", value: unit.parking }] : []),
                { label: "Asset manager", value: unit.assetManagerName },
                { label: "Available", value: unit.available ? `Yes${unit.availableFrom ? `, from ${unit.availableFrom}` : ""}` : "No" },
                ...(unit.occupancy ? [{ label: "Roster", value: OCCUPANCY[unit.occupancy] ?? unit.occupancy }] : []),
                ...(unit.leaseType ? [{ label: "Lease", value: `${LEASE[unit.leaseType] ?? unit.leaseType}${unit.leaseEnd ? `, ends ${unit.leaseEnd}` : ""}` }] : []),
                ...(unit.rentPaidTo ? [{ label: "Rent paid", value: PAID_TO[unit.rentPaidTo] ?? unit.rentPaidTo }] : []),
              ]}
            />
          </DrawerSection>

          {canChangeRent ? (
            <DrawerSection title="Rent history">
              <RentHistoryList unitId={unit._id} />
            </DrawerSection>
          ) : null}

          {canHistory ? (
            <DrawerSection
              title={
                <span className="inline-flex items-center gap-1.5">
                  <History aria-hidden className="h-3.5 w-3.5" />
                  Asset manager history
                </span>
              }
            >
              <UnitHistory unitId={unit._id} managers={managers} />
            </DrawerSection>
          ) : null}
        </>
      )}
    </Drawer>
  );
}

/** Every rent change of the unit, newest effective month first (admin view + accountant). */
export function RentHistoryList({ unitId }: { unitId: string }) {
  const h = useQuery(api.unitRent.history, { unitId });
  if (h === undefined) return <p className="text-xs text-muted-foreground">Loading rent history…</p>;
  if (h.lines.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No rent changes yet.{" "}
        {h.current.cents !== null ? `The rent is the roster rent, ${formatCurrency(h.current.cents)}/month.` : "No rent is set on the roster."}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {h.lines.map((l) => (
        <li key={l.changeId} className="flex flex-col gap-0.5 px-3.5 py-2.5 text-[13px]">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-medium">From {formatMonth(l.effectiveMonth)}</span>
            <span className="tabular-nums">
              <span className="text-muted-foreground">{l.fromCents !== null ? formatCurrency(l.fromCents) : "none"} → </span>
              <b className="font-semibold">{formatCurrency(l.toCents)}</b>
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {l.byName} · {formatStamp(l.at)}
            {l.note ? ` · ${l.note}` : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}
