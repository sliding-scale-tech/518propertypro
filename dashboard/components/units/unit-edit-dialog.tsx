"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { MAX_PHONES } from "@/convex/leaseLib";
import { formatCurrency, formatMonth } from "@/convex/rosFormat";
import {
  LEASE_TYPE_LABEL,
  LEASE_TYPE_VALUES,
  MAX_LEASING_FACTS,
  MAX_PARKING,
  OCCUPANCY_LABEL,
  OCCUPANCY_VALUES,
  RENT_PAID_TO_LABEL,
  RENT_PAID_TO_VALUES,
  UNIT_EDIT_MSG,
  editSections,
  moveOutField,
  unitEditChanges,
  unitEditOrder,
  validateUnitEdit,
  type EditSection,
  type UnitEditRaw,
} from "@/convex/unitEditLib";
import { MAX_RENT_CHANGE_NOTE, rentChangeMonthOptions } from "@/convex/unitRentPolicy";
import { Btn, DatePicker, Field, IconBtn, Input, Modal, Select, Textarea, Toggle } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { MoneyInput, Spinner, useFieldErrors } from "@/components/finance/form-bits";
import { UNIT_TYPES, type Manager, type UnitRow } from "./types";

/**
 * B45 "Edit unit": ONE dialog with every change a unit can take, and ONE Save (unitEdit.saveAll,
 * a single server mutation, all or nothing). Sections, in order: Details · Availability & roster ·
 * Rent · Tenant · Asset manager · Danger zone (Remove unit, its own confirm).
 *
 * Only the fields that really changed are sent (unitEditLib.unitEditChanges, which the server runs
 * again against the unit as it is then). The form runs the server's own validation
 * (unitEditLib.validateUnitEdit): every bad field gets a red border and its message under it, the
 * first is toasted and focused; a server error that names a field is shown the same way. Sections
 * the viewer may not change are shown read-only with "Ask an admin" (the server enforces it).
 */

export type UnitEditFocus = "tenant" | null;

type Ctx = NonNullable<FunctionReturnType<typeof api.unitEdit.context>>;

const SECTION_WORD: Record<EditSection, string> = {
  details: "details",
  roster: "availability and roster",
  rent: "rent",
  tenancy: "tenant",
  manager: "asset manager",
};

export function UnitEditDialog({
  unit,
  propertyName,
  managers,
  focus = null,
  startReplace = false,
  onClose,
}: {
  unit: UnitRow;
  propertyName: string;
  managers: Manager[];
  /** "tenant": open scrolled to the Tenant section (the unit ⋯ menu's New renter… / Move out…). */
  focus?: UnitEditFocus;
  /** Open with "Replace with a new renter" ticked (the ⋯ menu's New renter…). */
  startReplace?: boolean;
  onClose: () => void;
}) {
  const ctx = useQuery(api.unitEdit.context, { unitId: unit._id });
  return (
    <Modal title={`Edit unit ${unit.unitNumber}`} eyebrow={propertyName} size="lg" onClose={onClose} bare>
      {ctx === undefined ? (
        <Spinner label="Loading the unit…" />
      ) : ctx === null ? (
        <p className="p-[22px] text-sm text-muted-foreground">You can't edit this unit. Ask an admin.</p>
      ) : (
        <UnitEditForm unit={unit} ctx={ctx} managers={managers} focus={focus} startReplace={startReplace} onClose={onClose} />
      )}
    </Modal>
  );
}

