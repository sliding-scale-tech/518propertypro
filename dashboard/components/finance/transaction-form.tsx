"use client";

import { useMutation, useQuery } from "convex/react";
import { useId, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { displayName } from "@/convex/rosCalc";
import { COMPANY_NAME, businessToday, formatMonth } from "@/convex/rosFormat";
import {
  ENTRY_MSG,
  MAX_COUNTERPARTY,
  MAX_MEMO,
  validateEntryFields,
  validateEntryFieldsAll,
  type RowType,
} from "@/convex/rosPolicy";
import { Btn, DatePicker, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { MoneyInput, centsToInput, useFieldErrors } from "./form-bits";
import { DELETE_ENTRY } from "./line-labels";

/** A manual ledger row being edited (from ledger.list or a draft LineView). */
export type EntryInit = {
  entryId: string;
  propertyId: string;
  unitId: string | null;
  date: string;
  accountId: string;
  accountName: string;
  counterparty: string;
  memo: string;
  amountCents: number;
};

/** The draft editor's statement period: the date must fall inside it (spec 6.3). */
export type DraftPeriod = { month: string; start: string; end: string };

const ORDER = ["propertyId", "unitId", "date", "accountId", "counterparty", "memo", "amountCents"] as const;

/** Name default when the account or unit changes and the Name field is untouched (spec 6.4). */
function defaultCounterparty(kind: RowType | null, tenant: string | null, payee: string | null): string | null {
  if (!kind) return null;
  if (kind === "income") return tenant;
  if (kind === "expense" || kind === "other_subtraction") return COMPANY_NAME;
  if (kind === "owner_draw" || kind === "owner_contribution") return payee;
  return null;
}

function defaultMemo(kind: RowType | null): string | null {
  if (kind === "income") return "Payment";
  if (kind === "owner_draw") return "Owner Draw";
  return kind ? "" : null;
}

/**
 * TransactionForm (spec 6.4): add or edit a manual ledger transaction. Used by the Ledger page and
 * the draft editor (where `allowedPropertyIds` and `period` limit it to the statement). Validation
 * runs the shared validateEntryFieldsAll, so the messages match ledger.add / ledger.update.
 */
export function TransactionForm({
  mode,
  entry,
  allowedPropertyIds,
  period,
  defaultPropertyId,
  onClose,
  onVoid,
}: {
  mode: "add" | "edit";
  entry?: EntryInit;
  allowedPropertyIds?: string[];
  period?: DraftPeriod;
  defaultPropertyId?: string;
  onClose: () => void;
  /** Edit mode: open the Delete (void) dialog for this entry. */
  onVoid?: () => void;
}) {
  const add = useMutation(api.ledger.add);
  const update = useMutation(api.ledger.update);

  const [today] = useState(() => businessToday(Date.now()));
  const initialDate = entry?.date ?? (period ? (today < period.end ? today : period.end) : today);
  const onlyProperty = allowedPropertyIds && allowedPropertyIds.length === 1 ? allowedPropertyIds[0] : "";

  const [propertyId, setPropertyId] = useState(entry?.propertyId ?? defaultPropertyId ?? onlyProperty);
  const [unitId, setUnitId] = useState(entry?.unitId ?? "");
  const [date, setDate] = useState(initialDate);
  const [accountId, setAccountId] = useState(entry?.accountId ?? "");
  const [counterparty, setCounterparty] = useState(entry?.counterparty ?? "");
  const [memo, setMemo] = useState(entry?.memo ?? "");
  const [amount, setAmount] = useState(entry ? centsToInput(entry.amountCents) : "");
  // Defaults only fill a field the user hasn't typed in (an edited row counts as typed).
  const [touched, setTouched] = useState({ counterparty: mode === "edit", memo: mode === "edit" });
  const [busy, setBusy] = useState(false);

  const base = useId();
  const ids = useMemo(
    () => ({
      propertyId: `${base}-property`,
      unitId: `${base}-unit`,
      date: `${base}-date`,
      accountId: `${base}-account`,
      counterparty: `${base}-name`,
      memo: `${base}-memo`,
      amountCents: `${base}-amount`,
    }),
    [base],
  );
  const f = useFieldErrors(ids);

  const opts = useQuery(api.ledger.formOptions, {});
  const unitOpts = useQuery(api.ledger.formOptions, propertyId ? { propertyId } : "skip");

  const properties = (opts?.properties ?? []).filter(
    (p) => !allowedPropertyIds || allowedPropertyIds.includes(p.propertyId) || p.propertyId === entry?.propertyId,
  );
  const accounts = opts?.accounts ?? [];
  const units = unitOpts?.units ?? [];
  const property = properties.find((p) => p.propertyId === propertyId) ?? null;
  const unit = units.find((u) => u.unitId === unitId) ?? null;
  const account = accounts.find((a) => a._id === accountId) ?? null;
  // An edited row whose account was turned off still shows by name, so the message can explain it.
  const accountOff = mode === "edit" && !!entry && accountId === entry.accountId && opts !== undefined && !account;

  function applyDefaults(next: { accountId?: string; unitId?: string; propertyId?: string }) {
    const accId = next.accountId ?? accountId;
    const kind = (accounts.find((a) => a._id === accId)?.kind ?? null) as RowType | null;
    const uId = next.unitId ?? unitId;
    const tenant = next.propertyId ? null : (units.find((u) => u.unitId === uId)?.tenants[0] ?? null);
    const pId = next.propertyId ?? propertyId;
    const payee = (opts?.properties ?? []).find((p) => p.propertyId === pId)?.ownerPayeeName ?? null;
    if (!touched.counterparty) {
      const cp = defaultCounterparty(kind, uId ? tenant : null, payee);
      if (cp !== null) setCounterparty(cp);
      else if (kind === "income" && !uId) setCounterparty("");
    }
    if (!touched.memo) {
      const m = defaultMemo(kind);
      if (m !== null) setMemo(m);
    }
  }

  const raw = () => ({
    propertyId,
    unitId,
    date,
    accountId,
    counterparty,
    memo,
    amount,
    today,
    property: property ? { name: property.name } : null,
    account: account
      ? { name: account.name, active: true }
      : accountOff && entry
        ? { name: entry.accountName, active: false }
        : null,
    // While the unit list loads, leave the check to the server.
    unitInProperty: !unitId || unitOpts === undefined || units.some((u) => u.unitId === unitId),
  });

  async function submit() {
    if (busy) return;
    const input = raw();
    const all = validateEntryFieldsAll(input);
    if (!all.propertyId && property?.blockedReason && mode === "add") all.propertyId = property.blockedReason;
    // A carried-forward row keeps its earlier stored date unless the user changes it.
    const dateChanged = mode === "add" || date !== entry?.date;
    if (!all.date && period && dateChanged && (date < period.start || date > period.end)) {
      all.date = `Pick a date in ${formatMonth(period.month)}.`;
    }
    if (!f.check(all, ORDER)) return;
    const res = validateEntryFields(input);
    if (!res.ok) {
      f.check({ [res.field]: res.message }, ORDER);
      return;
    }
    const v = res.value;
    setBusy(true);
    try {
      if (mode === "add") {
        await add({
          propertyId: v.propertyId,
          unitId: v.unitId,
          date: v.date,
          accountId: v.accountId,
          counterparty: v.counterparty,
          memo: v.memo,
          amountCents: v.amountCents,
        });
        toast.success("Transaction added.");
      } else if (entry) {
        await update({
          entryId: entry.entryId,
          unitId: v.unitId,
          date: v.date,
          accountId: v.accountId,
          counterparty: v.counterparty,
          memo: v.memo,
          amountCents: v.amountCents,
        });
        toast.success("Transaction saved.");
      }
      onClose();
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  const tenantListId = `${base}-tenants`;
  const previewName = counterparty.trim() ? displayName(unit ? unit.label : null, counterparty.trim()) : "";

  return (
    <Modal
      title={mode === "add" ? "Add transaction" : "Edit transaction"}
      eyebrow={period ? `${formatMonth(period.month)} statement` : undefined}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {mode === "edit" && onVoid ? (
            <Btn variant="dng" className="mr-auto" onClick={onVoid} disabled={busy}>
              Delete…
            </Btn>
          ) : null}
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="pri" onClick={() => void submit()} disabled={busy || opts === undefined}>
            {busy ? "Saving…" : mode === "add" ? "Add transaction" : "Save changes"}
          </Btn>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Property *"
          htmlFor={ids.propertyId}
          hint={mode === "edit" ? ENTRY_MSG.propertyChange : undefined}
        >
          <Select
            id={ids.propertyId}
            value={propertyId}
            disabled={mode === "edit" || opts === undefined}
            placeholder={opts === undefined ? "Loading properties…" : "Select a property"}
            onChange={(e) => {
              const next = e.target.value || "";
              setPropertyId(next);
              setUnitId("");
              f.clear("propertyId");
              f.clear("unitId");
              applyDefaults({ propertyId: next, unitId: "" });
            }}
            aria-describedby={f.control("propertyId")["aria-describedby"]}
            className={f.control("propertyId").className}
          >
            <option value="">{opts === undefined ? "Loading properties…" : "Select a property"}</option>
            {properties.map((p) => (
              <option
                key={p.propertyId}
                value={p.propertyId}
                disabled={mode === "add" && p.blockedReason !== null}
                data-sublabel={p.blockedReason ?? p.ownerLegalName ?? undefined}
              >
                {p.name}
              </option>
            ))}
          </Select>
          {f.message("propertyId")}
        </Field>

        <Field label="Unit" htmlFor={ids.unitId}>
          <Select
            id={ids.unitId}
            value={unitId}
            disabled={!propertyId || unitOpts === undefined}
            onChange={(e) => {
              const next = e.target.value || "";
              setUnitId(next);
              f.clear("unitId");
              applyDefaults({ unitId: next });
            }}
            aria-describedby={f.control("unitId")["aria-describedby"]}
            className={f.control("unitId").className}
          >
            <option value="">Property level</option>
            {units.map((u) => (
              <option key={u.unitId} value={u.unitId}>
                {`Unit ${u.label}`}
              </option>
            ))}
          </Select>
          {f.message("unitId")}
        </Field>

        <Field label="Date *" htmlFor={ids.date} hint={period ? `Must be in ${formatMonth(period.month)}.` : undefined}>
          <DatePicker
            id={ids.date}
            value={date}
            min={period?.start}
            onChange={(v) => {
              setDate(v);
              f.clear("date");
            }}
            className={f.control("date").className}
            aria-label="Transaction date"
          />
          {f.message("date")}
        </Field>

        <Field label="Account *" htmlFor={ids.accountId}>
          <Select
            id={ids.accountId}
            value={accountId}
            disabled={opts === undefined}
            onChange={(e) => {
              const next = e.target.value || "";
              setAccountId(next);
              f.clear("accountId");
              applyDefaults({ accountId: next });
            }}
            aria-describedby={f.control("accountId")["aria-describedby"]}
            className={f.control("accountId").className}
          >
            <option value="">{opts === undefined ? "Loading accounts…" : "Select an account"}</option>
            {accountOff && entry ? <option value={entry.accountId}>{`${entry.accountName} (turned off)`}</option> : null}
            {accounts.map((a) => (
              <option key={a._id} value={a._id}>
                {`${a.name} · ${a.kindLabel}`}
              </option>
            ))}
          </Select>
          {f.message("accountId")}
        </Field>

        <Field
          label="Name on statement *"
          htmlFor={ids.counterparty}
          hint="Tenant, vendor or payee."
          className="sm:col-span-2"
        >
          <Input
            id={ids.counterparty}
            value={counterparty}
            maxLength={MAX_COUNTERPARTY + 20}
            list={unit && unit.tenants.length > 0 ? tenantListId : undefined}
            autoComplete="off"
            onChange={(e) => {
              setCounterparty(e.target.value);
              setTouched((t) => ({ ...t, counterparty: true }));
              f.clear("counterparty");
            }}
            {...f.control("counterparty")}
          />
          {unit && unit.tenants.length > 0 ? (
            <datalist id={tenantListId}>
              {unit.tenants.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          ) : null}
          {f.message("counterparty")}
          {previewName ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Prints as: <span className="font-medium text-foreground">{previewName}</span>
            </p>
          ) : null}
        </Field>

        <Field label="Memo *" htmlFor={ids.memo} hint="Prints on the statement." className="sm:col-span-2">
          <Textarea
            id={ids.memo}
            rows={2}
            value={memo}
            maxLength={MAX_MEMO + 20}
            onChange={(e) => {
              setMemo(e.target.value);
              setTouched((t) => ({ ...t, memo: true }));
              f.clear("memo");
            }}
            {...f.control("memo", "min-h-[60px]")}
          />
          {f.message("memo")}
        </Field>

        <Field label="Amount *" htmlFor={ids.amountCents} hint="Always positive; the account decides the side.">
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
      </div>
    </Modal>
  );
}

/**
 * Delete a manual, unbilled transaction (reason required), spec 5.3 / 6.3. It calls ledger.voidEntry:
 * the row is voided, so it never goes on a statement but stays in the ledger history with the reason.
 */
export function VoidDialog({
  entryId,
  summary,
  onClose,
  onVoided,
}: {
  entryId: string;
  summary: string;
  onClose: () => void;
  onVoided?: () => void;
}) {
  const voidEntry = useMutation(api.ledger.voidEntry);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(() => ({ reason: `${base}-reason` }), [base]);
  const f = useFieldErrors(ids);

  async function submit() {
    if (busy) return;
    const r = reason.trim();
    const all: Record<string, string> = {};
    if (r === "") all.reason = ENTRY_MSG.voidReasonMissing;
    else if (r.length > MAX_MEMO) all.reason = ENTRY_MSG.voidReasonLong;
    if (!f.check(all, ["reason"])) return;
    setBusy(true);
    try {
      await voidEntry({ entryId, reason: r });
      toast.success(DELETE_ENTRY.toast);
      onVoided?.();
      onClose();
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={DELETE_ENTRY.title}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="dng" onClick={() => void submit()} disabled={busy}>
            {busy ? DELETE_ENTRY.busy : DELETE_ENTRY.confirm}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13.5px] font-medium">{summary}</p>
        <p className="text-[13.5px] text-muted-foreground">{DELETE_ENTRY.body}</p>
        <Field label="Reason *" htmlFor={ids.reason}>
          <Textarea
            id={ids.reason}
            rows={3}
            value={reason}
            maxLength={MAX_MEMO + 20}
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
