"use client";

import { useState } from "react";
import type { PropertyAddress } from "@/convex/placesApi";
import { Field, btnOutline, btnPrimary, inputClass } from "@/components/maintenance/shared";
import { AddressField } from "./address-input";

export type PropertyFormValue = {
  name: string;
  address: PropertyAddress | null;
  isPilot: boolean;
  gasPhone: string;
};

/** Shared by the Add property modal and the profile editor. Gas phone must be E.164. */
export function PropertyForm({
  initial,
  submitLabel,
  busy,
  readOnly,
  onSubmit,
  onCancel,
}: {
  initial: PropertyFormValue;
  submitLabel: string;
  busy: boolean;
  readOnly?: boolean;
  onSubmit: (v: PropertyFormValue) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [address, setAddress] = useState<PropertyAddress | null>(initial.address);
  const [isPilot, setIsPilot] = useState(initial.isPilot);
  const [gasPhone, setGasPhone] = useState(initial.gasPhone);
  const phoneOk = gasPhone.trim() === "" || /^\+[1-9]\d{6,14}$/.test(gasPhone.trim());
  const ready = name.trim() !== "" && phoneOk && !busy && !readOnly;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSubmit({ name: name.trim(), address, isPilot, gasPhone: gasPhone.trim() });
      }}
    >
      <fieldset disabled={readOnly} className="space-y-4">
        <Field label="Property name">
          <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <AddressField value={address} onChange={setAddress} />
        <Field
          label="Gas utility phone"
          hint={phoneOk ? "E.164 format, e.g. +15185551234. Optional." : "Use E.164 format, e.g. +15185551234."}
        >
          <input
            value={gasPhone}
            inputMode="tel"
            onChange={(e) => setGasPhone(e.target.value)}
            placeholder="+15185551234"
            className={inputClass}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={isPilot}
            onChange={(e) => setIsPilot(e.target.checked)}
            className="h-4 w-4 accent-blue-600"
          />
          Pilot property
        </label>
      </fieldset>
      {readOnly ? null : (
        <div className="flex justify-end gap-2">
          {onCancel ? (
            <button type="button" className={btnOutline} onClick={onCancel}>
              Cancel
            </button>
          ) : null}
          <button type="submit" className={btnPrimary} disabled={!ready}>
            {busy ? "Saving…" : submitLabel}
          </button>
        </div>
      )}
    </form>
  );
}
