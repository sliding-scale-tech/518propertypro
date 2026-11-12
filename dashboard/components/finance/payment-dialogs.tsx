"use client";

import { useMutation } from "convex/react";
import { useId, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import {
  MAX_PAYMENT_NOTE,
  MAX_UNDO_REASON,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  RENT_PAY_MSG,
  validatePaymentFields,
  validatePaymentFieldsAll,
} from "@/convex/rentPaymentsPolicy";
import { formatCurrency, formatDate, formatMonth } from "@/convex/rosFormat";
import { Btn, DatePicker, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { serverError } from "@/lib/form-errors";
import { useFieldErrors } from "./form-bits";

/**
 * Payments page dialogs (spec 5.9 / 6.8): mark one unit received, mark several, edit a payment,
 * undo a payment. Client validation runs the shared validatePaymentFieldsAll, so the messages match
 * convex/rentPayments.ts; the server checks everything again (owner, markable, duplicates, locks).
 * The amount is never typed: it is always the unit's roster rent, shown read-only.
 */

const ORDER = ["receivedDate", "method", "note"] as const;

/** The unit a dialog is about. */
export type PaymentUnit = {
  unitId: string;
  unit: string;
  propertyName: string;
  tenants: string[];
  /** The roster rent in cents (markable rows always have one). */
  rentCents: number | null;
};

function UnitSummary({ u, amountCents }: { u: PaymentUnit; amountCents: number | null }) {
  return (
    <div className="grid gap-2 rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-[13px] sm:grid-cols-2">
      <div>
        <div className="text-[12px] text-muted-foreground">Unit</div>
        <div className="font-medium">
          Unit {u.unit} · {u.propertyName}
        </div>
      </div>
      <div>
        <div className="text-[12px] text-muted-foreground">Tenant</div>
        <div className="font-medium">{u.tenants.length > 0 ? u.tenants.join(" & ") : "—"}</div>
      </div>
      <div className="sm:col-span-2">
        <div className="text-[12px] text-muted-foreground">Amount</div>
        <div className="font-semibold tabular-nums">{amountCents !== null ? formatCurrency(amountCents) : "—"}</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Always the full roster rent (no partial payments). To change it, fix the rent on the unit first.
        </p>
      </div>
    </div>
  );
}

function MethodSelect({
  id,
  value,
  onChange,
  control,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  control: { "aria-describedby"?: string; className?: string };
}) {
  return (
    <Select
      id={id}
      value={value}
      placeholder="Select how it was paid"
      onChange={(e) => onChange(e.target.value || "")}
      aria-describedby={control["aria-describedby"]}
      className={control.className}
    >
      <option value="">Select how it was paid</option>
      {PAYMENT_METHODS.map((m) => (
        <option key={m} value={m}>
          {PAYMENT_METHOD_LABELS[m]}
        </option>
      ))}
    </Select>
  );
}

function dateHint(earliest: string): string {
  return `From ${formatDate(earliest)} to today. It goes on the statement for the month it was received, whatever month the rent is for.`;
}

/** Mark one unit's rent received (rentPayments.markReceived). */
export function MarkDialog({
  unit,
  month,
  today,
  earliest,
  onClose,
}: {
  unit: PaymentUnit;
  month: string;
  today: string;
  earliest: string;
  onClose: () => void;
}) {
  const mark = useMutation(api.rentPayments.markReceived);
  const [receivedDate, setReceivedDate] = useState(today);
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(() => ({ receivedDate: `${base}-date`, method: `${base}-method`, note: `${base}-note` }), [base]);
  const f = useFieldErrors(ids);

  async function submit() {
    if (busy) return;
    const input = { month, receivedDate, method, note, today };
    if (!f.check(validatePaymentFieldsAll(input), ORDER)) return;
    const res = validatePaymentFields(input);
    if (!res.ok) {
      f.check({ [res.field]: res.message }, ORDER);
      return;
    }
    setBusy(true);
    try {
      await mark({ unitId: unit.unitId, ...res.value });
      toast.success(`${formatMonth(month)} rent marked received for Unit ${unit.unit}.`);
      onClose();
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Mark rent received"
      eyebrow={`${formatMonth(month)} rent`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="pri" onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : "Mark received"}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <UnitSummary u={unit} amountCents={unit.rentCents} />
        <Field label="Received on *" htmlFor={ids.receivedDate} hint={dateHint(earliest)}>
          <DatePicker
            id={ids.receivedDate}
            value={receivedDate}
            min={earliest}
            onChange={(v) => {
              setReceivedDate(v);
              f.clear("receivedDate");
            }}
            className={f.control("receivedDate").className}
            aria-label="Date the rent was received"
          />
          {f.message("receivedDate")}
        </Field>
        <Field label="Paid by *" htmlFor={ids.method}>
          <MethodSelect
            id={ids.method}
            value={method}
            onChange={(v) => {
              setMethod(v);
              f.clear("method");
            }}
            control={f.control("method")}
          />
          {f.message("method")}
        </Field>
        <Field label="Note" htmlFor={ids.note} hint="Optional, for example the check number.">
          <Input
            id={ids.note}
            value={note}
            maxLength={MAX_PAYMENT_NOTE + 20}
            autoComplete="off"
            onChange={(e) => {
              setNote(e.target.value);
              f.clear("note");
            }}
            {...f.control("note")}
          />
          {f.message("note")}
        </Field>
      </div>
    </Modal>
  );
}

/** Mark several units received in one go (rentPayments.markManyReceived, all or nothing). */
export function BulkMarkDialog({
  units,
  month,
  today,
  earliest,
  onClose,
  onDone,
}: {
  units: PaymentUnit[];
  month: string;
  today: string;
  earliest: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const markMany = useMutation(api.rentPayments.markManyReceived);
  const [receivedDate, setReceivedDate] = useState(today);
  const [method, setMethod] = useState("");
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const base = useId();
  const ids = useMemo(() => ({ receivedDate: `${base}-date`, method: `${base}-method`, note: `${base}-note` }), [base]);
  const f = useFieldErrors(ids);
  const totalCents = units.reduce((sum, u) => sum + (u.rentCents ?? 0), 0);

  async function submit() {
    if (busy) return;
    const input = { month, receivedDate, method, note: null, today };
    const all = validatePaymentFieldsAll(input);
    if (units.length === 0) {
      toast.error(RENT_PAY_MSG.noneSelected);
      return;
    }
    if (!f.check(all, ORDER)) return;
    const res = validatePaymentFields(input);
    if (!res.ok) {
      f.check({ [res.field]: res.message }, ORDER);
      return;
    }
    setBusy(true);
    setProblems([]);
    try {
      const out = await markMany({
        unitIds: units.map((u) => u.unitId),
        month: res.value.month,
        receivedDate: res.value.receivedDate,
        method: res.value.method,
      });
      toast.success(
        `${formatMonth(month)} rent marked received for ${out.count} ${out.count === 1 ? "unit" : "units"} (${formatCurrency(out.totalCents)}).`,
      );
      onDone();
      onClose();
    } catch (e) {
      f.fromServer(e);
      // The server lists every unit that failed (nothing was saved).
      const data = (e as { data?: unknown }).data;
      const list = data && typeof data === "object" ? (data as { problems?: unknown }).problems : undefined;
      if (Array.isArray(list)) {
        setProblems(
          list
            .map((p) => (p && typeof p === "object" ? (p as { message?: unknown }).message : null))
            .filter((m): m is string => typeof m === "string"),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Mark selected rent received"
      eyebrow={`${formatMonth(month)} rent`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="pri" onClick={() => void submit()} disabled={busy || units.length === 0}>
            {busy ? "Saving…" : `Mark ${units.length} received`}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-[13px]">
          <div className="font-semibold">
            {units.length} {units.length === 1 ? "unit" : "units"} · {formatCurrency(totalCents)} in total
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Each unit is marked for its full roster rent, received on the same date and paid the same way. If any unit
            can&apos;t be marked, nothing is saved.
          </p>
          <ul className="mt-2 max-h-40 overflow-y-auto text-[12.5px]">
            {units.map((u) => (
              <li key={u.unitId} className="flex justify-between gap-3 border-t border-border py-1 first:border-t-0">
                <span className="truncate">
                  Unit {u.unit} · {u.propertyName}
                </span>
                <span className="shrink-0 tabular-nums">{u.rentCents !== null ? formatCurrency(u.rentCents) : "—"}</span>
              </li>
            ))}
          </ul>
        </div>
        {problems.length > 0 ? (
          <div role="alert" className="rounded-xl border border-danger-ink/30 bg-danger-soft px-3.5 py-3 text-[12.5px] text-danger-ink">
            <div className="mb-1 font-semibold">Nothing was saved. Fix or unselect these units:</div>
            <ul className="list-disc pl-5">
              {problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <Field label="Received on *" htmlFor={ids.receivedDate} hint={dateHint(earliest)}>
          <DatePicker
            id={ids.receivedDate}
            value={receivedDate}
            min={earliest}
            onChange={(v) => {
              setReceivedDate(v);
              f.clear("receivedDate");
            }}
            className={f.control("receivedDate").className}
            aria-label="Date the rent was received"
          />
          {f.message("receivedDate")}
        </Field>
        <Field label="Paid by *" htmlFor={ids.method}>
          <MethodSelect
            id={ids.method}
            value={method}
            onChange={(v) => {
              setMethod(v);
              f.clear("method");
            }}
            control={f.control("method")}
          />
          {f.message("method")}
        </Field>
      </div>
    </Modal>
  );
}

/** A payment marked on this page (what the edit / undo dialogs need). */
export type PaymentInit = PaymentUnit & {
  entryId: string;
  amountCents: number;
  receivedDate: string;
  method: string | null;
  note: string | null;
};

/** Change the received date, method or note (rentPayments.updatePayment). */
export function EditPaymentDialog({
  payment,
  month,
  today,
  earliest,
  onClose,
}: {
  payment: PaymentInit;
  month: string;
  today: string;
  earliest: string;
  onClose: () => void;
}) {
  const update = useMutation(api.rentPayments.updatePayment);
  const [receivedDate, setReceivedDate] = useState(payment.receivedDate);
  const [method, setMethod] = useState(payment.method ?? "");
  const [note, setNote] = useState(payment.note ?? "");
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(() => ({ receivedDate: `${base}-date`, method: `${base}-method`, note: `${base}-note` }), [base]);
  const f = useFieldErrors(ids);

  async function submit() {
    if (busy) return;
    const input = { month, receivedDate, method, note, today };
    if (!f.check(validatePaymentFieldsAll(input), ORDER)) return;
    const res = validatePaymentFields(input);
    if (!res.ok) {
      f.check({ [res.field]: res.message }, ORDER);
      return;
    }
    setBusy(true);
    try {
      await update({
        entryId: payment.entryId,
        receivedDate: res.value.receivedDate,
        method: res.value.method,
        note: res.value.note,
      });
      toast.success("Payment saved.");
      onClose();
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Edit payment"
      eyebrow={`${formatMonth(month)} rent`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="pri" onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <UnitSummary u={payment} amountCents={payment.amountCents} />
        <Field label="Received on *" htmlFor={ids.receivedDate} hint={dateHint(earliest)}>
          <DatePicker
            id={ids.receivedDate}
            value={receivedDate}
            min={earliest}
            onChange={(v) => {
              setReceivedDate(v);
              f.clear("receivedDate");
            }}
            className={f.control("receivedDate").className}
            aria-label="Date the rent was received"
          />
          {f.message("receivedDate")}
        </Field>
        <Field label="Paid by *" htmlFor={ids.method}>
          <MethodSelect
            id={ids.method}
            value={method}
            onChange={(v) => {
              setMethod(v);
              f.clear("method");
            }}
            control={f.control("method")}
          />
          {f.message("method")}
        </Field>
        <Field label="Note" htmlFor={ids.note} hint="Optional, for example the check number.">
          <Input
            id={ids.note}
            value={note}
            maxLength={MAX_PAYMENT_NOTE + 20}
            autoComplete="off"
            onChange={(e) => {
              setNote(e.target.value);
              f.clear("note");
            }}
            {...f.control("note")}
          />
          {f.message("note")}
        </Field>
      </div>
    </Modal>
  );
}

/** Undo a payment (rentPayments.undoPayment = void with a reason). */
export function UndoPaymentDialog({
  payment,
  month,
  onClose,
}: {
  payment: PaymentInit;
  month: string;
  onClose: () => void;
}) {
  const undo = useMutation(api.rentPayments.undoPayment);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(() => ({ reason: `${base}-reason` }), [base]);
  const f = useFieldErrors(ids);

  async function submit() {
    if (busy) return;
    const r = reason.trim();
    const all: Record<string, string> = {};
    if (r === "") all.reason = RENT_PAY_MSG.undoReasonMissing;
    else if (r.length > MAX_UNDO_REASON) all.reason = RENT_PAY_MSG.undoReasonLong;
    if (!f.check(all, ["reason"])) return;
    setBusy(true);
    try {
      await undo({ entryId: payment.entryId, reason: r });
      toast.success(`Payment undone. Unit ${payment.unit} shows as unpaid for ${formatMonth(month)}.`);
      onClose();
    } catch (e) {
      const err = serverError(e);
      if (err.field === "reason") f.fromServer(e);
      else toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Undo this payment?"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="dng" onClick={() => void submit()} disabled={busy}>
            {busy ? "Undoing…" : "Undo payment"}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13.5px] font-medium">
          Unit {payment.unit} · {payment.propertyName} · {formatMonth(month)} rent · {formatCurrency(payment.amountCents)} received{" "}
          {formatDate(payment.receivedDate)}
        </p>
        <p className="text-[13.5px] text-muted-foreground">
          It comes off the draft statement and the unit shows as unpaid. It stays in the ledger history with your reason.
        </p>
        <Field label="Reason *" htmlFor={ids.reason}>
          <Textarea
            id={ids.reason}
            rows={3}
            value={reason}
            maxLength={MAX_UNDO_REASON + 20}
            onChange={(e) => {
              setReason(e.target.value);
              f.clear("reason");
            }}
            {...f.control("reason", "min-h-[70px]")}
          />
          {f.message("reason")}
        </Field>
      </div>
    </Modal>
  );
}
