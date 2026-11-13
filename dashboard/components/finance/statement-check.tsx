"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { AlertOctagon, AlertTriangle, CheckCircle2, ChevronDown, Info } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { MAX_AMOUNT_CENTS, formatCurrency, parseDollarsToCents, parseSignedDollarsToCents } from "@/convex/rosFormat";
import { Btn, Card, Field, Modal, Pill, cx } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { serverError } from "@/lib/form-errors";
import type { StatementData } from "./finalize-dialogs";
import { LinkBtn, MoneyInput, Spinner, centsToInput, useFieldErrors } from "./form-bits";
import { type CheckGroup, type CheckItem, type GroupedWarnings, type StepId, nextStep, stepLabel } from "./statement-steps";

/** Messages (the money ones match owners.updateLinkSettings / owners.setUnitDeposit). */
const M = {
  openingMissing: "Enter the opening balance, like 1,250.00. Use 0.00 if there is none.",
  openingInvalid: "Enter the opening balance like 1,250.00 (use a minus sign if it's negative).",
  depositInvalid: "Enter the deposit like 800.00.",
  depositNegative: "The deposit can't be negative.",
  depositTooBig: "The deposit can't be more than $1,000,000.00.",
  linkMissing: "This property isn't linked to this owner any more. Refresh the page.",
  noUnits: "This property has no units, so there are no deposits to record.",
} as const;

type OwnerLink = NonNullable<ReturnType<typeof useOwnerLinks>>[number];

/** The owner's property links (linkId and units), for the in-place confirmations. */
function useOwnerLinks(ownerId: string) {
  const owner = useQuery(api.owners.get, { ownerId });
  return owner?.links;
}

/**
 * Step 1 "Check" (spec 6.3, guided): only what needs fixing or confirming, grouped by property,
 * blocking first. One-click confirmations clear the common setup notes in place.
 */
