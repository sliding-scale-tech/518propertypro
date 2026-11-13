"use client";

import { useId, useMemo, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { validateUnitForm } from "@/convex/unitFieldsPolicy";
import { Dialog } from "@/components/properties/dialog";
import { Btn, Field, Grid2, Input, Select, Toggle } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { MoneyInput, useFieldErrors } from "@/components/finance/form-bits";
import { UNIT_TYPES, type Manager } from "./types";

export type NewUnit = {
  unitNumber: string;
  assetManagerUserId: Id<"users">;
  bedrooms: string;
  floor?: number;
  bathrooms?: number;
  /** DOLLARS (units.rent), parsed from the typed text via integer cents. */
  rent?: number;
  available: boolean;
};

const ORDER = ["unitNumber", "bedrooms", "floor", "bathrooms", "rent", "assetManagerUserId"] as const;

/**
 * The asset manager defaults to the property's default; it can never be left empty. Every field is
 * checked before saving (unitFieldsPolicy, the same rules as the server): the wrong field is marked
 * red with its message and the first one is toasted.
 */
export function AddUnitModal({
  managers,
  defaultAmId,
  onSave,
  onClose,
}: {
  managers: Manager[];
  defaultAmId?: Id<"users">;
  /** Saves the unit; throws on a server error (the form marks the field and toasts it). */
  onSave: (unit: NewUnit) => Promise<unknown>;
  onClose: () => void;
}) {
  const [unitNumber, setUnitNumber] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [floor, setFloor] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [rent, setRent] = useState("");
  const [available, setAvailable] = useState(false);
  const [am, setAm] = useState<string>(defaultAmId ?? "");
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(
    () => ({
      unitNumber: `${base}-num`,
      bedrooms: `${base}-type`,
      floor: `${base}-floor`,
      bathrooms: `${base}-baths`,
      rent: `${base}-rent`,
      assetManagerUserId: `${base}-am`,
    }),
    [base],
  );
  const f = useFieldErrors(ids);
  const edit = (field: string, set: (v: string) => void) => (v: string) => {
    set(v);
    f.clear(field);
  };

  async function submit() {
    if (busy) return;
    const { errors, value } = validateUnitForm({ unitNumber, bedrooms, floor, bathrooms, rent, assetManagerUserId: am });
    if (!f.check(errors, ORDER) || !value) return;
    setBusy(true);
    try {
      await onSave({ ...value, assetManagerUserId: am as Id<"users">, available });
      toast.success("Unit added");
      onClose();
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Add unit" onClose={onClose}>
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
              placeholder="4B"
              onChange={(e) => edit("unitNumber", setUnitNumber)(e.target.value)}
              {...f.control("unitNumber")}
            />
            {f.message("unitNumber")}
          </Field>
          <Field label="Unit type *" htmlFor={ids.bedrooms}>
            <Select id={ids.bedrooms} value={bedrooms} onChange={(e) => edit("bedrooms", setBedrooms)(e.target.value || "")} {...f.control("bedrooms")}>
              <option value="">Select unit type</option>
              {UNIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            {f.message("bedrooms")}
          </Field>
        </Grid2>
        <div className="grid gap-3 sm:grid-cols-3">
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
          <Field label="Rent / month" htmlFor={ids.rent} hint="Optional. Later changes use Change rent.">
            <MoneyInput
              id={ids.rent}
              value={rent}
              onChange={edit("rent", setRent)}
              invalid={Boolean(f.errors.rent)}
              describedBy={f.errors.rent ? `${ids.rent}-err` : undefined}
            />
            {f.message("rent")}
          </Field>
        </div>
        <Field
          label="Asset manager *"
          htmlFor={ids.assetManagerUserId}
          hint={defaultAmId ? "Defaults to the property's asset manager." : "Every unit needs one asset manager."}
        >
          <Select
            id={ids.assetManagerUserId}
            value={am}
            onChange={(e) => edit("assetManagerUserId", setAm)(e.target.value || "")}
            {...f.control("assetManagerUserId")}
          >
            <option value="">Select an asset manager</option>
            {managers.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
          {f.message("assetManagerUserId")}
        </Field>
        <Field label="Available to rent">
          <Toggle checked={available} onChange={setAvailable} label="Available to rent" />
        </Field>
        <div className="flex justify-end gap-2">
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn type="submit" variant="pri" disabled={busy}>
            {busy ? "Adding…" : "Add unit"}
          </Btn>
        </div>
      </form>
    </Dialog>
  );
}
