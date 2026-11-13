"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Plus, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import {
  LEASE_TAG_LABEL,
  NEW_RENTER_ORDER,
  MAX_PHONES,
  validateMoveOut,
  validateNewRenter,
  validateRenewal,
  type LeaseTag,
} from "@/convex/leaseLib";
import { formatCurrency } from "@/convex/rosFormat";
import { Btn, DatePicker, Field, IconBtn, Input, Modal, Pill, Select } from "@/components/ui";
import { errorMessage as errorText, toast } from "@/components/ui/toast";
import { MoneyInput, Spinner, useFieldErrors } from "@/components/finance/form-bits";

/**
 * B44 lease flows: New renter, Move out, Renewed, the lease tag and the follow-up's one-click
 * resolutions. Every form runs the same validation as the server (convex/leaseLib.ts), marks each
 * bad field (red border, message under it) and toasts the first; a server error that names a field
 * is shown the same way. The server re-checks everything (convex/leases.ts).
 */

// --- Lease tag -------------------------------------------------------------------------------------

const TAG_TONE: Record<LeaseTag, "bad" | "warn" | "neutral"> = { ended: "bad", ending_soon: "warn", month_to_month: "neutral" };

export function LeaseTagPill({ tag }: { tag: LeaseTag | null | undefined }) {
  if (!tag) return null;
  return <Pill tone={TAG_TONE[tag]}>{LEASE_TAG_LABEL[tag]}</Pill>;
}

// --- New renter ------------------------------------------------------------------------------------

export function NewRenterDialog({ unitId, onClose }: { unitId: string; onClose: () => void }) {
  const ctx = useQuery(api.leases.unitContext, { unitId });
  return (
    <Modal title="New renter" eyebrow={ctx?.label} onClose={onClose}>
      {ctx === undefined ? (
        <Spinner label="Loading the unit…" />
      ) : ctx === null || !ctx.canNewRenter ? (
        <p className="text-sm text-muted-foreground">You can only add residents to units you manage. Ask an admin.</p>
      ) : (
        <NewRenterForm ctx={ctx} onDone={onClose} onCancel={onClose} />
      )}
    </Modal>
  );
}

type UnitCtx = NonNullable<FunctionReturnType<typeof api.leases.unitContext>>;

function NewRenterForm({ ctx, onDone, onCancel }: { ctx: UnitCtx; onDone: () => void; onCancel: () => void }) {
  const save = useMutation(api.leases.newRenter);
  const base = useId();
  const ids = useMemo(() => {
    const m: Record<string, string> = {};
    for (const k of NEW_RENTER_ORDER) m[k] = `${base}-${k}`;
    return m;
  }, [base]);
  const f = useFieldErrors(ids);
  const hasCurrent = ctx.current.length > 0;
  const [moveOutDate, setMoveOutDate] = useState(ctx.today);
  const [fullName, setFullName] = useState("");
  const [phones, setPhones] = useState<string[]>([""]);
  const [email, setEmail] = useState("");
  const [leaseStart, setLeaseStart] = useState("");
  const [leaseEnd, setLeaseEnd] = useState("");
  const [rent, setRent] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    const input = { hasCurrent, moveOutDate, fullName, phones, email, leaseStart, leaseEnd, rent, today: ctx.today };
    if (!f.check(validateNewRenter(input), NEW_RENTER_ORDER)) return;
    setBusy(true);
    try {
      const out = await save({
        unitId: ctx.unitId,
        moveOutDate: hasCurrent ? moveOutDate : null,
        fullName,
        phones: phones.filter((p) => p.trim() !== ""),
        email: email.trim() || null,
        leaseStart: leaseStart || null,
        leaseEnd: leaseEnd || null,
        rent: ctx.canChangeRent ? rent.trim() || null : null,
      });
      toast.success(
        `${fullName.trim()} is the new renter of ${ctx.label}.${out.movedOut > 0 ? ` ${out.movedOut} resident${out.movedOut === 1 ? "" : "s"} moved out.` : ""} The unit is no longer offered to callers.`,
      );
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
      {hasCurrent ? (
        <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-3">
          <div className="text-[12.5px] font-medium text-muted-foreground">Moving out</div>
          <ul className="mt-1 text-[13.5px]">
            {ctx.current.map((r) => (
              <li key={r._id} className="font-medium">
                {r.fullName}
                {r.leaseEnd ? <span className="font-normal text-muted-foreground"> · lease end {r.leaseEnd}</span> : null}
              </li>
            ))}
          </ul>
          <Field label="Move-out date *" htmlFor={ids.moveOutDate} className="mt-3">
            <DatePicker
              id={ids.moveOutDate}
              value={moveOutDate}
              onChange={(v) => {
                setMoveOutDate(v);
                f.clear("moveOutDate");
              }}
              {...f.control("moveOutDate")}
            />
            {f.message("moveOutDate")}
          </Field>
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">Nobody lives in this unit right now.</p>
      )}

      <Field label="New renter's full name *" htmlFor={ids.fullName}>
        <Input
          id={ids.fullName}
          value={fullName}
          maxLength={120}
          autoComplete="off"
          onChange={(e) => {
            setFullName(e.target.value);
            f.clear("fullName");
          }}
          {...f.control("fullName")}
        />
        {f.message("fullName")}
      </Field>

      <Field label="Phone numbers" hint="Optional. 10 digits, like (518) 555-1234." htmlFor={ids.phone0}>
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Lease start" hint="Optional." htmlFor={ids.leaseStart}>
          <DatePicker
            id={ids.leaseStart}
            value={leaseStart}
            onChange={(v) => {
              setLeaseStart(v);
              f.clear("leaseStart");
            }}
            {...f.control("leaseStart")}
          />
          {f.message("leaseStart")}
        </Field>
        <Field label="Lease end" hint="Optional. After the lease start." htmlFor={ids.leaseEnd}>
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
      </div>

      {ctx.canChangeRent ? (
      <Field
        label="Monthly rent"
        htmlFor={ids.rent}
        hint={`Optional. Leave blank to keep ${ctx.rentNowCents !== null ? formatCurrency(ctx.rentNowCents) : "the current rent (none set)"}. A new amount starts in the lease start month (this month when there is no lease start) and is kept in the rent history.`}
      >
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
      ) : (
        <p className="text-xs text-muted-foreground">The rent stays as it is. Ask an admin to change it for the new renter.</p>
      )}

      <p className="text-xs text-muted-foreground">
        Saving moves out the residents above, adds the new renter and stops offering this unit to callers.
      </p>
      <div className="flex justify-end gap-2">
        <Btn onClick={onCancel} disabled={busy}>
          Cancel
        </Btn>
        <Btn type="submit" variant="pri" disabled={busy}>
          {busy ? "Saving…" : "Save new renter"}
        </Btn>
      </div>
    </form>
  );
}

