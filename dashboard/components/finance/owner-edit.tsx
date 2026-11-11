"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AlertTriangle, Link2, Unlink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import {
  MAX_AMOUNT_CENTS,
  formatBps,
  formatMonth,
  parseDollarsToCents,
  parseSignedDollarsToCents,
  prevMonth,
} from "@/convex/rosFormat";
import {
  FEE_MSG,
  MAX_CONTACT_NAME,
  MAX_LEGAL_NAME,
  MAX_PAYEE_NAME,
  readFeeInput,
  validateOwnerFields,
  validateOwnerFieldsAll,
} from "@/convex/rosPolicy";
import { Btn, Card, CardHead, ConfirmDialog, Field, Input, PageHeader, Select, Toggle } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { serverError } from "@/lib/form-errors";
import { FinanceNav, useNow } from "./finance-nav";
import { MoneyInput, Spinner, centsToInput, useFieldErrors } from "./form-bits";
import { currentMonth } from "./months";
import { ANCHOR, revealSection } from "./warning-links";

type OwnerDoc = NonNullable<FunctionReturnType<typeof api.owners.get>>;
type LinkRow = OwnerDoc["links"][number];

const OWNER_ORDER = ["legalName", "contactFirstName", "contactLastName", "emails", "payeeName", "active"];

/** Exact server messages (owners.ts, spec 5.2). */
const M = {
  propertyMissing: "Select the property to link.",
  openingInvalid: "Enter the opening balance like 1,250.00 (use a minus sign if it's negative).",
  openingLocked: (p: string) => `The opening balance can't change after ${p} has a final statement.`,
  startLocked: (p: string) => `The first statement month can't change after ${p} has a final statement.`,
  reserveInvalid: "Enter the property reserve like 500.00.",
  reserveNegative: "The property reserve can't be negative.",
  reserveTooBig: "The property reserve can't be more than $1,000,000.00.",
  depositInvalid: "Enter the deposit like 800.00.",
  depositNegative: "The deposit can't be negative.",
  depositTooBig: "The deposit can't be more than $1,000,000.00.",
} as const;

/** Typed non-negative money: null (blank) | cents | the message for that field. */
function readMoney(
  raw: string,
  msgs: { invalid: string; negative: string; tooBig: string },
): { ok: true; cents: number | null } | { ok: false; message: string } {
  if (raw.trim() === "") return { ok: true, cents: null };
  const cents = parseDollarsToCents(raw);
  if (cents === null) {
    const signed = parseSignedDollarsToCents(raw);
    return { ok: false, message: signed !== null && signed < 0 ? msgs.negative : msgs.invalid };
  }
  if (cents > MAX_AMOUNT_CENTS) return { ok: false, message: msgs.tooBig };
  return { ok: true, cents };
}

