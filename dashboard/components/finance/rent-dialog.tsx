"use client";

import { useMutation } from "convex/react";
import { useId, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { LineView } from "@/convex/rosBuild";
import { displayName } from "@/convex/rosCalc";
import { businessToday, formatCurrency, formatDate, parseDollarsToCents } from "@/convex/rosFormat";
import { MAX_COUNTERPARTY, MAX_MEMO, validateRentLineFieldsAll } from "@/convex/rosPolicy";
import { Btn, DatePicker, Field, Input, Modal, Textarea } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { MoneyInput, centsToInput, useFieldErrors } from "./form-bits";

const ORDER = ["amountCents", "date", "counterparty", "memo"] as const;

/**
 * Edit one prefilled roster-rent line (amount, date inside the period, name, memo), or reset it to
 * the roster values. The client runs the same validateRentLineFields rules as the server
 * (ownerStatements.setRentLine), so the messages match. Removing the line ("didn't pay") is a
 * separate row action.
 */
export function RentDialog({
  statementId,
  line,
  period,
  onClose,
}: {
  statementId: string;
  line: LineView;
  period: { month: string; start: string; end: string };
  onClose: () => void;
}) {
  const setRentLine = useMutation(api.ownerStatements.setRentLine);
  const def = line.rentDefault;
  const [amount, setAmount] = useState(centsToInput(line.amountCents));
  const [date, setDate] = useState(line.storedDate);
  const [counterparty, setCounterparty] = useState(line.counterparty);
  const [memo, setMemo] = useState(line.memo);
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(
    () => ({
      amountCents: `${base}-amount`,
      date: `${base}-date`,
      counterparty: `${base}-counterparty`,
      memo: `${base}-memo`,
    }),
    [base],
  );
  const f = useFieldErrors(ids);
  const unitId = line.unitId ?? "";

  async function run(args: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      await setRentLine({ statementId, unitId, ...args });
      toast.success(done);
      onClose();
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (busy) return;
    const all = validateRentLineFieldsAll({
      amount,
      date,
      counterparty,
      memo,
      month: period.month,
      periodStart: period.start,
      periodEnd: period.end,
      today: businessToday(Date.now()),
    });
    if (!f.check(all, ORDER)) return;
    const cents = parseDollarsToCents(amount) as number;
    await run(
      { amountCents: cents, date: date.trim(), counterparty: counterparty.trim(), memo: memo.trim() },
      "Rent line updated. Confirm the rent lines again before finalizing.",
    );
  }

  const previewName = counterparty.trim() ? displayName(line.unit, counterparty.trim()) : null;

  return (
    <Modal
      title={`Rent: Unit ${line.unit}${line.propertyName ? `, ${line.propertyName}` : ""}`}
      onClose={onClose}
      footer={
        <>
          {line.rentEdited ? (
            <Btn
              className="mr-auto"
              disabled={busy}
              onClick={() => void run({ reset: true }, "Rent line reset to the roster values.")}
            >
              Reset to roster
            </Btn>
          ) : null}
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="pri" onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {def ? (
          <p className="text-[13px] text-muted-foreground">
            From the roster: {formatCurrency(def.amountCents)} on {formatDate(def.date)}, {def.counterparty}. Enter
            what was actually received. If the tenant didn&apos;t pay, close this and use “Remove (didn&apos;t pay)”.
          </p>
        ) : null}
        <Field label="Amount received *" htmlFor={ids.amountCents}>
          <MoneyInput
            id={ids.amountCents}
            value={amount}
            onChange={(v) => {
              setAmount(v);
              f.clear("amountCents");
            }}
            invalid={!!f.errors.amountCents}
            describedBy={f.control("amountCents")["aria-describedby"]}
          />
          {f.message("amountCents")}
        </Field>
        <Field label="Payment date *" htmlFor={ids.date} hint={`Inside ${formatDate(period.start)} to ${formatDate(period.end)}.`}>
          <DatePicker
            id={ids.date}
            value={date}
            min={period.start}
            onChange={(v) => {
              setDate(v);
              f.clear("date");
            }}
            className={f.control("date").className}
            aria-label="Payment date"
          />
          {f.message("date")}
        </Field>
        <Field label="Name on statement *" htmlFor={ids.counterparty} hint="The tenant (several: “Ann Lee & Bob Ray”).">
          <Input
            id={ids.counterparty}
            value={counterparty}
            maxLength={MAX_COUNTERPARTY + 20}
            autoComplete="off"
            onChange={(e) => {
              setCounterparty(e.target.value);
              f.clear("counterparty");
            }}
            {...f.control("counterparty")}
          />
          {f.message("counterparty")}
          {previewName ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Prints as: <span className="font-medium text-foreground">{previewName}</span>
            </p>
          ) : null}
        </Field>
        <Field label="Memo *" htmlFor={ids.memo} hint="Prints on the statement.">
          <Textarea
            id={ids.memo}
            rows={2}
            value={memo}
            maxLength={MAX_MEMO + 20}
            onChange={(e) => {
              setMemo(e.target.value);
              f.clear("memo");
            }}
            {...f.control("memo", "min-h-[60px]")}
          />
          {f.message("memo")}
        </Field>
      </div>
    </Modal>
  );
}