// --- Move out --------------------------------------------------------------------------------------

/** Move out one resident of `unitId` (`residentId` preselects; with several, the user picks). */
export function MoveOutDialog({ unitId, residentId, onClose }: { unitId: string; residentId?: string; onClose: () => void }) {
  const ctx = useQuery(api.leases.unitContext, { unitId });
  return (
    <Modal title="Move out" eyebrow={ctx?.label} onClose={onClose}>
      {ctx === undefined ? (
        <Spinner label="Loading the unit…" />
      ) : ctx === null || !ctx.canMoveOut ? (
        <p className="text-sm text-muted-foreground">You can only record move-outs for units you manage. Ask an admin.</p>
      ) : ctx.current.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody lives in this unit right now.</p>
      ) : (
        <MoveOutForm ctx={ctx} residentId={residentId} onDone={onClose} onCancel={onClose} />
      )}
    </Modal>
  );
}

function MoveOutForm({
  ctx,
  residentId,
  onDone,
  onCancel,
}: {
  ctx: UnitCtx;
  residentId?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const save = useMutation(api.leases.moveOut);
  const base = useId();
  const ids = useMemo(() => ({ residentId: `${base}-who`, moveOutDate: `${base}-date` }), [base]);
  const f = useFieldErrors(ids);
  const initial = ctx.current.find((r) => r._id === residentId)?._id ?? (ctx.current.length === 1 ? ctx.current[0]._id : "");
  const [who, setWho] = useState<string>(initial);
  const [moveOutDate, setMoveOutDate] = useState(ctx.today);
  // Others staying in the unit (roommates) = still occupied, so the default is then off.
  const othersStay = ctx.current.length > 1;
  const [makeAvailable, setMakeAvailable] = useState(!othersStay);
  const [busy, setBusy] = useState(false);
  const person = ctx.current.find((r) => r._id === who);

  async function submit() {
    if (busy) return;
    const errs: Record<string, string> = {};
    if (!who || !person) errs.residentId = "Select who is moving out.";
    Object.assign(errs, validateMoveOut({ moveOutDate, today: ctx.today }));
    if (!f.check(errs, ["residentId", "moveOutDate"])) return;
    setBusy(true);
    try {
      await save({ residentId: who, moveOutDate, makeAvailable });
      toast.success(
        `${person?.fullName ?? "The resident"} moved out of ${ctx.label}.${makeAvailable ? " The unit is offered to callers again." : ""}`,
      );
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
      {ctx.current.length > 1 ? (
        <Field label="Who is moving out *" htmlFor={ids.residentId}>
          <Select
            id={ids.residentId}
            value={who}
            onChange={(e) => {
              setWho(e.target.value || "");
              f.clear("residentId");
            }}
            {...f.control("residentId")}
          >
            <option value="">Select the resident</option>
            {ctx.current.map((r) => (
              <option key={r._id} value={r._id}>
                {r.fullName}
              </option>
            ))}
          </Select>
          {f.message("residentId")}
        </Field>
      ) : (
        <p className="text-[13.5px]">
          <span className="font-medium">{person?.fullName}</span> is moving out.
        </p>
      )}
      <Field label="Move-out date *" htmlFor={ids.moveOutDate}>
        <DatePicker
          id={ids.moveOutDate}
          value={moveOutDate}
          onChange={(v) => {
            setMoveOutDate(v);
            f.clear("moveOutDate");
          }}
          {...f.control("moveOutDate")}
        />
        {f.message("moveOutDate")}
      </Field>
      <label className="flex items-start gap-2.5 text-[13.5px]">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
          checked={makeAvailable}
          onChange={(e) => setMakeAvailable(e.target.checked)}
        />
        <span>
          Make this unit available for new renters
          <span className="block text-xs text-muted-foreground">
            {othersStay
              ? "Others still live here, so this is off by default."
              : ctx.available
                ? "The unit is already offered to callers."
                : "Sarah starts offering the unit to callers."}
          </span>
        </span>
      </label>
      <p className="text-xs text-muted-foreground">
        Their phone numbers stop matching incoming calls. The record and its history are kept.
      </p>
      <div className="flex justify-end gap-2">
        <Btn onClick={onCancel} disabled={busy}>
          Cancel
        </Btn>
        <Btn type="submit" variant="dng" disabled={busy}>
          {busy ? "Saving…" : "Record move-out"}
        </Btn>
      </div>
    </form>
  );
}

// --- Renewed -------------------------------------------------------------------------------------

export function RenewDialog({
  residentId,
  fullName,
  oldLeaseEnd,
  onClose,
}: {
  residentId: string;
  fullName: string;
  oldLeaseEnd?: string | null;
  onClose: () => void;
}) {
  const today = useQuery(api.leases.today);
  const save = useMutation(api.leases.renew);
  const base = useId();
  const ids = useMemo(() => ({ leaseEnd: `${base}-end` }), [base]);
  const f = useFieldErrors(ids);
  const [leaseEnd, setLeaseEnd] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy || !today) return;
    if (!f.check(validateRenewal({ leaseEnd, oldLeaseEnd, today }), ["leaseEnd"])) return;
    setBusy(true);
    try {
      await save({ residentId, leaseEnd });
      toast.success(`${fullName}'s lease now ends ${leaseEnd}.`);
      onClose();
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Lease renewed" eyebrow={fullName} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {oldLeaseEnd ? <p className="text-[13px] text-muted-foreground">The lease ended (or ends) {oldLeaseEnd}.</p> : null}
        <Field label="New lease end *" htmlFor={ids.leaseEnd}>
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
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn type="submit" variant="pri" disabled={busy || !today}>
            {busy ? "Saving…" : "Save new lease end"}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

// --- Follow-up resolutions -----------------------------------------------------------------------

export type LeaseFollowUpTarget = {
  _id: string;
  unitId: string;
  fullName: string;
  leaseEnd?: string | null;
};

/**
 * The three one-click answers to a lease follow-up: Renewed (asks for the new lease end), Moving
 * out (the Move out dialog; the admin view or the unit's own asset manager), Month-to-month (saved
 * at once). Each one closes the open follow-up task on the server.
 */
export function LeaseFollowUpActions({ target, canMoveOut }: { target: LeaseFollowUpTarget; canMoveOut: boolean }) {
  const m2m = useMutation(api.leases.markMonthToMonth);
  const [dialog, setDialog] = useState<"renew" | "move" | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-wrap justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
      <Btn sm onClick={() => setDialog("renew")}>
        Renewed
      </Btn>
      <Btn
        sm
        disabled={!canMoveOut}
        title={canMoveOut ? undefined : "You can only record move-outs for units you manage. Ask an admin."}
        onClick={() => setDialog("move")}
      >
        Moving out
      </Btn>
      <Btn
        sm
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await m2m({ residentId: target._id });
            toast.success(`${target.fullName} is month-to-month. No more lease reminders.`);
          } catch (e) {
            toast.error(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Month-to-month
      </Btn>
      {dialog === "renew" ? (
        <RenewDialog residentId={target._id} fullName={target.fullName} oldLeaseEnd={target.leaseEnd} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "move" ? <MoveOutDialog unitId={target.unitId} residentId={target._id} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