export function CheckStep({
  data,
  grouped,
  onGoStep,
}: {
  data: StatementData;
  grouped: GroupedWarnings;
  onGoStep: (step: StepId, reveal?: string | null) => void;
}) {
  const isDraft = data.statement.status === "draft";
  const [dialog, setDialog] = useState<{ kind: "opening" | "deposits"; propertyId: string } | null>(null);
  const nameOf = (pid: string) => data.properties.find((p) => p.propertyId === pid)?.name ?? "this property";
  const { fixCount, lookCount } = grouped;

  const withItems = [grouped.statement, ...grouped.properties]
    .filter((g) => g.fix.length + g.look.length > 0)
    // Groups with something blocking first; otherwise statement order.
    .sort((a, b) => Number(b.fix.length > 0) - Number(a.fix.length > 0));
  const clear = grouped.properties.filter((g) => g.fix.length + g.look.length === 0);
  const next = nextStep("check");

  return (
    <div className="flex flex-col gap-4">
      {fixCount + lookCount === 0 ? (
        <Card className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <CheckCircle2 aria-hidden className="h-7 w-7 shrink-0 text-success-ink" />
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold">Nothing to fix</h3>
            <p className="text-[13px] text-muted-foreground">
              {isDraft
                ? "Every property is set up for this statement. Continue to check the money in."
                : "This statement is final. Nothing on it can change."}
            </p>
          </div>
          {isDraft && next ? (
            <Btn variant="pri" onClick={() => onGoStep(next)}>
              Continue to {stepLabel(next)} →
            </Btn>
          ) : null}
        </Card>
      ) : (
        <p className="text-[13px] text-muted-foreground" aria-live="polite">
          {fixCount > 0 ? (
            <span className="font-semibold text-danger-ink">
              {fixCount} {fixCount === 1 ? "item blocks" : "items block"} finalizing.
            </span>
          ) : null}{" "}
          {lookCount > 0 ? `${lookCount} ${lookCount === 1 ? "item is" : "items are"} worth a look.` : null}
        </p>
      )}

      {withItems.map((g) => (
        <GroupCard
          key={g.propertyId ?? "statement"}
          group={g}
          readOnly={!isDraft}
          ownerId={data.owner._id}
          onGoStep={onGoStep}
          onOpenDialog={(kind, propertyId) => setDialog({ kind, propertyId })}
        />
      ))}

      {clear.length > 0 && withItems.length > 0 ? (
        <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <CheckCircle2 aria-hidden className="h-4 w-4 text-success-ink" />
          Nothing to fix for {clear.map((g) => g.name).join(", ")}.
        </p>
      ) : null}

      {grouped.notes.length > 0 ? <NotesCard notes={grouped.notes} onGoStep={onGoStep} readOnly={!isDraft} /> : null}

      {dialog?.kind === "opening" ? (
        <OpeningBalanceDialog
          ownerId={data.owner._id}
          propertyId={dialog.propertyId}
          propertyName={nameOf(dialog.propertyId)}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "deposits" ? (
        <DepositsDialog
          ownerId={data.owner._id}
          propertyId={dialog.propertyId}
          propertyName={nameOf(dialog.propertyId)}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

function GroupCard({
  group,
  readOnly,
  ownerId,
  onGoStep,
  onOpenDialog,
}: {
  group: CheckGroup;
  readOnly: boolean;
  ownerId: string;
  onGoStep: (step: StepId, reveal?: string | null) => void;
  onOpenDialog: (kind: "opening" | "deposits", propertyId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const items = [...group.fix, ...group.look];
  return (
    <Card className={cx("!py-4", group.fix.length > 0 && "!border-danger-ink/40")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center gap-2 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <h3 className="text-[15px] font-semibold">{group.name}</h3>
        {group.fix.length > 0 ? <Pill tone="bad">{group.fix.length} to fix</Pill> : null}
        {group.look.length > 0 ? <Pill tone="warn">{group.look.length} worth a look</Pill> : null}
        <ChevronDown aria-hidden className={cx("ml-auto h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <ul id={bodyId} className="mt-3 flex flex-col divide-y divide-border">
          {items.map((it) => (
            <ItemRow
              key={it.key}
              item={it}
              readOnly={readOnly}
              ownerId={ownerId}
              onGoStep={onGoStep}
              onOpenDialog={onOpenDialog}
            />
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function ItemRow({
  item,
  readOnly,
  ownerId,
  onGoStep,
  onOpenDialog,
}: {
  item: CheckItem;
  readOnly: boolean;
  ownerId: string;
  onGoStep: (step: StepId, reveal?: string | null) => void;
  onOpenDialog: (kind: "opening" | "deposits", propertyId: string) => void;
}) {
  const icon =
    item.tone === "fix" ? (
      <AlertOctagon aria-label="Blocks finalizing" className="mt-0.5 h-4 w-4 shrink-0 text-danger-ink" />
    ) : item.tone === "look" ? (
      <AlertTriangle aria-label="Worth a look" className="mt-0.5 h-4 w-4 shrink-0 text-warning-ink" />
    ) : (
      <Info aria-label="Note" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
    );
  return (
    <li className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-2.5 text-[13px]">
        {icon}
        <span className="min-w-0">{item.message}</span>
      </div>
      {readOnly ? null : (
        <div className="flex shrink-0 flex-wrap gap-2 pl-6 sm:pl-0">
          <ItemAction item={item} ownerId={ownerId} onGoStep={onGoStep} onOpenDialog={onOpenDialog} />
        </div>
      )}
    </li>
  );
}

function ItemAction({
  item,
  ownerId,
  onGoStep,
  onOpenDialog,
}: {
  item: CheckItem;
  ownerId: string;
  onGoStep: (step: StepId, reveal?: string | null) => void;
  onOpenDialog: (kind: "opening" | "deposits", propertyId: string) => void;
}) {
  const a = item.action;
  const quick = useQuickConfirm(ownerId);
  if (a === null) return null;
  switch (a.kind) {
    case "opening":
      return a.offerZero ? (
        <>
          <Btn sm variant="pri" disabled={quick.busy} onClick={() => void quick.zeroOpening(a.propertyId)}>
            {quick.busy ? "Saving…" : "It's $0.00"}
          </Btn>
          <Btn sm disabled={quick.busy} onClick={() => onOpenDialog("opening", a.propertyId)}>
            Set amount…
          </Btn>
        </>
      ) : (
        <Btn sm variant="pri" onClick={() => onOpenDialog("opening", a.propertyId)}>
          Set opening balance…
        </Btn>
      );
    case "deposits":
      return (
        <>
          <Btn sm variant="pri" disabled={quick.busy} onClick={() => void quick.noneHeld(a.propertyId)}>
            {quick.busy ? "Saving…" : "None held"}
          </Btn>
          <Btn sm disabled={quick.busy} onClick={() => onOpenDialog("deposits", a.propertyId)}>
            Enter deposits…
          </Btn>
        </>
      );
    case "href":
      return <LinkBtn href={a.href}>{a.label}</LinkBtn>;
    case "step":
      return (
        <Btn sm onClick={() => onGoStep(a.step, a.reveal)}>
          {a.label}
        </Btn>
      );
  }
}

function NotesCard({
  notes,
  onGoStep,
  readOnly,
}: {
  notes: CheckItem[];
  onGoStep: (step: StepId, reveal?: string | null) => void;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <Card className="!bg-muted/30 !py-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg text-left text-[14px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Info aria-hidden className="h-4 w-4 text-muted-foreground" />
        Notes ({notes.length})
        <span className="text-[12.5px] font-normal text-muted-foreground">Nothing to do</span>
        <ChevronDown aria-hidden className={cx("ml-auto h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <ul id={bodyId} className="mt-3 flex flex-col gap-2">
          {notes.map((n) => (
            <li key={n.key} className="flex flex-col gap-1.5 text-[13px] sm:flex-row sm:items-center sm:gap-4">
              <span className="min-w-0 flex-1 text-muted-foreground">{n.message}</span>
              {!readOnly && n.action?.kind === "step" ? (
                <Btn sm onClick={() => onGoStep((n.action as { step: StepId }).step)}>
                  {n.action.label}
                </Btn>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

/** "It's $0.00" (opening balance) and "None held" (deposits): one click, no navigation. */
function useQuickConfirm(ownerId: string) {
  const convex = useConvex();
  const updateLink = useMutation(api.owners.updateLinkSettings);
  const setDeposit = useMutation(api.owners.setUnitDeposit);
  const [busy, setBusy] = useState(false);

  async function linkOf(propertyId: string): Promise<OwnerLink | null> {
    const owner = await convex.query(api.owners.get, { ownerId });
    return owner.links.find((l) => l.propertyId === propertyId) ?? null;
  }

  async function run(work: () => Promise<string | null>) {
    if (busy) return;
    setBusy(true);
    try {
      const done = await work();
      if (done) toast.success(done);
    } catch (e) {
      toast.error(serverError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    zeroOpening: (propertyId: string) =>
      run(async () => {
        const link = await linkOf(propertyId);
        if (!link) {
          toast.error(M.linkMissing);
          return null;
        }
        // Someone may have set it since this page loaded: never overwrite it with 0.
        if (link.openingBalanceCents !== null && link.openingBalanceCents !== undefined) {
          toast.info(`Opening balance for ${link.propertyName} is already set to ${formatCurrency(link.openingBalanceCents)}.`);
          return null;
        }
        await updateLink({ linkId: link.linkId, openingBalanceCents: 0 });
        return `Opening balance for ${link.propertyName} set to $0.00.`;
      }),
    noneHeld: (propertyId: string) =>
      run(async () => {
        const link = await linkOf(propertyId);
        if (!link) {
          toast.error(M.linkMissing);
          return null;
        }
        if (link.units.length === 0) {
          toast.error(M.noUnits);
          return null;
        }
        // Only units with nothing recorded: a deposit someone entered meanwhile is kept.
        for (const u of link.units) {
          if (u.securityDepositHeldCents === null) await setDeposit({ unitId: u.unitId, amountCents: 0 });
        }
        return `Recorded no security deposits held at ${link.propertyName}.`;
      }),
  };
}

/** Set the property's opening cash balance in place (owners.updateLinkSettings). */
function OpeningBalanceDialog({
  ownerId,
  propertyId,
  propertyName,
  onClose,
}: {
  ownerId: string;
  propertyId: string;
  propertyName: string;
  onClose: () => void;
}) {
  const links = useOwnerLinks(ownerId);
  const link = links?.find((l) => l.propertyId === propertyId) ?? null;
  return (
    <Modal title={`Opening balance: ${propertyName}`} size="sm" onClose={onClose}>
      {links === undefined ? (
        <Spinner label="Loading…" className="py-6" />
      ) : link === null ? (
        <p className="text-[13.5px] text-muted-foreground">{M.linkMissing}</p>
      ) : (
        <OpeningForm link={link} onClose={onClose} />
      )}
    </Modal>
  );
}

function OpeningForm({ link, onClose }: { link: OwnerLink; onClose: () => void }) {
  const updateLink = useMutation(api.owners.updateLinkSettings);
  const [value, setValue] = useState(centsToInput(link.openingBalanceCents));
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(() => ({ openingBalanceCents: `${base}-opening` }), [base]);
  const f = useFieldErrors(ids);

  async function save() {
    if (busy) return;
    const raw = value.trim();
    const cents = raw === "" ? null : parseSignedDollarsToCents(raw);
    const err =
      raw === "" ? M.openingMissing : cents === null || Math.abs(cents) > MAX_AMOUNT_CENTS ? M.openingInvalid : null;
    if (!f.check(err ? { openingBalanceCents: err } : {}, ["openingBalanceCents"])) return;
    setBusy(true);
    try {
      await updateLink({ linkId: link.linkId, openingBalanceCents: cents });
      toast.success(`Opening balance for ${link.propertyName} saved.`);
      onClose();
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="text-[13px] text-muted-foreground">
        The cash this property held for the owner before their first statement. It is the statement&apos;s beginning
        balance. It can&apos;t change after the first final statement.
      </p>
      <Field label="Opening balance *" htmlFor={ids.openingBalanceCents} hint="Use a minus sign if it's negative.">
        <MoneyInput
          id={ids.openingBalanceCents}
          value={value}
          onChange={(v) => {
            setValue(v);
            f.clear("openingBalanceCents");
          }}
          invalid={!!f.errors.openingBalanceCents}
          describedBy={f.control("openingBalanceCents")["aria-describedby"]}
        />
        {f.message("openingBalanceCents")}
      </Field>
      <div className="flex justify-end gap-2">
        <Btn onClick={onClose} disabled={busy}>
          Cancel
        </Btn>
        <Btn type="submit" variant="pri" disabled={busy}>
          {busy ? "Saving…" : "Save opening balance"}
        </Btn>
      </div>
    </form>
  );
}

/** Enter the security deposit held for each unit of a property in place (owners.setUnitDeposit). */
export function DepositsDialog({
  ownerId,
  propertyId,
  propertyName,
  onClose,
}: {
  ownerId: string;
  propertyId: string;
  propertyName: string;
  onClose: () => void;
}) {
  const links = useOwnerLinks(ownerId);
  const link = links?.find((l) => l.propertyId === propertyId) ?? null;
  return (
    <Modal title={`Security deposits: ${propertyName}`} onClose={onClose}>
      {links === undefined ? (
        <Spinner label="Loading units…" className="py-6" />
      ) : link === null ? (
        <p className="text-[13.5px] text-muted-foreground">{M.linkMissing}</p>
      ) : link.units.length === 0 ? (
        <p className="text-[13.5px] text-muted-foreground">{M.noUnits}</p>
      ) : (
        <DepositsForm link={link} onClose={onClose} />
      )}
    </Modal>
  );
}

function readDeposit(raw: string): { ok: true; cents: number | null } | { ok: false; message: string } {
  if (raw.trim() === "") return { ok: true, cents: null };
  const cents = parseDollarsToCents(raw);
  if (cents === null) {
    const signed = parseSignedDollarsToCents(raw);
    return { ok: false, message: signed !== null && signed < 0 ? M.depositNegative : M.depositInvalid };
  }
  if (cents > MAX_AMOUNT_CENTS) return { ok: false, message: M.depositTooBig };
  return { ok: true, cents };
}

function DepositsForm({ link, onClose }: { link: OwnerLink; onClose: () => void }) {
  const setDeposit = useMutation(api.owners.setUnitDeposit);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(link.units.map((u) => [u.unitId as string, centsToInput(u.securityDepositHeldCents)])),
  );
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(
    () => Object.fromEntries(link.units.map((u, i) => [u.unitId as string, `${base}-dep-${i}`])),
    [base, link.units],
  );
  const f = useFieldErrors(ids);
  const order = link.units.map((u) => u.unitId as string);

  async function save() {
    if (busy) return;
    const all: Record<string, string> = {};
    const changes: { unitId: string; cents: number | null }[] = [];
    for (const u of link.units) {
      const r = readDeposit(values[u.unitId] ?? "");
      if (!r.ok) all[u.unitId] = r.message;
      else if (r.cents !== u.securityDepositHeldCents) changes.push({ unitId: u.unitId, cents: r.cents });
    }
    if (!f.check(all, order)) return;
    if (changes.length === 0) {
      onClose();
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
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const setAll = (v: string) => {
    setValues(Object.fromEntries(order.map((id) => [id, v])));
    f.setErrors({});
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
        <span>Blank = not recorded.</span>
        <button type="button" className="font-medium text-primary hover:underline" onClick={() => setAll("0.00")}>
          Set all to $0.00
        </button>
      </div>
      <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th scope="col" className="sticky top-0 bg-muted px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                Unit
              </th>
              <th scope="col" className="sticky top-0 bg-muted px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
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
                      placeholder="Not recorded"
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
      <div className="flex justify-end gap-2">
        <Btn onClick={onClose} disabled={busy}>
          Cancel
        </Btn>
        <Btn type="submit" variant="pri" disabled={busy}>
          {busy ? "Saving…" : "Save deposits"}
        </Btn>
      </div>
    </form>
  );
}
