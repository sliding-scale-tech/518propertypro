"use client";

import { useMutation } from "convex/react";
import { useId, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { PropertyAdjustmentView } from "@/convex/rosBuild";
import { MAX_AMOUNT_CENTS, formatCurrency, parseDollarsToCents, parseSignedDollarsToCents } from "@/convex/rosFormat";
import { Btn, Field } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { MoneyInput, centsToInput, useFieldErrors } from "./form-bits";

/** Exact server messages (ownerStatements.setAdjustments, spec 5.4). */
const MSG = {
  earlyPaymentsCents: "Early payments can't be negative.",
  unpaidBillsCents: "Unpaid bills can't be negative.",
  propertyReserveCents: "The property reserve can't be negative.",
  invalid: "Enter the amount like 500.00.",
  tooBig: "The amount can't be more than $1,000,000.00.",
} as const;

type Key = "earlyPaymentsCents" | "unpaidBillsCents" | "propertyReserveCents";
const ORDER: readonly Key[] = ["propertyReserveCents", "unpaidBillsCents", "earlyPaymentsCents"];

/** Typed money -> cents | null (blank) | an error message. */
function readAdjustment(raw: string, key: Key): number | null | string {
  if (raw.trim() === "") return null;
  const cents = parseDollarsToCents(raw);
  if (cents === null) {
    const signed = parseSignedDollarsToCents(raw);
    return signed !== null && signed < 0 ? MSG[key] : MSG.invalid;
  }
  return cents > MAX_AMOUNT_CENTS ? MSG.tooBig : cents;
}

const savedOf = (p: PropertyAdjustmentView, k: Key): number =>
  k === "earlyPaymentsCents" ? p.earlyPaymentsCents : k === "unpaidBillsCents" ? p.unpaidBillsCents : p.propertyReserveCents;

/**
 * One property's adjustments on the Fees & payout step (spec 6.3 item 4): property reserve, unpaid
 * bills and early payments (ownerStatements.setAdjustments). Final statements show them read-only.
 * The parent keys it on the saved values so it re-seeds after a save or another tab's edit.
 */
export function AdjustmentsForm({
  statementId,
  p,
  readOnly,
}: {
  statementId: string;
  p: PropertyAdjustmentView;
  readOnly: boolean;
}) {
  const setAdjustments = useMutation(api.ownerStatements.setAdjustments);
  const [values, setValues] = useState<Record<Key, string>>({
    earlyPaymentsCents: centsToInput(p.earlyPaymentsCents),
    unpaidBillsCents: centsToInput(p.unpaidBillsCents),
    propertyReserveCents: centsToInput(p.propertyReserveCents),
  });
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(
    () => ({
      earlyPaymentsCents: `${base}-early`,
      unpaidBillsCents: `${base}-unpaid`,
      propertyReserveCents: `${base}-reserve`,
    }),
    [base],
  );
  const f = useFieldErrors(ids);
  const dirty = ORDER.some((k) => values[k] !== centsToInput(savedOf(p, k)));

  async function save() {
    if (busy) return;
    const parsed = {} as Record<Key, number | null>;
    const all: Record<string, string> = {};
    for (const k of ORDER) {
      const r = readAdjustment(values[k], k);
      if (typeof r === "string") all[k] = r;
      else parsed[k] = r;
    }
    if (!f.check(all, ORDER)) return;
    setBusy(true);
    try {
      // Blank early payments / unpaid bills = 0; a blank reserve goes back to the owner default.
      await setAdjustments({
        statementId,
        propertyId: p.propertyId,
        earlyPaymentsCents: parsed.earlyPaymentsCents,
        unpaidBillsCents: parsed.unpaidBillsCents,
        propertyReserveCents: parsed.propertyReserveCents,
      });
      toast.success(`Adjustments saved for ${p.name}.`);
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  const input = (k: Key, label: string, hint?: string) => (
    <Field label={label} htmlFor={readOnly ? undefined : ids[k]} hint={hint}>
      {readOnly ? (
        <div className="py-2 text-[13.5px] tabular-nums">{formatCurrency(savedOf(p, k))}</div>
      ) : (
        <>
          <MoneyInput
            id={ids[k]}
            value={values[k]}
            onChange={(v) => {
              setValues((s) => ({ ...s, [k]: v }));
              f.clear(k);
            }}
            invalid={!!f.errors[k]}
            describedBy={f.control(k)["aria-describedby"]}
          />
          {f.message(k)}
        </>
      )}
    </Field>
  );

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {input("propertyReserveCents", "Property reserve", `Owner default ${formatCurrency(p.propertyReserveDefaultCents)}.`)}
        {input("unpaidBillsCents", "Unpaid bills")}
        {input("earlyPaymentsCents", "Early payments")}
      </div>
      {!readOnly ? (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {dirty ? <span className="text-[12px] text-warning-ink">Not saved yet</span> : null}
          <Btn sm type="submit" variant={dirty ? "pri" : "default"} disabled={busy}>
            {busy ? "Saving…" : "Save adjustments"}
          </Btn>
        </div>
      ) : null}
    </form>
  );
}
