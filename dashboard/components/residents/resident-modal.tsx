"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Field, Modal, btnOutline, btnPrimary, inputClass } from "@/components/maintenance/shared";

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
    <Modal title={title} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) {
            onSubmit({ unitId, fullName: fullName.trim(), phones: cleaned, email: email.trim(), leaseEnd });
          }
        }}
      >
        <Field label="Unit">
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className={inputClass}>
            <option value="" disabled>
              Select a unit
            </option>
            {unitOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Full name">
          <input value={fullName} maxLength={120} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
        </Field>
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Phone numbers</span>
          {phones.map((p, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={p}
                inputMode="tel"
                aria-label={`Phone ${i + 1}`}
                placeholder="+15185551234"
                onChange={(e) => setPhones(phones.map((x, j) => (j === i ? e.target.value : x)))}
                className={inputClass}
              />
              {phones.length > 1 ? (
                <button
                  type="button"
                  aria-label="Remove phone"
                  onClick={() => setPhones(phones.filter((_, j) => j !== i))}
                  className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          ))}
          <p className={`text-[11px] ${phonesOk ? "text-muted-foreground" : "text-destructive"}`}>
            E.164 format, e.g. +15185551234. Up to 5.
          </p>
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
        <Field label="Email (optional)">
          <input type="email" value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Lease end (optional)">
          <input type="date" value={leaseEnd} onChange={(e) => setLeaseEnd(e.target.value)} className={inputClass} />
        </Field>
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