function domKey(k: string): string {
  return k.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function Section({
  id,
  title,
  readOnlyNote,
  children,
}: {
  id?: string;
  title: string;
  readOnlyNote?: string | null;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4 border-b border-border px-[22px] py-5 last:border-b-0">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{title}</h3>
        {readOnlyNote ? <span className="text-xs text-muted-foreground">{readOnlyNote}</span> : null}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function UnitEditForm({
  unit,
  ctx,
  managers,
  focus,
  startReplace,
  onClose,
}: {
  unit: UnitRow;
  ctx: Ctx;
  managers: Manager[];
  focus: UnitEditFocus;
  startReplace: boolean;
  onClose: () => void;
}) {
  const save = useMutation(api.unitEdit.saveAll);
  const removeUnit = useMutation(api.units.remove);
  const { perms } = ctx;
  const base = useId();
  const formId = `${base}-form`;
  const tenantId = `${base}-tenant`;
  const residentIds = useMemo(() => ctx.residents.map((r) => r._id as string), [ctx.residents]);
  const order = useMemo(() => unitEditOrder(residentIds), [residentIds]);
  const ids = useMemo(() => {
    const m: Record<string, string> = {};
    for (const k of order) m[k] = `${base}-${domKey(k)}`;
    return m;
  }, [base, order]);
  const f = useFieldErrors(ids);

  // 1. Details
  const [unitNumber, setUnitNumber] = useState(unit.unitNumber);
  const [bedrooms, setBedrooms] = useState(unit.bedrooms);
  const [bathrooms, setBathrooms] = useState(unit.bathrooms?.toString() ?? "");
  const [floor, setFloor] = useState(unit.floor?.toString() ?? "");
  const [isTopFloor, setIsTopFloor] = useState(unit.isTopFloor ?? false);
  const [parking, setParking] = useState(unit.parking ?? "");
  const [availableFrom, setAvailableFrom] = useState(unit.availableFrom ?? "");
  const [leasingFacts, setLeasingFacts] = useState(unit.leasingFacts ?? "");
  // 2. Availability & roster ("" = not stated)
  const [available, setAvailable] = useState(unit.available ? "yes" : "no");
  const [occupancy, setOccupancy] = useState<string>(unit.occupancy ?? "");
  const [leaseType, setLeaseType] = useState<string>(unit.leaseType ?? "");
  const [rentPaidTo, setRentPaidTo] = useState<string>(unit.rentPaidTo ?? "");
  // 3. Rent
  const [rent, setRent] = useState("");
  const [effectiveMonth, setEffectiveMonth] = useState("");
  const [rentNote, setRentNote] = useState("");
  const months = useMemo(() => rentChangeMonthOptions(ctx.rentToday), [ctx.rentToday]);
  // 4. Tenant
  const [moveOuts, setMoveOuts] = useState<Record<string, { on: boolean; date: string }>>(() =>
    Object.fromEntries(ctx.residents.map((r) => [r._id, { on: startReplace, date: ctx.today }])),
  );
  const [replace, setReplace] = useState(startReplace && perms.newRenter);
  const [fullName, setFullName] = useState("");
  const [phones, setPhones] = useState<string[]>([""]);
  const [email, setEmail] = useState("");
  const [leaseStart, setLeaseStart] = useState("");
  const [leaseEnd, setLeaseEnd] = useState("");
  // 5. Asset manager
  const [amId, setAmId] = useState<string>(unit.assetManagerUserId);
  const [reason, setReason] = useState("");
  // 6. Danger zone
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (focus !== "tenant") return;
    const id = requestAnimationFrame(() => document.getElementById(tenantId)?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(id);
  }, [focus, tenantId]);

  const amChanged = amId !== unit.assetManagerUserId;
  const knownAm = managers.some((m) => m.userId === unit.assetManagerUserId);

  function raw(): UnitEditRaw {
    return {
      details: perms.details
        ? { unitNumber, bedrooms, bathrooms, floor, isTopFloor, parking, availableFrom, leasingFacts }
        : undefined,
      roster: perms.roster ? { available: available === "yes", occupancy, leaseType, rentPaidTo } : undefined,
      rent: perms.rent ? { rent, effectiveMonth, note: rentNote } : undefined,
      moveOuts: perms.moveOut
        ? Object.entries(moveOuts)
            .filter(([, m]) => m.on)
            .map(([residentId, m]) => ({ residentId, moveOutDate: m.date }))
        : undefined,
      newRenter: perms.newRenter && replace ? { fullName, phones, email, leaseStart, leaseEnd } : undefined,
      manager: perms.manager ? { assetManagerUserId: amId, reason } : undefined,
    };
  }

  async function submit() {
    if (busy) return;
    const changes = unitEditChanges(
      {
        unitNumber: unit.unitNumber,
        bedrooms: unit.bedrooms,
        floor: unit.floor,
        bathrooms: unit.bathrooms,
        isTopFloor: unit.isTopFloor,
        parking: unit.parking,
        availableFrom: unit.availableFrom,
        leasingFacts: unit.leasingFacts,
        available: unit.available,
        occupancy: unit.occupancy,
        leaseType: unit.leaseType,
        rentPaidTo: unit.rentPaidTo,
        assetManagerUserId: unit.assetManagerUserId,
      },
      raw(),
    );
    const sections = editSections(changes);
    if (sections.length === 0) {
      f.setErrors({});
      toast.info(UNIT_EDIT_MSG.nothing);
      return;
    }
    const errs = validateUnitEdit(changes, { today: ctx.today, rentToday: ctx.rentToday, residents: ctx.residents });
    if (!f.check(errs, order)) return;
    setBusy(true);
    try {
      const out = await save({
        unitId: unit._id,
        details: changes.details ?? undefined,
        roster: changes.roster ?? undefined,
        rent: changes.rent ?? undefined,
        moveOuts: changes.moveOuts ? changes.moveOuts.map((m) => ({ residentId: m.residentId ?? null, moveOutDate: m.moveOutDate ?? null })) : undefined,
        newRenter: changes.newRenter
          ? {
              fullName: changes.newRenter.fullName ?? null,
              phones: (changes.newRenter.phones ?? []).map((p) => p ?? null).filter((p) => (p ?? "").trim() !== ""),
              email: changes.newRenter.email ?? null,
              leaseStart: changes.newRenter.leaseStart ?? null,
              leaseEnd: changes.newRenter.leaseEnd ?? null,
            }
          : undefined,
        manager: changes.manager ?? undefined,
      });
      toast.success(`${ctx.label} saved: ${out.sections.map((s) => SECTION_WORD[s as EditSection] ?? s).join(", ")}.`);
      // Paid months keep their payment: say so (exact wording from the server).
      if (out.info.length > 0) toast.info(out.info.join(" "), { duration: 9000 });
      onClose();
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  async function doRemove() {
    setBusy(true);
    try {
      await removeUnit({ unitId: unit._id });
      toast.success(`Unit ${unit.unitNumber} removed.`);
      onClose();
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  const text = (field: string, set: (v: string) => void) => (v: string) => {
    set(v);
    f.clear(field);
  };
  const askAdmin = "Only an admin can change this. Ask an admin.";
  const tenantLocked = !perms.moveOut && !perms.newRenter;
  const movingCount = Object.values(moveOuts).filter((m) => m.on).length;
  const nobodyLeft = ctx.residents.length > 0 && movingCount === ctx.residents.length && !replace;

  return (
    <>
      <form
        id={formId}
        noValidate
        className="flex flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {/* 1. Details */}
        <Section title="Details" readOnlyNote={perms.details ? null : "You can only edit units you manage."}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Unit number *" htmlFor={ids.unitNumber}>
              <Input
                id={ids.unitNumber}
                value={unitNumber}
                maxLength={40}
                disabled={!perms.details}
                onChange={(e) => text("unitNumber", setUnitNumber)(e.target.value)}
                {...f.control("unitNumber")}
              />
              {f.message("unitNumber")}
            </Field>
            <Field label="Unit type *" htmlFor={ids.bedrooms}>
              <Select
                id={ids.bedrooms}
                value={bedrooms}
                disabled={!perms.details}
                onChange={(e) => text("bedrooms", setBedrooms)(e.target.value ?? "")}
                {...f.control("bedrooms")}
              >
                <option value="">Select unit type</option>
                {bedrooms && !(UNIT_TYPES as readonly string[]).includes(bedrooms) ? <option value={bedrooms}>{bedrooms}</option> : null}
                {UNIT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
              {f.message("bedrooms")}
            </Field>
            <Field label="Baths" htmlFor={ids.bathrooms} hint="Like 1 or 1.5.">
              <Input
                id={ids.bathrooms}
                inputMode="decimal"
                value={bathrooms}
                disabled={!perms.details}
                onChange={(e) => text("bathrooms", setBathrooms)(e.target.value)}
                {...f.control("bathrooms")}
              />
              {f.message("bathrooms")}
            </Field>
            <Field label="Floor" htmlFor={ids.floor} hint="Whole number; 0 for the basement.">
              <Input
                id={ids.floor}
                inputMode="numeric"
                value={floor}
                disabled={!perms.details}
                onChange={(e) => text("floor", setFloor)(e.target.value)}
                {...f.control("floor")}
              />
              {f.message("floor")}
            </Field>
          </div>
          <label className="flex items-center gap-2.5 text-[13.5px]">
            <Toggle label="Top floor" checked={isTopFloor} disabled={!perms.details} onChange={setIsTopFloor} />
            Top floor <span className="text-xs text-muted-foreground">(Sarah uses this for roof and leak calls)</span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Parking" htmlFor={ids.parking} hint="Optional.">
              <Input
                id={ids.parking}
                value={parking}
                maxLength={MAX_PARKING}
                disabled={!perms.details}
                onChange={(e) => text("parking", setParking)(e.target.value)}
                {...f.control("parking")}
              />
              {f.message("parking")}
            </Field>
            <Field label="Available from" htmlFor={ids.availableFrom} hint="Optional. Told to callers while the unit is available.">
              <DatePicker
                id={ids.availableFrom}
                value={availableFrom}
                disabled={!perms.details}
                onChange={text("availableFrom", setAvailableFrom)}
                {...f.control("availableFrom")}
              />
              {f.message("availableFrom")}
            </Field>
          </div>
          <Field label="Leasing notes" htmlFor={ids.leasingFacts} hint="Optional. What Sarah may tell callers about this unit.">
            <Textarea
              id={ids.leasingFacts}
              value={leasingFacts}
              maxLength={MAX_LEASING_FACTS}
              disabled={!perms.details}
              onChange={(e) => text("leasingFacts", setLeasingFacts)(e.target.value)}
              {...f.control("leasingFacts")}
            />
            {f.message("leasingFacts")}
          </Field>
        </Section>

        {/* 2. Availability & roster */}
        <Section title="Availability & roster" readOnlyNote={perms.roster ? null : "You can only edit units you manage."}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Available" htmlFor={ids.available} hint="Sarah offers the unit to callers only when it is available.">
              <Select id={ids.available} value={available} disabled={!perms.roster} onChange={(e) => text("available", setAvailable)(e.target.value || "no")}>
                <option value="yes">Yes, offer it to callers</option>
                <option value="no">No</option>
              </Select>
            </Field>
            <Field label="Roster occupancy" htmlFor={ids.occupancy}>
              <Select
                id={ids.occupancy}
                value={occupancy}
                disabled={!perms.roster}
                onChange={(e) => text("occupancy", setOccupancy)(e.target.value ?? "")}
                {...f.control("occupancy")}
              >
                <option value="">Not stated</option>
                {OCCUPANCY_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {OCCUPANCY_LABEL[v]}
                  </option>
                ))}
              </Select>
              {f.message("occupancy")}
            </Field>
            <Field label="Lease type" htmlFor={ids.leaseType}>
              <Select
                id={ids.leaseType}
                value={leaseType}
                disabled={!perms.roster}
                onChange={(e) => text("leaseType", setLeaseType)(e.target.value ?? "")}
                {...f.control("leaseType")}
              >
                <option value="">Not stated</option>
                {LEASE_TYPE_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {LEASE_TYPE_LABEL[v]}
                  </option>
                ))}
              </Select>
              {f.message("leaseType")}
            </Field>
            <Field label="Rent paid to" htmlFor={ids.rentPaidTo} hint="Owner statements use this to decide who collects the rent.">
              <Select
                id={ids.rentPaidTo}
                value={rentPaidTo}
                disabled={!perms.roster}
                onChange={(e) => text("rentPaidTo", setRentPaidTo)(e.target.value ?? "")}
                {...f.control("rentPaidTo")}
              >
                <option value="">Not stated</option>
                {RENT_PAID_TO_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {RENT_PAID_TO_LABEL[v]}
                  </option>
                ))}
              </Select>
              {f.message("rentPaidTo")}
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            Owner statements treat the unit as vacant when the occupancy or the lease type says Vacant. A new renter or the last
            move-out below updates these automatically, unless you change them here in the same save.
          </p>
        </Section>

        {/* 3. Rent */}
        <Section title="Rent" readOnlyNote={perms.rent ? null : askAdmin}>
          <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-[13px]">
            <div className="text-[12px] text-muted-foreground">Rent now</div>
            <div className="text-[17px] font-semibold tabular-nums">
              {ctx.rent.cents !== null ? `${formatCurrency(ctx.rent.cents)}/month` : "No rent set"}
            </div>
            <div className="text-xs text-muted-foreground">
              {ctx.rent.fromMonth ? `Since ${formatMonth(ctx.rent.fromMonth)}` : ctx.rent.hasHistory ? "Before the first rent change" : "From the roster"}
              {ctx.rent.upcoming ? ` · changes to ${formatCurrency(ctx.rent.upcoming.cents)} from ${formatMonth(ctx.rent.upcoming.month)}` : ""}
            </div>
          </div>
          {perms.rent ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="New rent" htmlFor={ids.rent} hint="Leave blank to keep the rent. The full rent for a month.">
                  <MoneyInput
                    id={ids.rent}
                    value={rent}
                    onChange={text("rent", setRent)}
                    invalid={Boolean(f.errors.rent)}
                    describedBy={f.errors.rent ? `${ids.rent}-err` : undefined}
                  />
                  {f.message("rent")}
                </Field>
                <Field label={rent.trim() ? "Effective from *" : "Effective from"} htmlFor={ids.effectiveMonth} hint="Months already marked paid keep the amount they were paid at.">
                  <Select
                    id={ids.effectiveMonth}
                    value={effectiveMonth}
                    onChange={(e) => text("effectiveMonth", setEffectiveMonth)(e.target.value ?? "")}
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
              </div>
              <Field label="Rent note" htmlFor={ids.note} hint="Optional, for example “Lease renewal”.">
                <Input id={ids.note} value={rentNote} maxLength={MAX_RENT_CHANGE_NOTE} onChange={(e) => text("note", setRentNote)(e.target.value)} {...f.control("note")} />
                {f.message("note")}
              </Field>
            </>
          ) : null}
        </Section>

        {/* 4. Tenant */}
        <Section id={tenantId} title="Tenant" readOnlyNote={tenantLocked ? "You can only change the tenant of units you manage." : null}>
          {ctx.residents.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Nobody lives in this unit right now.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {ctx.residents.map((r) => {
                const m = moveOuts[r._id] ?? { on: false, date: ctx.today };
                const key = moveOutField(r._id);
                const set = (next: { on: boolean; date: string }) => {
                  setMoveOuts((all) => ({ ...all, [r._id]: next }));
                  f.clear(key);
                };
                return (
                  <li key={r._id} className="rounded-xl border border-border px-3.5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[13.5px]">
                        <span className="font-medium">{r.fullName}</span>
                        {r.leaseEnd ? <span className="text-muted-foreground"> · lease end {r.leaseEnd}</span> : null}
                      </div>
                      {perms.moveOut ? (
                        <label className="inline-flex items-center gap-2 text-[13px]">
                          <Toggle label={`Move out ${r.fullName}`} checked={m.on} onChange={(on) => set({ ...m, on })} />
                          Move out
                        </label>
                      ) : null}
                    </div>
                    {m.on ? (
                      <Field label="Move-out date *" htmlFor={ids[key]} className="mt-3">
                        <DatePicker id={ids[key]} value={m.date} onChange={(date) => set({ ...m, date })} {...f.control(key)} />
                        {f.message(key)}
                      </Field>
                    ) : f.errors[key] ? (
                      <div className="mt-2" id={ids[key]} tabIndex={-1}>
                        {f.message(key)}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {nobodyLeft ? (
            <p className="text-xs text-muted-foreground">
              Nobody will be left in the unit: its roster will say Vacant. To offer it to callers, set Available to Yes above.
            </p>
          ) : null}

          {perms.newRenter ? (
            <label className="flex items-start gap-2.5 text-[13.5px]">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
                checked={replace}
                onChange={(e) => {
                  setReplace(e.target.checked);
                  // Replacing moves everyone out; turning it off leaves the toggles as they are.
                  if (e.target.checked) {
                    setMoveOuts((all) => Object.fromEntries(Object.entries(all).map(([id, m]) => [id, { ...m, on: true }])));
                  }
                }}
              />
              <span>
                {ctx.residents.length > 0 ? "Replace with a new renter" : "Add a new renter"}
                <span className="block text-xs text-muted-foreground">
                  The new renter is added, the unit stops being offered to callers and its roster says Occupied.
                </span>
              </span>
            </label>
          ) : null}

          {replace && perms.newRenter ? (
            <div className="flex flex-col gap-4 rounded-xl border border-border bg-muted/30 px-3.5 py-3.5">
              <Field label="New renter's full name *" htmlFor={ids.fullName}>
                <Input
                  id={ids.fullName}
                  value={fullName}
                  maxLength={120}
                  autoComplete="off"
                  onChange={(e) => text("fullName", setFullName)(e.target.value)}
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
                  {f.message("phones")}
                  {phones.length < MAX_PHONES ? (
                    <button type="button" onClick={() => setPhones([...phones, ""])} className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                      <Plus className="h-3.5 w-3.5" />
                      Add phone
                    </button>
                  ) : null}
                </div>
              </Field>
              <Field label="Email" hint="Optional." htmlFor={ids.email}>
                <Input id={ids.email} type="email" value={email} maxLength={200} onChange={(e) => text("email", setEmail)(e.target.value)} {...f.control("email")} />
                {f.message("email")}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Lease start" hint="Optional." htmlFor={ids.leaseStart}>
                  <DatePicker id={ids.leaseStart} value={leaseStart} onChange={text("leaseStart", setLeaseStart)} {...f.control("leaseStart")} />
                  {f.message("leaseStart")}
                </Field>
                <Field label="Lease end" hint="Optional. No end = month to month." htmlFor={ids.leaseEnd}>
                  <DatePicker id={ids.leaseEnd} value={leaseEnd} onChange={text("leaseEnd", setLeaseEnd)} {...f.control("leaseEnd")} />
                  {f.message("leaseEnd")}
                </Field>
              </div>
              <p className="text-xs text-muted-foreground">
                {perms.rent
                  ? "To change the rent for the new renter, set New rent and its month in Rent above."
                  : "The rent stays as it is. Ask an admin to change it for the new renter."}
              </p>
            </div>
          ) : null}
        </Section>

        {/* 5. Asset manager */}
        <Section title="Asset manager" readOnlyNote={perms.manager ? null : askAdmin}>
          {perms.manager ? (
            <>
              <Field label="Asset manager *" htmlFor={ids.assetManagerUserId} hint="Open maintenance requests on this unit move to the new asset manager.">
                <Select
                  id={ids.assetManagerUserId}
                  value={amId}
                  onChange={(e) => text("assetManagerUserId", setAmId)(e.target.value ?? "")}
                  {...f.control("assetManagerUserId")}
                >
                  <option value="">Select the asset manager</option>
                  {!knownAm ? <option value={unit.assetManagerUserId}>{ctx.assetManagerName}</option> : null}
                  {managers.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </Select>
                {f.message("assetManagerUserId")}
              </Field>
              {amChanged ? (
                <Field label="Reason for the change *" htmlFor={ids.reason} hint="Kept in the unit's asset manager history.">
                  <Textarea id={ids.reason} value={reason} maxLength={500} onChange={(e) => text("reason", setReason)(e.target.value)} {...f.control("reason")} />
                  {f.message("reason")}
                </Field>
              ) : null}
            </>
          ) : (
            <p className="text-[13.5px]">{ctx.assetManagerName}</p>
          )}
        </Section>
      </form>

      {/* 6. Danger zone (not part of Save: its own confirm) */}
      {perms.remove ? (
        <section className="mx-[22px] mb-5 rounded-xl border border-danger-ink/40 px-3.5 py-3">
          <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-danger-ink">Danger zone</h3>
          {confirmRemove ? (
            <div className="mt-2 flex flex-col gap-3">
              <p className="text-sm">
                Remove unit {unit.unitNumber}? This permanently deletes the unit and its rent history. It cannot be undone.
              </p>
              <div className="flex justify-end gap-2">
                <Btn sm onClick={() => setConfirmRemove(false)} disabled={busy}>
                  Cancel
                </Btn>
                <Btn sm variant="dng" onClick={() => void doRemove()} disabled={busy}>
                  Remove unit
                </Btn>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Deletes the unit and its rent history.</p>
              <Btn sm variant="dng" onClick={() => setConfirmRemove(true)} disabled={busy}>
                <Trash2 aria-hidden className="h-3.5 w-3.5" />
                Remove unit…
              </Btn>
            </div>
          )}
        </section>
      ) : null}

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-card px-[22px] py-3.5">
        <Btn onClick={onClose} disabled={busy}>
          Cancel
        </Btn>
        <Btn type="submit" form={formId} variant="pri" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Btn>
      </div>
    </>
  );
}
