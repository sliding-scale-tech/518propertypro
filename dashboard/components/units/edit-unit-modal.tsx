"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { validateUnitForm } from "@/convex/unitFieldsPolicy";
import { Btn, Field, Grid2, Input, Select } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { useFieldErrors } from "@/components/finance/form-bits";
import { UNIT_TYPES, type UnitRow } from "./types";

export type UnitPatch = {
  unitNumber: string;
  bedrooms: string;
  floor?: number;
  bathrooms?: number;
};

const ORDER = ["unitNumber", "bedrooms", "floor", "bathrooms"] as const;

/**
 * Edit a unit's number, type, floor and baths (units.update). The asset manager is not editable here
 * (only the inventory's select changes it), and neither is the rent: it has a history with an
 * effective month per change, so it changes only through Change rent (`rent` shows it read-only with
 * the button). Numbers are parsed strictly (unitFieldsPolicy): a wrong value is marked red with its
 * message and toasted, never sent as NaN or dropped silently.
 */
export function UnitEditForm({
  unit,
  rent,
  onSave,
  onDone,
  onCancel,
}: {
  unit: UnitRow;
  /** The read-only rent line ("Rent $1,250.00/month (from November 2026)") and its Change rent button. */
  rent?: ReactNode;
  /** Saves the patch; throws on a server error (the form marks the field and toasts it). */
  onSave: (patch: UnitPatch) => Promise<unknown>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [unitNumber, setUnitNumber] = useState(unit.unitNumber);
  const [bedrooms, setBedrooms] = useState(unit.bedrooms);
  const [floor, setFloor] = useState(unit.floor?.toString() ?? "");
  const [bathrooms, setBathrooms] = useState(unit.bathrooms?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(
    () => ({ unitNumber: `${base}-num`, bedrooms: `${base}-type`, floor: `${base}-floor`, bathrooms: `${base}-baths` }),
    [base],
  );
  const f = useFieldErrors(ids);

  async function submit() {
    if (busy) return;
    // Untouched floor / baths (even an odd legacy value like 1.25) are neither checked nor sent.
    const { errors, value } = validateUnitForm(
      { unitNumber, bedrooms, floor, bathrooms },
      {
        floor: floor.trim() === (unit.floor?.toString() ?? ""),
        bathrooms: bathrooms.trim() === (unit.bathrooms?.toString() ?? ""),
      },
    );
    if (!f.check(errors, ORDER) || !value) return;
    setBusy(true);
    try {
      await onSave(value);
      toast.success("Unit updated");
      onDone();
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  const edit = (field: string, set: (v: string) => void) => (v: string) => {
    set(v);
    f.clear(field);
  };

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Grid2>
        <Field label="Unit number *" htmlFor={ids.unitNumber}>
          <Input
            id={ids.unitNumber}
            value={unitNumber}
            maxLength={40}
            onChange={(e) => edit("unitNumber", setUnitNumber)(e.target.value)}
            {...f.control("unitNumber")}
          />
          {f.message("unitNumber")}
        </Field>
        <Field label="Unit type *" htmlFor={ids.bedrooms}>
          <Select id={ids.bedrooms} value={bedrooms} onChange={(e) => edit("bedrooms", setBedrooms)(e.target.value || "")} {...f.control("bedrooms")}>
            <option value="">Select unit type</option>
            {bedrooms && !(UNIT_TYPES as readonly string[]).includes(bedrooms) ? <option value={bedrooms}>{bedrooms}</option> : null}
            {UNIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          {f.message("bedrooms")}
        </Field>
      </Grid2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Floor" htmlFor={ids.floor} hint="Whole number; 0 for the basement.">
          <Input id={ids.floor} inputMode="numeric" value={floor} onChange={(e) => edit("floor", setFloor)(e.target.value)} {...f.control("floor")} />
          {f.message("floor")}
        </Field>
        <Field label="Baths" htmlFor={ids.bathrooms} hint="Like 1 or 1.5.">
          <Input
            id={ids.bathrooms}
            inputMode="decimal"
            value={bathrooms}
            onChange={(e) => edit("bathrooms", setBathrooms)(e.target.value)}
            {...f.control("bathrooms")}
          />
          {f.message("bathrooms")}
        </Field>
      </div>
      {rent ? <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-3">{rent}</div> : null}
      <div className="flex justify-end gap-2">
        <Btn onClick={onCancel} disabled={busy}>
          Cancel
        </Btn>
        <Btn type="submit" variant="pri" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Btn>
      </div>
    </form>
  );
}
