"use client";

import { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { Dialog } from "@/components/properties/dialog";
import { Btn, Field, Grid2, Input, LabeledField, Select, Toggle } from "@/components/ui";
import { UNIT_TYPES, type Manager } from "./types";

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

/** The asset manager defaults to the property's default; it can never be left empty. */
export function AddUnitModal({
  managers,
  defaultAmId,
  busy,
  onSubmit,
  onClose,
}: {
  managers: Manager[];
  defaultAmId?: Id<"users">;
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
  const [am, setAm] = useState<string>(defaultAmId ?? "");

  const ready = unitNumber.trim() !== "" && bedrooms !== "" && am !== "" && !busy;

  return (
    <Dialog title="Add unit" onClose={onClose}>
      <form
        className="space-y-4"
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
      >
        <Grid2>
          <LabeledField label="Unit number">
            {(id) => (
              <Input id={id} value={unitNumber} maxLength={40} placeholder="4B" onChange={(e) => setUnitNumber(e.target.value)} />
            )}
          </LabeledField>
          <LabeledField label="Unit type">
            {(id) => (
              <Select id={id} value={bedrooms} onChange={(e) => setBedrooms(e.target.value)}>
                <option value="" disabled>
                  Select unit type
                </option>
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
        <LabeledField
          label="Asset manager"
          hint={defaultAmId ? "Defaults to the property's asset manager." : "Every unit needs one asset manager."}
        >
          {(id) => (
            <Select id={id} value={am} onChange={(e) => setAm(e.target.value)}>
              <option value="" disabled>
                Select an asset manager
              </option>
              {managers.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
        </LabeledField>
        <Field label="Available to rent">
          <Toggle checked={available} onChange={setAvailable} label="Available to rent" />
        </Field>
        <div className="flex justify-end gap-2">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn type="submit" variant="pri" disabled={!ready}>
            {busy ? "Adding…" : "Add unit"}
          </Btn>
        </div>
      </form>
    </Dialog>
  );
}
