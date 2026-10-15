"use client";

import { useState } from "react";
import type { PropertyAddress } from "@/convex/placesApi";
import { Btn, Field, Grid2, Input, LabeledField, Toggle } from "@/components/ui";
import { AddressField } from "./address-input";

export type PropertyFormValue = {
  name: string;
  address: PropertyAddress | null;
  isPilot: boolean;
  gasPhone: string;
  ownerName: string;
  ownerEmail: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Shared by the Add property dialog and the profile card. Gas phone must be E.164. */
export function PropertyForm({
  initial,
  submitLabel,
  busy,
  readOnly,
  showOwner = true,
  onSubmit,
  onCancel,
}: {
  initial: PropertyFormValue;
  submitLabel: string;
  busy: boolean;
  readOnly?: boolean;
  showOwner?: boolean;
  onSubmit: (v: PropertyFormValue) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [address, setAddress] = useState<PropertyAddress | null>(initial.address);
  const [isPilot, setIsPilot] = useState(initial.isPilot);
  const [gasPhone, setGasPhone] = useState(initial.gasPhone);
  const [ownerName, setOwnerName] = useState(initial.ownerName);
  const [ownerEmail, setOwnerEmail] = useState(initial.ownerEmail);
  const phoneOk = gasPhone.trim() === "" || /^\+[1-9]\d{6,14}$/.test(gasPhone.trim());
  const emailOk = ownerEmail.trim() === "" || EMAIL.test(ownerEmail.trim());
  const ready = name.trim() !== "" && phoneOk && emailOk && !busy && !readOnly;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) {
          onSubmit({
            name: name.trim(),
            address,
            isPilot,
            gasPhone: gasPhone.trim(),
            ownerName: ownerName.trim(),
            ownerEmail: ownerEmail.trim(),
          });
        }
      }}
    >
      <fieldset disabled={readOnly} className="space-y-4">
        <Grid2>
          <LabeledField label="Property name">
            {(id) => <Input id={id} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />}
          </LabeledField>
          <LabeledField
            label="Gas utility phone"
            hint={phoneOk ? "E.164 format, e.g. +15185551234. Optional." : "Use E.164 format, e.g. +15185551234."}
          >
            {(id) => (
              <Input
                id={id}
                value={gasPhone}
                inputMode="tel"
                onChange={(e) => setGasPhone(e.target.value)}
                placeholder="+15185551234"
              />
            )}
          </LabeledField>
        </Grid2>
        <AddressField value={address} onChange={setAddress} />
        {showOwner ? (
          <Grid2>
            <LabeledField label="Owner name" hint="Display only.">
              {(id) => (
                <Input id={id} value={ownerName} maxLength={120} onChange={(e) => setOwnerName(e.target.value)} />
              )}
            </LabeledField>
            <LabeledField label="Owner email" hint={emailOk ? "Display only." : "Enter a valid email."}>
              {(id) => (
                <Input
                  id={id}
                  type="email"
                  value={ownerEmail}
                  maxLength={200}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                />
              )}
            </LabeledField>
          </Grid2>
        ) : null}
        <Field label="Pilot property">
          <Toggle checked={isPilot} onChange={setIsPilot} label="Pilot property" disabled={readOnly} />
        </Field>
      </fieldset>
      {readOnly ? null : (
        <div className="flex justify-end gap-2">
          {onCancel ? <Btn onClick={onCancel}>Cancel</Btn> : null}
          <Btn type="submit" variant="pri" disabled={!ready}>
            {busy ? "Saving…" : submitLabel}
          </Btn>
        </div>
      )}
    </form>
  );
}
