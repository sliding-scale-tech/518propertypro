"use client";

import { useState } from "react";
import { Dialog } from "@/components/properties/dialog";
import { Btn, Grid2, Input, LabeledField, Select } from "@/components/ui";
import { UNIT_TYPES, type UnitRow } from "./types";

export type UnitPatch = {
  unitNumber: string;
  bedrooms: string;
  floor?: number;
  bathrooms?: number;
  rent?: number;
};

const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? undefined : Number(s));

/** The asset manager is not editable here: only the inventory's select changes it. */
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
    <Dialog title={`Edit unit ${unit.unitNumber}`} onClose={onClose}>
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
        <Grid2>
          <LabeledField label="Unit number">
            {(id) => <Input id={id} value={unitNumber} maxLength={40} onChange={(e) => setUnitNumber(e.target.value)} />}
          </LabeledField>
          <LabeledField label="Unit type">
            {(id) => (
              <Select id={id} value={bedrooms} onChange={(e) => setBedrooms(e.target.value)}>
                {!(UNIT_TYPES as readonly string[]).includes(bedrooms) ? <option value={bedrooms}>{bedrooms}</option> : null}
                {UNIT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            )}
          </LabeledField>
        </Grid2>
        <div className="grid grid-cols-3 gap-3">
          <LabeledField label="Floor">
            {(id) => <Input id={id} type="number" value={floor} onChange={(e) => setFloor(e.target.value)} />}
          </LabeledField>
          <LabeledField label="Baths">
            {(id) => (
              <Input id={id} type="number" min={0} step={0.5} value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} />
            )}
          </LabeledField>
          <LabeledField label="Rent">
            {(id) => <Input id={id} type="number" min={0} value={rent} onChange={(e) => setRent(e.target.value)} />}
          </LabeledField>
        </div>
        <div className="flex justify-end gap-2">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn type="submit" variant="pri" disabled={!ready}>
            {busy ? "Saving…" : "Save"}
          </Btn>
        </div>
      </form>
    </Dialog>
  );
}
