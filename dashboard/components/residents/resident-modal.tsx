"use client";

import { Plus, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Dialog } from "@/components/properties/dialog";
import { LEASE_MSG, MAX_PHONES, cleanPhoneList, emailProblem, isRealDate, type FieldErrors } from "@/convex/leaseLib";
import { Btn, DatePicker, Field, IconBtn, Input, Select } from "@/components/ui";
import { useFieldErrors } from "@/components/finance/form-bits";

export type ResidentFormValue = {
  unitId: string;
  fullName: string;
  phones: string[];
  email: string;
  leaseEnd: string;
};

export type UnitOption = { id: string; label: string };

const ORDER = ["unitId", "fullName", "phones", "phone0", "phone1", "phone2", "phone3", "phone4", "email", "leaseEnd"] as const;

export const RESIDENT_FORM_MSG = {
  unitMissing: "Select the unit this resident lives in.",
  nameMissing: "Enter the resident's full name.",
  nameLong: "Keep the name under 120 characters.",
} as const;

/** Every failing field of the Add / Edit resident form (field -> message). Phones are cleaned to E.164. */
function validate(v: { unitId: string; fullName: string; phones: string[]; email: string; leaseEnd: string }): {
  errors: FieldErrors;
  phones: string[];
} {
  const errors: FieldErrors = {};
  if (!v.unitId.trim()) errors.unitId = RESIDENT_FORM_MSG.unitMissing;
  const name = v.fullName.trim();
  if (!name) errors.fullName = RESIDENT_FORM_MSG.nameMissing;
  else if (name.length > 120) errors.fullName = RESIDENT_FORM_MSG.nameLong;
  const phones = cleanPhoneList(v.phones);
  Object.assign(errors, phones.errors);
  const email = emailProblem(v.email);
  if (email) errors.email = email;
  if (v.leaseEnd.trim() && !isRealDate(v.leaseEnd.trim())) errors.leaseEnd = LEASE_MSG.leaseEndInvalid;
  return { errors, phones: phones.phones };
}

/**
 * Add / edit a resident. Validates every field before it submits (red border + message under the
 * field, the first one toasted); phones may be typed as 10 digits and are sent as E.164. The server
 * re-validates. `unitOptions` is already limited to the units the viewer may add residents to (an
 * asset manager: the units they manage).
 */
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
  const base = useId();
  const ids = useMemo(() => {
    const m: Record<string, string> = {};
    for (const k of ORDER) m[k] = `${base}-${k}`;
    return m;
  }, [base]);
  const f = useFieldErrors(ids);

  function submit() {
    if (busy) return;
    const { errors, phones: cleaned } = validate({ unitId, fullName, phones, email, leaseEnd });
    if (!f.check(errors, ORDER)) return;
    onSubmit({ unitId, fullName: fullName.trim(), phones: cleaned, email: email.trim(), leaseEnd: leaseEnd.trim() });
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Unit *" htmlFor={ids.unitId}>
          <Select
            id={ids.unitId}
            value={unitId}
            onChange={(e) => {
              setUnitId(e.target.value ?? "");
              f.clear("unitId");
            }}
            {...f.control("unitId")}
          >
            <option value="">Select a unit</option>
            {unitOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </Select>
          {unitOptions.length === 0 ? <p className="text-xs text-muted-foreground">No units you can add residents to.</p> : null}
          {f.message("unitId")}
        </Field>
        <Field label="Full name *" htmlFor={ids.fullName}>
          <Input
            id={ids.fullName}
            value={fullName}
            maxLength={120}
            onChange={(e) => {
              setFullName(e.target.value);
              f.clear("fullName");
            }}
            {...f.control("fullName")}
          />
          {f.message("fullName")}
        </Field>
        <Field label="Phone numbers" hint="Optional. 10 digits, like (518) 555-1234. Up to 5." htmlFor={ids.phone0}>
          <div className="space-y-1.5">
            {phones.map((p, i) => (
              <div key={i}>
                <div className="flex gap-2">
                  <Input
                    id={ids[`phone${i}`]}
                    value={p}
                    inputMode="tel"
                    aria-label={`Phone ${i + 1}`}
                    placeholder="(518) 555-1234"
                    onChange={(e) => {
                      setPhones(phones.map((x, j) => (j === i ? e.target.value : x)));
                      f.clear(`phone${i}`);
                    }}
                    {...f.control(`phone${i}`)}
                  />
                  {phones.length > 1 ? (
                    <IconBtn
                      label={`Remove phone ${i + 1}`}
                      onClick={() => {
                        setPhones(phones.filter((_, j) => j !== i));
                        f.setErrors({});
                      }}
                    >
                      <X />
                    </IconBtn>
                  ) : null}
                </div>
                {f.message(`phone${i}`)}
              </div>
            ))}
            {f.message("phones")}
            {phones.length < MAX_PHONES ? (
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
        <Field label="Email" hint="Optional." htmlFor={ids.email}>
          <Input
            id={ids.email}
            type="email"
            value={email}
            maxLength={200}
            onChange={(e) => {
              setEmail(e.target.value);
              f.clear("email");
            }}
            {...f.control("email")}
          />
          {f.message("email")}
        </Field>
        <Field label="Lease end" hint="Optional." htmlFor={ids.leaseEnd}>
          <DatePicker
            id={ids.leaseEnd}
            value={leaseEnd}
            onChange={(v) => {
              setLeaseEnd(v);
              f.clear("leaseEnd");
            }}
            {...f.control("leaseEnd")}
          />
          {f.message("leaseEnd")}
        </Field>
        <div className="flex justify-end gap-2">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn type="submit" variant="pri" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Btn>
        </div>
      </form>
    </Dialog>
  );
}