/** `/owner-statements/owners/[id]` (or `new`): owner fields, then linked properties (spec 6.5). */
export function OwnerEdit({ ownerId }: { ownerId: string | null }) {
  const owner = useQuery(api.owners.get, ownerId ? { ownerId } : "skip");
  const loading = ownerId !== null && owner === undefined;
  const ready = !!owner;

  // A statement warning links here with #<section> (warning-links.ts): once the owner has loaded,
  // scroll to that section, outline it and focus its field.
  useEffect(() => {
    if (!ready) return;
    const reveal = () => {
      let anchor = window.location.hash.slice(1);
      try {
        anchor = decodeURIComponent(anchor);
      } catch {
        return;
      }
      if (anchor) requestAnimationFrame(() => revealSection(anchor));
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [ready]);

  return (
    <div className="pb-10">
      <nav aria-label="Breadcrumb" className="mb-2 text-[12.5px] text-muted-foreground">
        <Link href="/owner-statements/owners" className="hover:text-foreground hover:underline">
          Owners
        </Link>
        <span aria-hidden> / </span>
        <span>{ownerId === null ? "New owner" : (owner?.legalName ?? "…")}</span>
      </nav>
      <PageHeader
        title={ownerId === null ? "Add owner" : (owner?.legalName ?? "Owner")}
        subtitle={
          ownerId === null
            ? "One owner per entity the statement is for (an LLC or a person)."
            : "Owner details, payee and the properties on their statements, each with its management fee."
        }
      />
      <FinanceNav active="owners" />
      {loading ? (
        <Spinner label="Loading owner…" />
      ) : (
        <div className="flex flex-col gap-5">
          <OwnerForm key={owner ? `${owner._id}:${owner.updatedAt}` : "new"} owner={owner ?? null} />
          {owner ? <PropertiesSection owner={owner} /> : null}
        </div>
      )}
    </div>
  );
}

function OwnerForm({ owner }: { owner: OwnerDoc | null }) {
  const router = useRouter();
  const create = useMutation(api.owners.create);
  const update = useMutation(api.owners.update);
  const setActive = useMutation(api.owners.setActive);

  const [legalName, setLegalName] = useState(owner?.legalName ?? "");
  const [first, setFirst] = useState(owner?.contactFirstName ?? "");
  const [last, setLast] = useState(owner?.contactLastName ?? "");
  const [emails, setEmails] = useState((owner?.emails ?? []).join(", "));
  const [payee, setPayee] = useState(owner?.payeeName ?? "");
  const [active, setActiveState] = useState(owner?.active ?? true);
  const [busy, setBusy] = useState(false);

  const base = useId();
  const ids = useMemo(
    () => ({
      legalName: `${base}-legal`,
      contactFirstName: `${base}-first`,
      contactLastName: `${base}-last`,
      emails: `${base}-emails`,
      payeeName: `${base}-payee`,
      active: `${base}-active`,
    }),
    [base],
  );
  const f = useFieldErrors(ids);
  const mode = owner ? "update" : "create";

  async function save() {
    if (busy) return;
    const raw = {
      mode,
      legalName,
      contactFirstName: first,
      contactLastName: last,
      emails,
      payeeName: payee,
    } as const;
    if (!f.check(validateOwnerFieldsAll(raw), OWNER_ORDER)) return;
    const res = validateOwnerFields(raw);
    if (!res.ok) {
      f.check({ [res.field]: res.message }, OWNER_ORDER);
      return;
    }
    const v = res.value;
    const fields = {
      legalName: v.legalName,
      contactFirstName: v.contactFirstName ?? null,
      contactLastName: v.contactLastName ?? null,
      emails: v.emails ?? [],
      payeeName: v.payeeName ?? null,
    };
    setBusy(true);
    try {
      if (!owner) {
        const { ownerId } = await create(fields);
        toast.success("Owner added. Now link their properties.");
        router.replace(`/owner-statements/owners/${ownerId}`);
        return;
      }
      // The legal name is sent only when it changed: two owners may share a name when their emails
      // differ (owner identity = name + email), and re-sending an unchanged name would trip the
      // "already exists" check against the other one.
      await update({ ownerId: owner._id, ...fields, legalName: v.legalName === owner.legalName ? undefined : v.legalName });
      if (active !== owner.active) await setActive({ ownerId: owner._id, active });
      toast.success("Owner saved.");
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  const text = (
    field: "legalName" | "contactFirstName" | "contactLastName" | "emails" | "payeeName",
    value: string,
    set: (v: string) => void,
    max: number,
    placeholder?: string,
  ) => (
    <>
      <Input
        id={ids[field]}
        value={value}
        maxLength={max}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          set(e.target.value);
          f.clear(field);
        }}
        {...f.control(field)}
      />
      {f.message(field)}
    </>
  );

  return (
    <Card>
      <CardHead title="Owner details" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Legal name *" htmlFor={ids.legalName} hint="The LLC or person the statement is for." className="sm:col-span-2">
          {text("legalName", legalName, setLegalName, MAX_LEGAL_NAME + 20)}
        </Field>
        <Field label="Contact first name" htmlFor={ids.contactFirstName}>
          {text("contactFirstName", first, setFirst, MAX_CONTACT_NAME + 20)}
        </Field>
        <Field label="Contact last name" htmlFor={ids.contactLastName}>
          {text("contactLastName", last, setLast, MAX_CONTACT_NAME + 20)}
        </Field>
        <Field label="Emails" htmlFor={ids.emails} hint="Separate addresses with commas (at most 5)." className="sm:col-span-2">
          {text("emails", emails, setEmails, 600, "owner@example.com, partner@example.com")}
        </Field>
        <div id={ANCHOR.ownerPayee}>
          <Field
            label="Owner draw payee"
            htmlFor={ids.payeeName}
            hint="Prints as the Name on the owner draw line. Leave blank to use the contact name."
          >
            {text("payeeName", payee, setPayee, MAX_PAYEE_NAME + 20, owner?.derivedPayeeName ?? "Contact first and last name")}
          </Field>
        </div>
        {owner ? (
          <div className="flex items-start gap-3 sm:col-span-2">
            <Toggle
              checked={active}
              label="Active"
              onChange={(v) => {
                setActiveState(v);
                f.clear("active");
              }}
            />
            <div id={ids.active} tabIndex={-1} className="outline-none">
              <div className="text-[13px] font-medium">Active</div>
              <p className="text-xs text-muted-foreground">Inactive owners are hidden from the statements list and can&apos;t get new statements.</p>
              {f.message("active")}
            </div>
          </div>
        ) : null}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        {!owner ? (
          <Btn onClick={() => router.push("/owner-statements/owners")} disabled={busy}>
            Cancel
          </Btn>
        ) : null}
        <Btn variant="pri" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : owner ? "Save owner" : "Add owner"}
        </Btn>
      </div>
    </Card>
  );
}

function PropertiesSection({ owner }: { owner: OwnerDoc }) {
  return (
    <Card>
      <CardHead
        title="Properties"
        hint="Statements cover these properties. A property listed under two owners is paused until the ownership split is set."
      />
      <div className="flex flex-col gap-4">
        {owner.links.length === 0 ? (
          <p className="text-[13px] text-faint">No properties linked yet.</p>
        ) : (
          owner.links.map((l) => <LinkCard key={l.linkId} link={l} defaultFeeBps={owner.defaultFeeBps} />)
        )}
        <LinkPropertyForm ownerId={owner._id} linkedIds={owner.links.map((l) => l.propertyId as string)} />
      </div>
    </Card>
  );
}

function LinkCard({ link, defaultFeeBps }: { link: LinkRow; defaultFeeBps: number }) {
  const unlink = useMutation(api.owners.unlinkProperty);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function doUnlink() {
    setBusy(true);
    try {
      await unlink({ linkId: link.linkId });
      toast.success(`${link.propertyName} unlinked.`);
      setConfirming(false);
    } catch (e) {
      toast.error(serverError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id={ANCHOR.property(link.propertyId)} className="rounded-2xl border border-border p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h4 className="text-[14px] font-semibold">{link.propertyName}</h4>
        {link.lockedThroughMonth ? (
          <span className="text-xs text-muted-foreground">Final through {formatMonth(link.lockedThroughMonth)}</span>
        ) : null}
        {link.openDraftMonth ? (
          <span className="text-xs text-warning-ink">Open draft: {formatMonth(link.openDraftMonth)}</span>
        ) : null}
        <Btn sm variant="dng" className="ml-auto" onClick={() => setConfirming(true)}>
          <Unlink aria-hidden className="h-3.5 w-3.5" /> Unlink
        </Btn>
      </div>
      {link.coOwnedMessage ? (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-warning-ink/30 bg-warning-soft px-3 py-2 text-[12.5px] text-warning-ink">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          {link.coOwnedMessage}
        </div>
      ) : null}
      <LinkFee key={`${link.ownFeeBps}:${defaultFeeBps}`} link={link} defaultFeeBps={defaultFeeBps} />
      <LinkSettings
        key={`${link.openingBalanceCents}:${link.startMonth}:${link.propertyReserveCents}:${link.hasFinal}`}
        link={link}
      />
      <UnitDeposits key={link.units.map((u) => `${u.unitId}:${u.securityDepositHeldCents}`).join("|")} link={link} />
      <ConfirmDialog
        open={confirming}
        title={`Unlink ${link.propertyName}?`}
        message="It comes off this owner's future statements. Final statements already made don't change."
        confirmLabel="Unlink"
        danger
        busy={busy}
        onConfirm={() => void doUnlink()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

/**
 * The property's management fee: its own fee, or the org default when blank. A change only moves
 * drafts and future months; final statements keep the % they were finalized with.
 */
function LinkFee({ link, defaultFeeBps }: { link: LinkRow; defaultFeeBps: number }) {
  const setFee = useMutation(api.owners.setPropertyFee);
  const own = link.ownFeeBps;
  const [value, setValue] = useState(own !== null ? formatBps(own) : "");
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(() => ({ managementFeeBps: `${base}-fee` }), [base]);
  const f = useFieldErrors(ids);

  async function send(bps: number | null) {
    setBusy(true);
    try {
      const res = await setFee({ linkId: link.linkId, bps });
      toast.success(
        res.own
          ? `${link.propertyName} now uses its own fee of ${formatBps(res.effectiveFeeBps)}%.`
          : `${link.propertyName} now uses the default fee of ${formatBps(res.effectiveFeeBps)}%.`,
      );
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (busy) return;
    const r = readFeeInput(value);
    if (!r.ok) {
      f.check({ managementFeeBps: r.message }, ["managementFeeBps"]);
      return;
    }
    if (r.bps === own) {
      f.check({ managementFeeBps: FEE_MSG.propertyUnchanged }, ["managementFeeBps"]);
      return;
    }
    await send(r.bps);
  }

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl bg-muted/50 px-3 py-3">
      <div className="min-w-[180px]">
        <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">Management fee</div>
        <div className="mt-0.5 text-[13.5px] font-medium tabular-nums">
          Fee: {formatBps(link.effectiveFeeBps)}% {own !== null ? "(own)" : "(default)"}
        </div>
      </div>
      <Field
        label="Own fee %"
        htmlFor={ids.managementFeeBps}
        hint={`Leave blank to use the default (${formatBps(defaultFeeBps)}%). Final statements don't change.`}
        className="min-w-[200px] flex-1"
      >
        <div className="relative max-w-[160px]">
          <Input
            id={ids.managementFeeBps}
            value={value}
            inputMode="decimal"
            autoComplete="off"
            placeholder={formatBps(defaultFeeBps)}
            onChange={(e) => {
              setValue(e.target.value);
              f.clear("managementFeeBps");
            }}
            {...f.control("managementFeeBps", "!pr-7 tabular-nums")}
          />
          <span aria-hidden className="pointer-events-none absolute right-[11px] top-1/2 -translate-y-1/2 text-[13.5px] text-muted-foreground">
            %
          </span>
        </div>
        {f.message("managementFeeBps")}
      </Field>
      <div className="flex gap-2">
        {own !== null ? (
          <Btn sm onClick={() => void send(null)} disabled={busy}>
            Use default
          </Btn>
        ) : null}
        <Btn sm variant="pri" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save fee"}
        </Btn>
      </div>
    </div>
  );
}

function LinkSettings({ link }: { link: LinkRow }) {
  const updateSettings = useMutation(api.owners.updateLinkSettings);
  const now = useNow();
  const [opening, setOpening] = useState(centsToInput(link.openingBalanceCents));
  const [startMonth, setStartMonth] = useState(link.startMonth ?? "");
  const [reserve, setReserve] = useState(centsToInput(link.propertyReserveCents));
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(
    () => ({
      openingBalanceCents: `${base}-opening`,
      startMonth: `${base}-start`,
      propertyReserveCents: `${base}-reserve`,
    }),
    [base],
  );
  const f = useFieldErrors(ids);

  const monthOptions = useMemo(() => {
    const out: string[] = [];
    let m = currentMonth(now);
    for (let i = 0; i < 36; i++) {
      out.push(m);
      m = prevMonth(m);
    }
    if (link.startMonth && !out.includes(link.startMonth)) out.push(link.startMonth);
    return out;
  }, [now, link.startMonth]);

  async function save() {
    if (busy) return;
    const all: Record<string, string> = {};
    let openingCents: number | null = null;
    if (!link.hasFinal && opening.trim() !== "") {
      const c = parseSignedDollarsToCents(opening);
      if (c === null || Math.abs(c) > MAX_AMOUNT_CENTS) all.openingBalanceCents = M.openingInvalid;
      else openingCents = c;
    }
    const r = readMoney(reserve, { invalid: M.reserveInvalid, negative: M.reserveNegative, tooBig: M.reserveTooBig });
    if (!r.ok) all.propertyReserveCents = r.message;
    if (!f.check(all, ["openingBalanceCents", "startMonth", "propertyReserveCents"])) return;
    setBusy(true);
    try {
      await updateSettings({
        linkId: link.linkId,
        ...(link.hasFinal ? {} : { openingBalanceCents: openingCents, startMonth: startMonth || null }),
        propertyReserveCents: r.ok ? r.cents : null,
      });
      toast.success(`Settings saved for ${link.propertyName}.`);
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div id={ANCHOR.opening(link.propertyId)}>
        <Field
          label="Opening cash balance"
          htmlFor={ids.openingBalanceCents}
          hint={link.hasFinal ? M.openingLocked(link.propertyName) : "Cash held before the first statement. Use a minus sign if negative."}
        >
          <MoneyInput
            id={ids.openingBalanceCents}
            value={opening}
            disabled={link.hasFinal}
            placeholder="Not set"
            onChange={(v) => {
              setOpening(v);
              f.clear("openingBalanceCents");
            }}
            invalid={!!f.errors.openingBalanceCents}
            describedBy={f.control("openingBalanceCents")["aria-describedby"]}
          />
          {f.message("openingBalanceCents")}
        </Field>
      </div>
      <div id={ANCHOR.startMonth(link.propertyId)}>
        <Field
          label="First statement month"
          htmlFor={ids.startMonth}
          hint={link.hasFinal ? M.startLocked(link.propertyName) : "Blank = the first month you finalize."}
        >
          <Select
            id={ids.startMonth}
            value={startMonth}
            disabled={link.hasFinal}
            onChange={(e) => {
              setStartMonth(e.target.value || "");
              f.clear("startMonth");
            }}
            aria-describedby={f.control("startMonth")["aria-describedby"]}
            className={f.control("startMonth").className}
          >
            <option value="">Not set</option>
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)}
              </option>
            ))}
          </Select>
          {f.message("startMonth")}
        </Field>
      </div>
      <Field label="Property reserve" htmlFor={ids.propertyReserveCents} hint="Held back from the owner draw each month.">
        <MoneyInput
          id={ids.propertyReserveCents}
          value={reserve}
          onChange={(v) => {
            setReserve(v);
            f.clear("propertyReserveCents");
          }}
          invalid={!!f.errors.propertyReserveCents}
          describedBy={f.control("propertyReserveCents")["aria-describedby"]}
        />
        {f.message("propertyReserveCents")}
      </Field>
      <div className="flex justify-end sm:col-span-3">
        <Btn sm variant="pri" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </Btn>
      </div>
    </div>
  );
}

function UnitDeposits({ link }: { link: LinkRow }) {
  const setDeposit = useMutation(api.owners.setUnitDeposit);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(link.units.map((u) => [u.unitId, centsToInput(u.securityDepositHeldCents)])),
  );
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(
    () => Object.fromEntries(link.units.map((u, i) => [u.unitId as string, `${base}-dep-${i}`])),
    [base, link.units],
  );
  const f = useFieldErrors(ids);

  if (link.units.length === 0) {
    return <p className="mt-4 text-[12.5px] text-faint">No units on this property.</p>;
  }

  async function save() {
    if (busy) return;
    const all: Record<string, string> = {};
    const changes: { unitId: string; cents: number | null }[] = [];
    for (const u of link.units) {
      const r = readMoney(values[u.unitId] ?? "", {
        invalid: M.depositInvalid,
        negative: M.depositNegative,
        tooBig: M.depositTooBig,
      });
      if (!r.ok) all[u.unitId] = r.message;
      else if (r.cents !== u.securityDepositHeldCents) changes.push({ unitId: u.unitId, cents: r.cents });
    }
    if (!f.check(all, link.units.map((u) => u.unitId as string))) return;
    if (changes.length === 0) {
      toast.info("No deposit changes to save.");
      return;
    }
    setBusy(true);
    let saved = 0;
    try {
      for (const c of changes) {
        try {
          await setDeposit({ unitId: c.unitId, amountCents: c.cents });
          saved += 1;
        } catch (e) {
          const err = serverError(e);
          toast.error(err.message);
          f.setErrors((prev) => ({ ...prev, [c.unitId]: err.message }));
          return;
        }
      }
      toast.success(saved === 1 ? "Deposit saved." : `${saved} deposits saved.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id={ANCHOR.deposits(link.propertyId)} className="mt-4">
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[360px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th scope="col" className="bg-muted px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                Unit
              </th>
              <th scope="col" className="bg-muted px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                Security deposit held
              </th>
            </tr>
          </thead>
          <tbody>
            {link.units.map((u) => (
              <tr key={u.unitId}>
                <td className="border-t border-border px-3 py-2 align-top">
                  <label htmlFor={ids[u.unitId]}>Unit {u.unitLabel}</label>
                </td>
                <td className="border-t border-border px-3 py-2">
                  <div className="max-w-[220px]">
                    <MoneyInput
                      id={ids[u.unitId]}
                      value={values[u.unitId] ?? ""}
                      placeholder="Not set"
                      onChange={(v) => {
                        setValues((s) => ({ ...s, [u.unitId]: v }));
                        f.clear(u.unitId);
                      }}
                      invalid={!!f.errors[u.unitId]}
                      describedBy={f.control(u.unitId)["aria-describedby"]}
                    />
                    {f.message(u.unitId)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex justify-end">
        <Btn sm onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save deposits"}
        </Btn>
      </div>
    </div>
  );
}

function LinkPropertyForm({ ownerId, linkedIds }: { ownerId: string; linkedIds: string[] }) {
  const linkProperty = useMutation(api.owners.linkProperty);
  const options = useQuery(api.owners.propertyOptions, {});
  const [propertyId, setPropertyId] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(() => ({ propertyId: `${base}-link` }), [base]);
  const f = useFieldErrors(ids);
  const available = (options ?? []).filter((p) => !linkedIds.includes(p.propertyId));

  async function submit(confirmCoOwned: boolean) {
    if (busy) return;
    if (!f.check(propertyId ? {} : { propertyId: M.propertyMissing }, ["propertyId"])) return;
    setBusy(true);
    try {
      const res = await linkProperty({ ownerId, propertyId, confirmCoOwned });
      toast.success(res.coOwned ? "Property linked. It's co-owned, so its statements are paused." : "Property linked.");
      setPropertyId("");
      setConfirm(null);
    } catch (e) {
      const err = serverError(e);
      if (!confirmCoOwned && err.field === "propertyId" && err.message.endsWith("Confirm to continue.")) {
        setConfirm(err.message);
      } else {
        setConfirm(null);
        f.fromServer(e);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
      <Field label="Link property" htmlFor={ids.propertyId} className="min-w-[260px] flex-1">
        <Select
          id={ids.propertyId}
          value={propertyId}
          disabled={options === undefined}
          onChange={(e) => {
            setPropertyId(e.target.value || "");
            f.clear("propertyId");
          }}
          aria-describedby={f.control("propertyId")["aria-describedby"]}
          className={f.control("propertyId").className}
        >
          <option value="">{options === undefined ? "Loading properties…" : "Select a property"}</option>
          {available.map((p) => (
            <option key={p.propertyId} value={p.propertyId}>
              {p.ownerNames.length > 0 ? `${p.name} · owned by ${p.ownerNames.join(", ")}` : p.name}
            </option>
          ))}
        </Select>
        {f.message("propertyId")}
      </Field>
      <Btn onClick={() => void submit(false)} disabled={busy}>
        <Link2 aria-hidden className="h-4 w-4" /> Link property
      </Btn>
      <ConfirmDialog
        open={confirm !== null}
        title="Make this property co-owned?"
        message={confirm ?? undefined}
        confirmLabel="Link anyway"
        busy={busy}
        onConfirm={() => void submit(true)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
