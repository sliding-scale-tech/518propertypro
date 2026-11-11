"use client";

import { useMutation } from "convex/react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { PropertyAdjustmentView } from "@/convex/rosBuild";
import { MAX_AMOUNT_CENTS, formatBps, formatCurrency, parseDollarsToCents, parseSignedDollarsToCents } from "@/convex/rosFormat";
import { Btn, Card, CardHead, Field } from "@/components/ui";
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
const ORDER: readonly Key[] = ["earlyPaymentsCents", "propertyReserveCents", "unpaidBillsCents"];

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

/**
 * Adjustments card (spec 6.3 item 4): per property, the security deposits (read-only, from the
 * units), early payments, property reserve and unpaid bills. Final statements show them read-only.
 */
export function AdjustmentsCard({
  statementId,
  ownerId,
  properties,
  readOnly,
}: {
  statementId: string;
  ownerId: string;
  properties: PropertyAdjustmentView[];
  readOnly: boolean;
}) {
  return (
    <Card>
      <CardHead
        title="Adjustments"
        hint="These change Available for payment on the summary, not the cash balance."
      />
      <div className="flex flex-col gap-4">
        {properties.map((p) => (
          <PropertyAdjustments
            // Re-seed the inputs when the saved values change (after a save or another tab's edit).
            key={`${p.propertyId}:${p.earlyPaymentsCents}:${p.unpaidBillsCents}:${p.propertyReserveCents}`}
            statementId={statementId}
            ownerId={ownerId}
            p={p}
            readOnly={readOnly}
            showName={properties.length > 1}
          />
        ))}
      </div>
    </Card>
  );
}

function PropertyAdjustments({
  statementId,
  ownerId,
  p,
  readOnly,
  showName,
}: {
  statementId: string;
  ownerId: string;
  p: PropertyAdjustmentView;
  readOnly: boolean;
  showName: boolean;
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
      toast.success("Adjustments saved.");
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  const input = (k: Key, label: string, hint?: string) => (
    <Field label={label} htmlFor={ids[k]} hint={hint}>
      {readOnly ? (
        <div className="py-2 text-[13.5px] tabular-nums">
          {formatCurrency(k === "earlyPaymentsCents" ? p.earlyPaymentsCents : k === "unpaidBillsCents" ? p.unpaidBillsCents : p.propertyReserveCents)}
        </div>
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
    <div className="rounded-2xl border border-border p-4">
      {showName ? <h4 className="mb-3 text-[13.5px] font-semibold">{p.name}</h4> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tenant security deposits">
          <div className="flex flex-wrap items-baseline gap-2 py-2 text-[13.5px]">
            <span className="tabular-nums">{formatCurrency(p.securityDepositsCents)}</span>
            {!readOnly ? (
              <Link href={`/owner-statements/owners/${ownerId}`} className="text-[12.5px] font-medium text-primary hover:underline">
                Edit deposits
              </Link>
            ) : null}
          </div>
        </Field>
        <Field label="Management fee">
          <div className="flex flex-wrap items-baseline gap-2 py-2 text-[13.5px]">
            <span className="tabular-nums">
              {p.fee.bps === null ? "Not set" : `${formatBps(p.fee.bps)}%`}
              {p.feeSource === "own" ? " (own fee)" : p.feeSource === "default" ? " (default)" : ""}
            </span>
            {!readOnly ? (
              <Link href={`/owner-statements/owners/${ownerId}`} className="text-[12.5px] font-medium text-primary hover:underline">
                Change fee
              </Link>
            ) : null}
          </div>
        </Field>
        {input("earlyPaymentsCents", "Early payments")}
        {input(
          "propertyReserveCents",
          "Property reserve",
          `Default ${formatCurrency(p.propertyReserveDefaultCents)} from the owner settings.`,
        )}
        {input("unpaidBillsCents", "Unpaid bills")}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted-foreground">
          Pending ePay payments: {formatCurrency(0)} (card payments are not live yet)
        </p>
        {!readOnly ? (
          <Btn sm variant="pri" className="ml-auto" onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Save adjustments"}
          </Btn>
        ) : null}
      </div>
    </div>
  );
}
