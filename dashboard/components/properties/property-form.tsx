"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { PropertyAddress } from "@/convex/placesApi";
import { MAX_OWNER_EMAILS, ownerEmailProblems } from "@/convex/ownerVerifyLib";
import { Btn, Field, Grid2, IconBtn, Input, LabeledField, Toggle, cx } from "@/components/ui";
import { useToast } from "@/components/toast";
import { AddressField } from "./address-input";

export type PropertyFormValue = {
  name: string;
  address: PropertyAddress | null;
  isPilot: boolean;
  gasPhone: string;
  ownerName: string;
  /** Every owner email, in order. The first is also the property's ownerEmail. */
  ownerEmails: string[];
};

/**
 * Shared by the Add property dialog and the property page's Edit dialogs. Gas phone must be E.164.
 * `section` shows only part of the form (the property page edits the profile and the owner details
 * in separate focused dialogs); the fields it hides keep their initial values, so a save sends the
 * same full value either way.
 */
export function PropertyForm({
  initial,
  submitLabel,
  busy,
  readOnly,
  showOwner = true,
  section = "all",
  onSubmit,
  onCancel,
}: {
  initial: PropertyFormValue;
  submitLabel: string;
  busy: boolean;
  readOnly?: boolean;
  showOwner?: boolean;
  /** "profile" = name, gas phone, address, pilot; "owner" = owner name and emails; "all" = both. */
  section?: "all" | "profile" | "owner";
  onSubmit: (v: PropertyFormValue) => void;
  onCancel?: () => void;
}) {
  const profileShown = section !== "owner";
  const ownerShown = showOwner && section !== "profile";
  const [name, setName] = useState(initial.name);
  const [address, setAddress] = useState<PropertyAddress | null>(initial.address);
  const [isPilot, setIsPilot] = useState(initial.isPilot);
  const [gasPhone, setGasPhone] = useState(initial.gasPhone);
  const [ownerName, setOwnerName] = useState(initial.ownerName);
  const [ownerEmails, setOwnerEmails] = useState<string[]>(initial.ownerEmails.length ? initial.ownerEmails : [""]);
  const [checked, setChecked] = useState(false);
  const toast = useToast();
  const phoneOk = gasPhone.trim() === "" || /^\+[1-9]\d{6,14}$/.test(gasPhone.trim());
  const emailProblems = ownerShown ? ownerEmailProblems(ownerEmails) : [];
  const emailError = (i: number) => (checked ? emailProblems.find((p) => p.index === i)?.message : undefined);
  // Same messages as the server (properties.cleanName / phone.requireE164 wording).
  // Only the fields shown in this dialog are checked (an owner-details save is not blocked by the profile fields).
  const nameBad = profileShown && name.trim() === "";
  const phoneBad = profileShown && !phoneOk;
  const nameError = checked && nameBad ? "Enter a property name." : undefined;
  const phoneError = checked && phoneBad ? "Use E.164 format for the gas phone, e.g. +15185551234." : undefined;
  const ready = !busy && !readOnly;
  const setEmail = (i: number, v: string) => setOwnerEmails((l) => l.map((x, k) => (k === i ? v : x)));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        // Every wrong field is marked (red border + message); the first one is toasted.
        const first =
          nameBad
            ? "Enter a property name."
            : phoneBad
              ? "Use E.164 format for the gas phone, e.g. +15185551234."
              : // Same rule set as the server (ownerVerifyLib.ownerEmailProblems): name the row that is wrong.
                emailProblems[0]?.message;
        if (first) {
          setChecked(true);
          toast(first, "error");
          return;
        }
        onSubmit({
          name: name.trim(),
          address,
          isPilot,
          gasPhone: gasPhone.trim(),
          ownerName: ownerName.trim(),
          ownerEmails: ownerEmails.map((x) => x.trim()).filter(Boolean),
        });
      }}
    >
      <fieldset disabled={readOnly} className="space-y-4">
        {profileShown ? (
        <>
        <Grid2>
          <LabeledField label="Property name *">
            {(id) => (
              <>
                <Input
                  id={id}
                  value={name}
                  maxLength={120}
                  aria-invalid={!!nameError}
                  className={cx(nameError && "!border-danger-ink")}
                  onChange={(e) => setName(e.target.value)}
                />
                {nameError ? <p className="mt-1 text-xs text-danger-ink">{nameError}</p> : null}
              </>
            )}
          </LabeledField>
          <LabeledField label="Gas utility phone" hint="E.164 format, e.g. +15185551234. Optional.">
            {(id) => (
              <>
                <Input
                  id={id}
                  value={gasPhone}
                  inputMode="tel"
                  aria-invalid={!!phoneError}
                  className={cx(phoneError && "!border-danger-ink")}
                  onChange={(e) => setGasPhone(e.target.value)}
                  placeholder="+15185551234"
                />
                {phoneError ? <p className="mt-1 text-xs text-danger-ink">{phoneError}</p> : null}
              </>
            )}
          </LabeledField>
        </Grid2>
        <AddressField value={address} onChange={setAddress} />
        </>
        ) : null}
        {ownerShown ? (
          <>
            <LabeledField label="Owner name" hint="Display only.">
              {(id) => (
                <Input id={id} value={ownerName} maxLength={120} onChange={(e) => setOwnerName(e.target.value)} />
              )}
            </LabeledField>
            <Field
              label="Owner emails"
              hint="Sarah verifies an owner who calls by one of these before putting them through to staff. Owners never hear them."
            >
              <div className="space-y-2">
                {ownerEmails.map((email, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-2">
                      <Input
                        type="email"
                        aria-label={`Owner email ${i + 1}`}
                        aria-invalid={!!emailError(i)}
                        value={email}
                        maxLength={200}
                        autoComplete="off"
                        placeholder="name@example.com"
                        onChange={(e) => setEmail(i, e.target.value)}
                        className={cx(emailError(i) && "border-danger-ink")}
                      />
                      {!readOnly && ownerEmails.length > 1 ? (
                        <IconBtn label={`Remove owner email ${i + 1}`} onClick={() => setOwnerEmails((l) => l.filter((_, k) => k !== i))}>
                          <Trash2 />
                        </IconBtn>
                      ) : null}
                    </div>
                    {emailError(i) ? <p className="mt-1 text-xs text-danger-ink">{emailError(i)}</p> : null}
                  </div>
                ))}
                {!readOnly && ownerEmails.length < MAX_OWNER_EMAILS ? (
                  <Btn sm onClick={() => setOwnerEmails((l) => [...l, ""])}>
                    <Plus className="h-3.5 w-3.5" /> Add owner email
                  </Btn>
                ) : null}
              </div>
            </Field>
          </>
        ) : null}
        {profileShown ? (
          <Field label="Pilot property">
            <Toggle checked={isPilot} onChange={setIsPilot} label="Pilot property" disabled={readOnly} />
          </Field>
        ) : null}
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
