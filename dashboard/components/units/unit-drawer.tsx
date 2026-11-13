"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { History, Pencil } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { formatCurrency, formatMonth } from "@/convex/rosFormat";
import { LEASE_TYPE_LABEL, OCCUPANCY_LABEL, RENT_PAID_TO_LABEL } from "@/convex/unitEditLib";
import { Btn, Drawer, DrawerSection, KeyValue, Pill } from "@/components/ui";
import { formatStamp } from "@/components/finance/months";
import type { Manager, UnitRow } from "./types";
import { UnitHistory } from "./unit-history";

/** One row of units.rentSummary: the unit's rent THIS month (rent history, else roster) and its next change. */
export type UnitRentNow = FunctionReturnType<typeof api.units.rentSummary>[number];

const label = (map: Record<string, string>, v: string) => map[v] ?? v;

/**
 * The unit drawer (whole-row click on the property's unit table): a read-only summary (rent now,
 * details, rent history, asset manager history) and ONE action, Edit unit, which opens the B45
 * Edit unit dialog (every change, one Save). Who sees what follows the server: Edit unit for anyone
 * who may change some part of the unit (`canEdit`), the rent history for admin + accountant, the
 * asset manager history for the admin view.
 */
export function UnitDrawer({
  unit,
  propertyName,
  tenants,
  rent,
  managers,
  canEdit,
  canRentHistory,
  canHistory,
  onEdit,
  onClose,
}: {
  unit: UnitRow;
  propertyName: string;
  tenants: string[];
  rent: UnitRentNow | undefined;
  managers: Manager[];
  canEdit: boolean;
  canRentHistory: boolean;
  canHistory: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const occupied = tenants.length > 0;

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
      title={`Unit ${unit.unitNumber}`}
    >
      <>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Btn sm onClick={onEdit}>
                <Pencil aria-hidden className="h-3.5 w-3.5" />
                Edit unit
              </Btn>
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
                ...(unit.occupancy ? [{ label: "Roster", value: label(OCCUPANCY_LABEL, unit.occupancy) }] : []),
                ...(unit.leaseType ? [{ label: "Lease", value: `${label(LEASE_TYPE_LABEL, unit.leaseType)}${unit.leaseEnd ? `, ends ${unit.leaseEnd}` : ""}` }] : []),
                ...(unit.rentPaidTo ? [{ label: "Rent paid", value: label(RENT_PAID_TO_LABEL, unit.rentPaidTo) }] : []),
              ]}
            />
          </DrawerSection>

          {canRentHistory ? (
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
