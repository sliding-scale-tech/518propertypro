"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useId, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { formatCurrency, formatMonth } from "@/convex/rosFormat";
import {
  MAX_RENT_CHANGE_NOTE,
  rentChangeMonthOptions,
  rentForMonth,
  validateRentChange,
  validateRentChangeAll,
} from "@/convex/unitRentPolicy";
import { Btn, Field, Input, Modal, Select } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { MoneyInput, Spinner, useFieldErrors } from "@/components/finance/form-bits";

/**
 * The shared Change rent form (unitRent.changeRent): a new monthly rent from a month on. Used in a
 * dialog (Payments page, the unit table's ⋯ menu, the Edit unit form) and inline in the unit drawer.
 * Admin view + accountant only (the history query and the mutation both call requireFinance).
 * Client validation runs the same validateRentChangeAll as the server, so the messages match;
 * the amount is typed text parsed with parseDollarsToCents on both sides (never Number()).
 */

const ORDER = ["rent", "effectiveMonth", "note"] as const;

export type ChangeRentTarget = {
  unitId: string;
  /** "Unit 2B · 108 Jackson Avenue". */
  label: string;
};

export function ChangeRentForm({
  target,
  defaultMonth,
  onDone,
  onCancel,
}: {
  target: ChangeRentTarget;
  /** The month the new rent starts by default (the Payments page's rent month); else this month. */
  defaultMonth?: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const history = useQuery(api.unitRent.history, { unitId: target.unitId });
  if (history === undefined) return <Spinner label="Loading the rent…" />;
  return <ChangeRentFields key={target.unitId} target={target} history={history} defaultMonth={defaultMonth} onDone={onDone} onCancel={onCancel} />;
}

type History = FunctionReturnType<typeof api.unitRent.history>;

function ChangeRentFields({
  target,
  history,
  defaultMonth,
  onDone,
  onCancel,
}: {
  target: ChangeRentTarget;
  history: History;
  defaultMonth?: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const change = useMutation(api.unitRent.changeRent);
  // The server's own date: the month window and "today" come from the history query.
  const today = `${history.currentMonth}-01`;
  const months = useMemo(() => rentChangeMonthOptions(today), [today]);
  const initialMonth = defaultMonth && months.some((m) => m.value === defaultMonth) ? defaultMonth : history.currentMonth;
  const [rent, setRent] = useState("");
  const [effectiveMonth, setEffectiveMonth] = useState(initialMonth);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(() => ({ rent: `${base}-rent`, effectiveMonth: `${base}-month`, note: `${base}-note` }), [base]);
  const f = useFieldErrors(ids);

  const unitLike = { rent: history.rosterRent };
  const forMonth = effectiveMonth ? rentForMonth(unitLike, history.changes, effectiveMonth) : null;

  async function submit() {
    if (busy) return;
    const input = { rent, effectiveMonth, note, today };
    if (!f.check(validateRentChangeAll(input), ORDER)) return;
    const res = validateRentChange(input);
    if (!res.ok) {
      f.check({ [res.field]: res.message }, ORDER);
      return;
    }
    setBusy(true);
    try {
      const out = await change({ unitId: target.unitId, rent, effectiveMonth, note: note.trim() === "" ? null : note });
      toast.success(`${target.label}: rent is ${formatCurrency(out.rentCents)}/month from ${formatMonth(out.effectiveMonth)}.`);
      // Paid months keep their payment: say so (exact wording from the server).
      if (out.info.length > 0) toast.info(out.info.join(" "), { duration: 9000 });
      onDone();
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-2 rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-[13px] sm:grid-cols-2">
        <div>
          <div className="text-[12px] text-muted-foreground">Unit</div>
          <div className="font-medium">{target.label}</div>
        </div>
        <div>
          <div className="text-[12px] text-muted-foreground">Rent now ({formatMonth(history.currentMonth)})</div>
          <div className="font-semibold tabular-nums">
            {history.current.cents !== null ? `${formatCurrency(history.current.cents)}/month` : "No rent set"}
          </div>
          <div className="text-xs text-muted-foreground">
            {history.current.fromMonth
              ? `Since ${formatMonth(history.current.fromMonth)}`
              : history.hasHistory
                ? "Before the first rent change"
                : "From the roster"}
          </div>
        </div>
        {history.upcoming ? (
          <div className="sm:col-span-2 text-xs text-muted-foreground">
            Already set: {formatCurrency(history.upcoming.cents)}/month from {formatMonth(history.upcoming.month)}.
          </div>
        ) : null}
      </div>

      <Field label="New monthly rent *" htmlFor={ids.rent} hint="The full rent for a month, like 1250 or 1250.50.">
        <MoneyInput
          id={ids.rent}
          value={rent}
          onChange={(v) => {
            setRent(v);
            f.clear("rent");
          }}
          invalid={Boolean(f.errors.rent)}
          describedBy={f.errors.rent ? `${ids.rent}-err` : undefined}
        />
        {f.message("rent")}
      </Field>

      <Field
        label="Starts in *"
        htmlFor={ids.effectiveMonth}
        hint={
          effectiveMonth
            ? `${formatMonth(effectiveMonth)} rent is ${forMonth !== null ? formatCurrency(forMonth) : "not set"} today. Months already marked paid keep the amount they were paid at.`
            : undefined
        }
      >
        <Select
          id={ids.effectiveMonth}
          value={effectiveMonth}
          onChange={(e) => {
            setEffectiveMonth(e.target.value || "");
            f.clear("effectiveMonth");
          }}
          {...f.control("effectiveMonth")}
        >
          <option value="">Select the month</option>
          {months.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
        {f.message("effectiveMonth")}
      </Field>

      <Field label="Note" htmlFor={ids.note} hint="Optional, for example “Lease renewal”.">
        <Input
          id={ids.note}
          value={note}
          maxLength={MAX_RENT_CHANGE_NOTE}
          onChange={(e) => {
            setNote(e.target.value);
            f.clear("note");
          }}
          {...f.control("note")}
        />
        {f.message("note")}
      </Field>

      <div className="flex justify-end gap-2">
        <Btn onClick={onCancel} disabled={busy}>
          Cancel
        </Btn>
        <Btn type="submit" variant="pri" disabled={busy}>
          {busy ? "Saving…" : "Save new rent"}
        </Btn>
      </div>
    </form>
  );
}

/** The Change rent form in a dialog. */
export function ChangeRentDialog({
  target,
  defaultMonth,
  onClose,
}: {
  target: ChangeRentTarget;
  defaultMonth?: string | null;
  onClose: () => void;
}) {
  return (
    <Modal title="Change rent" eyebrow={target.label} onClose={onClose}>
      <ChangeRentForm target={target} defaultMonth={defaultMonth} onDone={onClose} onCancel={onClose} />
    </Modal>
  );
}
