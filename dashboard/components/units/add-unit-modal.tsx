"use client";

import { X } from "lucide-react";
import { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { AmSelect } from "./am-select";
import { inputClass, UNIT_TYPES, type Manager } from "./types";

export type NewUnit = {
  unitNumber: string;
  assetManagerUserId: Id<"users">;
  bedrooms: string;
  floor?: number;
  bathrooms?: number;
  rent?: number;
  available: boolean;
};

const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? undefined : Number(s));

export function AddUnitModal({
  managers,
  busy,
  onSubmit,
  onClose,
}: {
  managers: Manager[];
  busy: boolean;
  onSubmit: (unit: NewUnit) => void;
  onClose: () => void;
}) {
  const [unitNumber, setUnitNumber] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [floor, setFloor] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [rent, setRent] = useState("");
  const [available, setAvailable] = useState(false);
  const [am, setAm] = useState("");

  // The asset manager is required: the button stays off until one is picked.
  const ready = unitNumber.trim() !== "" && bedrooms !== "" && am !== "" && !busy;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/45 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Add unit"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          onSubmit({
            unitNumber: unitNumber.trim(),
            assetManagerUserId: am as Id<"users">,
            bedrooms,
            floor: num(floor),
            bathrooms: num(bathrooms),
            rent: num(rent),
            available,
          });
        }}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-bold">Add unit</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-5">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Unit number</span>
            <input
              value={unitNumber}
              maxLength={40}
              onChange={(e) => setUnitNumber(e.target.value)}
              className={inputClass}
              placeholder="4B"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Unit type</span>
            <select value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} className={inputClass}>
              <option value="" disabled>
                Select unit type
              </option>
              {UNIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label>
              <span className="mb-1.5 block text-sm font-medium">Floor</span>
              <input type="number" value={floor} onChange={(e) => setFloor(e.target.value)} className={inputClass} />
            </label>
            <label>
              <span className="mb-1.5 block text-sm font-medium">Baths</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={bathrooms}
                onChange={(e) => setBathrooms(e.target.value)}
                className={inputClass}
              />
            </label>
            <label>
              <span className="mb-1.5 block text-sm font-medium">Rent</span>
              <input
                type="number"
                min={0}
                value={rent}
                onChange={(e) => setRent(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={available}
              onChange={(e) => setAvailable(e.target.checked)}
              className="h-4 w-4 accent-blue-600"
            />
            Available to rent
          </label>
          <div>
            <span className="mb-1.5 block text-sm font-medium">
              Asset manager <span className="text-destructive">*</span>
            </span>
            <AmSelect
              managers={managers}
              value={am}
              onChange={setAm}
              label="Asset manager"
              placeholder="Select an asset manager"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-muted/30 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-input bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!ready}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Adding…" : "Add unit"}
          </button>
        </div>
      </form>
    </div>
  );
}
