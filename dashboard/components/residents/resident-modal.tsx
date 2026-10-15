"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/properties/dialog";
import { Btn, DatePicker, Field, IconBtn, Input, LabeledField, Select } from "@/components/ui";

export type ResidentFormValue = {
  unitId: string;
  fullName: string;
  phones: string[];
  email: string;
  leaseEnd: string;
};

export type UnitOption = { id: string; label: string };

const E164 = /^\+[1-9]\d{6,14}$/;

/** Add / edit a resident. Phones must be E.164 (the server re-validates). */
export function ResidentModal({
  title,
  initial,
  unitOptions,
  busy,
  onSubmit,
  onClose,
}: {
  title: string;
  initial: ResidentFormValue;
  unitOptions: UnitOption[];
  busy: boolean;
  onSubmit: (v: ResidentFormValue) => void;
  onClose: () => void;
}) {
  const [unitId, setUnitId] = useState(initial.unitId);
  const [fullName, setFullName] = useState(initial.fullName);
  const [phones, setPhones] = useState<string[]>(initial.phones.length ? initial.phones : [""]);
  const [email, setEmail] = useState(initial.email);
  const [leaseEnd, setLeaseEnd] = useState(initial.leaseEnd);

  const cleaned = phones.map((p) => p.trim()).filter(Boolean);
  const phonesOk = cleaned.every((p) => E164.test(p)) && cleaned.length <= 5;
  const ready = unitId !== "" && fullName.trim() !== "" && phonesOk && !busy;

  return (
    <Dialog title={title} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) {
            onSubmit({ unitId, fullName: fullName.trim(), phones: cleaned, email: email.trim(), leaseEnd });
          }
        }}
      >
        <LabeledField label="Unit">
          {(id) => (
            <Select id={id} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value="" disabled>
                Select a unit
              </option>
              {unitOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </Select>
          )}
        </LabeledField>
        <LabeledField label="Full name">
          {(id) => <Input id={id} value={fullName} maxLength={120} onChange={(e) => setFullName(e.target.value)} />}
        </LabeledField>
        <Field
          label="Phone numbers"
          hint={<span className={phonesOk ? undefined : "text-danger-ink"}>E.164 format, e.g. +15185551234. Up to 5.</span>}
        >
          <div className="space-y-1.5">
            {phones.map((p, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={p}
                  inputMode="tel"
                  aria-label={`Phone ${i + 1}`}
                  placeholder="+15185551234"
                  onChange={(e) => setPhones(phones.map((x, j) => (j === i ? e.target.value : x)))}
                />
                {phones.length > 1 ? (
                  <IconBtn label="Remove phone" onClick={() => setPhones(phones.filter((_, j) => j !== i))}>
                    <X />
                  </IconBtn>
                ) : null}
              </div>
            ))}
            {phones.length < 5 ? (
              <button
                type="button"
                onClick={() => setPhones([...phones, ""])}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary"
              >
                <Plus className="h-3.5 w-3.5" />
                Add phone
              </button>
            ) : null}
          </div>
        </Field>
        <LabeledField label="Email (optional)">
          {(id) => <Input id={id} type="email" value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} />}
        </LabeledField>
        <LabeledField label="Lease end (optional)">
          {(id) => <DatePicker id={id} value={leaseEnd} onChange={setLeaseEnd} />}
        </LabeledField>
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
