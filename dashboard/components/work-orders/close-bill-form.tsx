"use client";

import { useMutation, useQuery } from "convex/react";
import { Pencil } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatAmount, formatCurrency } from "@/convex/rosFormat";
import { MAX_WORK_DESCRIPTION, validateBillingFields, validateBillingFieldsAll } from "@/convex/rosPolicy";
import { Btn, Field, Input, KeyValue, Select, Textarea, Toggle, cx } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { serverError } from "@/lib/form-errors";

/**
 * Owner-statement billing on a work order (docs/specs/ros-build-spec.md 6.7), shared by the board
 * drawer and the work-order page so the two close UIs cannot drift:
 *
 *   CloseBillForm mode "close"  Pat closes a completed work order (workOrders.reviewClose)
 *   CloseBillForm mode "edit"   finance edits billing on a closed, unbilled one (workOrderBilling.updateBilling)
 *   BillingBlock                the read-only Billing summary shown after close
 *
 * Validation runs the same rosPolicy functions as the server, so client and server messages match.
 */

/** The billing block both board.detail and workOrders.get return (null for technicians). */
export type BillingInfo = {
  workCompletedDescription: string | null;
  billAmountCents: number | null;
  costCents: number | null;
  rosAccountId: string | null;
  rosAccountName: string | null;
  billPropertyLevel: boolean;
  noOwnerCharge: boolean;
  billedStatementId: string | null;
  billedLabel: string | null;
  canEdit: boolean;
};

/** Server field names, in form order (the first one is focused and toasted). */
const FIELD_ORDER = ["workCompletedDescription", "billAmountCents", "costCents", "rosAccountId"] as const;
type FieldKey = (typeof FIELD_ORDER)[number];

const INVALID = "!border-danger-ink";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-danger-ink">
      {message}
    </p>
  );
}

/** Cents -> the text a money input starts with ("395.00"); empty when not set. */
function moneyText(cents: number | null | undefined): string {
  return typeof cents === "number" ? formatAmount(cents).replace(/,/g, "") : "";
}

function MoneyInput({
  id,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  describedBy?: string;
}) {
  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute left-[11px] top-1/2 -translate-y-1/2 text-[13.5px] text-muted-foreground">
        $
      </span>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className={cx("!pl-6", invalid && INVALID)}
      />
    </div>
  );
}

