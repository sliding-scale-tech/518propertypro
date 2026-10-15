"use client";

import { useState } from "react";
import { Field, Modal, btnOutline, btnPrimary } from "@/components/maintenance/shared";
import { inputClass, UNIT_TYPES, type UnitRow } from "./types";

export type UnitPatch = {
  unitNumber: string;
  bedrooms: string;
  floor?: number;
  bathrooms?: number;
  rent?: number;
};

const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? undefined : Number(s));

/** The asset manager is not editable here: only the assign control changes it. */
export function EditUnitModal({
  unit,
  busy,
  onSubmit,
  onClose,
}: {
  unit: UnitRow;
  busy: boolean;
  onSubmit: (patch: UnitPatch) => void;
  onClose: () => void;
}) {
  const [unitNumber, setUnitNumber] = useState(unit.unitNumber);
  const [bedrooms, setBedrooms] = useState(unit.bedrooms);
  const [floor, setFloor] = useState(unit.floor?.toString() ?? "");
  const [bathrooms, setBathrooms] = useState(unit.bathrooms?.toString() ?? "");
  const [rent, setRent] = useState(unit.rent?.toString() ?? "");
  const ready = unitNumber.trim() !== "" && bedrooms !== "" && !busy;

  return (
    <Modal title={`Edit unit ${unit.unitNumber}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          onSubmit({
            unitNumber: unitNumber.trim(),
            bedrooms,
            floor: num(floor),
            bathrooms: num(bathrooms),
            rent: num(rent),
          });
        }}
      >
        <Field label="Unit number">
          <input value={unitNumber} maxLength={40} onChange={(e) => setUnitNumber(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Unit type">
          <select value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} className={inputClass}>
            {!(UNIT_TYPES as readonly string[]).includes(bedrooms) ? <option value={bedrooms}>{bedrooms}</option> : null}
            {UNIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Floor">
            <input type="number" value={floor} onChange={(e) => setFloor(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Baths">
            <input type="number" min={0} step={0.5} value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Rent">
            <input type="number" min={0} value={rent} onChange={(e) => setRent(e.target.value)} className={inputClass} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnOutline} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={!ready}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