export function CloseBillForm({
  mode,
  workOrderId,
  woNumber,
  billing,
  suggestedDescription,
  onDone,
  onCancel,
  renderFooter,
  title,
  hint,
  bodyClassName,
}: {
  /** Optional heading above the fields (the drawer step). */
  title?: string;
  hint?: string;
  /** Classes for the fields wrapper (the drawer adds its padding). */
  bodyClassName?: string;
  mode: "close" | "edit";
  workOrderId: Id<"workOrders">;
  woNumber: number;
  billing: BillingInfo | null;
  /** Prefill when the work order has no description yet: the technician's latest note. */
  suggestedDescription?: string | null;
  onDone: () => void;
  onCancel: () => void;
  /** Custom footer (the drawer's sticky buttons). Defaults to a right-aligned button row. */
  renderFooter?: (p: { submit: () => void; busy: boolean; label: string }) => ReactNode;
}) {
  const reviewClose = useMutation(api.workOrders.reviewClose);
  const updateBilling = useMutation(api.workOrderBilling.updateBilling);
  const ensureAccounts = useMutation(api.workOrderBilling.ensureAccounts);
  const accounts = useQuery(api.workOrderBilling.accountsForClose, {});

  const [description, setDescription] = useState(
    billing?.workCompletedDescription ?? suggestedDescription?.trim() ?? "",
  );
  const [noCharge, setNoCharge] = useState(billing?.noOwnerCharge ?? false);
  const [bill, setBill] = useState(moneyText(billing?.billAmountCents));
  const [cost, setCost] = useState(moneyText(billing?.costCents));
  // null = not touched: fall back to the stored account, then the default (Repairs).
  const [accountChoice, setAccountChoice] = useState<string | null>(null);
  const [propertyLevel, setPropertyLevel] = useState(billing?.billPropertyLevel ?? false);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [busy, setBusy] = useState(false);

  const base = useId();
  const ids: Record<FieldKey | "note", string> = {
    workCompletedDescription: `${base}-desc`,
    billAmountCents: `${base}-bill`,
    costCents: `${base}-cost`,
    rosAccountId: `${base}-account`,
    note: `${base}-note`,
  };

  // First use on a team: create the default accounts (Repairs etc.) so there is a list to pick from.
  const seeded = useRef(false);
  useEffect(() => {
    if (!accounts?.needsSetup || seeded.current) return;
    seeded.current = true;
    ensureAccounts({}).catch((e) => toast.error(serverError(e).message));
  }, [accounts?.needsSetup, ensureAccounts]);

  const list = accounts?.accounts ?? [];
  const storedId = billing?.rosAccountId ?? null;
  // A stored account that is no longer an active expense account still shows by name, so the
  // "turned off" message can explain it instead of the select looking empty.
  const storedMissing = !!storedId && accounts !== undefined && !list.some((a) => a._id === storedId);
  const accountId = accountChoice ?? storedId ?? accounts?.defaultAccountId ?? "";
  const accountFor = (id: string) => {
    if (!id) return null;
    const hit = list.find((a) => a._id === id);
    if (hit) return { name: hit.name, active: true, kind: "expense" as const };
    if (id === storedId && billing?.rosAccountName) return { name: billing.rosAccountName, active: false, kind: "expense" as const };
    return null;
  };

  const clearError = (k: FieldKey) =>
    setErrors((e) => {
      if (!e[k]) return e;
      const next = { ...e };
      delete next[k];
      return next;
    });

  const focus = (k: string) => {
    const el = document.getElementById(ids[k as FieldKey] ?? "");
    if (el) el.focus();
  };

  const cta = mode === "close" ? "Close work order" : "Save billing";

  async function submit() {
    if (busy) return;
    const raw = {
      workCompletedDescription: description,
      noOwnerCharge: noCharge,
      billAmount: bill,
      cost,
      rosAccountId: accountId || null,
      billPropertyLevel: propertyLevel,
      account: accountFor(accountId),
    };
    const all = validateBillingFieldsAll(raw) as Partial<Record<FieldKey, string>>;
    setErrors(all);
    const first = FIELD_ORDER.find((k) => all[k]);
    if (first) {
      toast.error(all[first]!);
      focus(first);
      return;
    }
    const res = validateBillingFields(raw);
    if (!res.ok) {
      // Unreachable (the "all" check above passed); kept so a rule change can't submit bad data.
      setErrors({ [res.field]: res.message });
      toast.error(res.message);
      focus(res.field);
      return;
    }
    const fields = {
      workCompletedDescription: res.value.workCompletedDescription,
      noOwnerCharge: res.value.noOwnerCharge,
      billAmountCents: res.value.billAmountCents,
      costCents: res.value.costCents,
      rosAccountId: res.value.rosAccountId ?? undefined,
      billPropertyLevel: res.value.billPropertyLevel,
    };
    setBusy(true);
    try {
      if (mode === "close") {
        await reviewClose({ workOrderId, note: note.trim() || undefined, ...fields });
        toast.success(`WO-${woNumber} closed.`);
      } else {
        await updateBilling({ workOrderId, ...fields });
        toast.success(`Billing updated for WO-${woNumber}.`);
      }
      onDone();
    } catch (e) {
      const err = serverError(e);
      toast.error(err.message);
      if (err.field && (FIELD_ORDER as readonly string[]).includes(err.field)) {
        setErrors({ [err.field]: err.message });
        focus(err.field);
      }
    } finally {
      setBusy(false);
    }
  }

  const footer = renderFooter ? (
    renderFooter({ submit: () => void submit(), busy, label: cta })
  ) : (
    <div className="flex justify-end gap-2">
      <Btn disabled={busy} onClick={onCancel}>
        Back
      </Btn>
      <Btn variant="pri" disabled={busy} onClick={() => void submit()}>
        {busy ? "Saving…" : cta}
      </Btn>
    </div>
  );

  const errId = (k: FieldKey) => (errors[k] ? `${ids[k]}-err` : undefined);

  return (
    <>
      <div className={cx("flex flex-col gap-4", bodyClassName)}>
        {title ? (
          <div>
            <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
            {hint ? <p className="mt-0.5 text-[12.5px] text-muted-foreground">{hint}</p> : null}
          </div>
        ) : null}
        <Field
          label="Description of work completed *"
          htmlFor={ids.workCompletedDescription}
          hint="Prints as the memo on the owner statement."
        >
          <Textarea
            id={ids.workCompletedDescription}
            value={description}
            maxLength={MAX_WORK_DESCRIPTION}
            rows={4}
            onChange={(e) => {
              setDescription(e.target.value);
              clearError("workCompletedDescription");
            }}
            aria-invalid={!!errors.workCompletedDescription}
            aria-describedby={errId("workCompletedDescription")}
            className={cx(errors.workCompletedDescription && INVALID)}
          />
          <FieldError id={`${ids.workCompletedDescription}-err`} message={errors.workCompletedDescription} />
        </Field>

        <div className="flex items-start gap-3">
          <Toggle
            checked={noCharge}
            label="No charge to owner"
            onChange={(next) => {
              setNoCharge(next);
              clearError("billAmountCents");
              clearError("rosAccountId");
            }}
          />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-foreground">No charge to owner</div>
            <p className="text-xs text-muted-foreground">
              Keeps this work order off the owner statement (warranty, tenant-caused, internal).
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {noCharge ? null : (
            <Field
              label="Bill amount *"
              htmlFor={ids.billAmountCents}
              hint="What the owner is charged. Prints on the owner statement."
            >
              <MoneyInput
                id={ids.billAmountCents}
                value={bill}
                onChange={(v) => {
                  setBill(v);
                  clearError("billAmountCents");
                }}
                invalid={!!errors.billAmountCents}
                describedBy={errId("billAmountCents")}
              />
              <FieldError id={`${ids.billAmountCents}-err`} message={errors.billAmountCents} />
            </Field>
          )}
          <Field label="Cost" htmlFor={ids.costCents} hint="Internal only. Never shown to owners.">
            <MoneyInput
              id={ids.costCents}
              value={cost}
              onChange={(v) => {
                setCost(v);
                clearError("costCents");
              }}
              invalid={!!errors.costCents}
              describedBy={errId("costCents")}
            />
            <FieldError id={`${ids.costCents}-err`} message={errors.costCents} />
          </Field>
        </div>

        {noCharge ? null : (
          <div>
            <Field label="Account *" htmlFor={ids.rosAccountId}>
              <Select
                id={ids.rosAccountId}
                value={accountId}
                onChange={(e) => {
                  setAccountChoice(e.target.value);
                  clearError("rosAccountId");
                }}
                disabled={accounts === undefined}
                placeholder={accounts === undefined ? "Loading accounts…" : "Select an account"}
                aria-label="Account"
                aria-describedby={errId("rosAccountId")}
                className={cx(errors.rosAccountId && INVALID)}
              >
                <option value="">{accounts === undefined ? "Loading accounts…" : "Select an account"}</option>
                {storedMissing && billing?.rosAccountName ? (
                  <option value={storedId!}>{`${billing.rosAccountName} (turned off)`}</option>
                ) : null}
                {list.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <FieldError id={`${ids.rosAccountId}-err`} message={errors.rosAccountId} />
            </Field>
          </div>
        )}

        <div className="flex items-start gap-3">
          <Toggle checked={propertyLevel} label="Bill at property level" onChange={setPropertyLevel} />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-foreground">Bill at property level</div>
            <p className="text-xs text-muted-foreground">
              The statement shows &ldquo;Property level&rdquo; instead of the unit. The work order keeps its unit.
            </p>
          </div>
        </div>

        {mode === "close" ? (
          <Field label="Note (optional)" htmlFor={ids.note}>
            <Textarea id={ids.note} value={note} maxLength={1000} rows={2} onChange={(e) => setNote(e.target.value)} />
          </Field>
        ) : null}
      </div>
      {footer}
    </>
  );
}

/** Read-only Billing summary after close, with "Edit billing" while finance may still change it. */
export function BillingBlock({ billing, onEdit }: { billing: BillingInfo; onEdit?: () => void }) {
  const items: Array<{ label: ReactNode; value: ReactNode }> = [
    {
      label: "Description",
      value: billing.workCompletedDescription ? (
        <span className="whitespace-pre-wrap">{billing.workCompletedDescription}</span>
      ) : (
        "Not set"
      ),
    },
  ];
  if (billing.noOwnerCharge) {
    items.push({ label: "Bill", value: "No charge to owner" });
  } else {
    items.push(
      { label: "Bill", value: billing.billAmountCents !== null ? formatCurrency(billing.billAmountCents) : "Not set" },
      { label: "Account", value: billing.rosAccountName ?? "Not set" },
    );
  }
  items.push(
    { label: "Cost (internal)", value: billing.costCents !== null ? formatCurrency(billing.costCents) : "Not set" },
    { label: "Property level", value: billing.billPropertyLevel ? "Yes" : "No" },
    { label: "Statement", value: billing.billedLabel ?? (billing.noOwnerCharge ? "Not billed" : "Not billed yet") },
  );
  return (
    <div className="flex flex-col gap-3">
      <KeyValue items={items} />
      {billing.canEdit && onEdit ? (
        <div>
          <Btn sm onClick={onEdit}>
            <Pencil aria-hidden className="h-3.5 w-3.5" /> Edit billing
          </Btn>
        </div>
      ) : null}
    </div>
  );
}
