"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeftRight, CheckCheck, GitMerge, Link2, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { validateOwnerFieldsAll } from "@/convex/rosPolicy";
import { Btn, Card, CardHead, Field, Input, Modal, Pill, Select } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { Spinner, useFieldErrors } from "./form-bits";

/**
 * Owner identity on the Owners page (user decision 2026-11-11: an owner is name + email).
 * "Needs an owner" lists properties with no owner link, properties whose page names a different
 * owner than their statements are linked to, and owners that may be the same; each with its
 * reason and the actions Link, Create owner, Merge and "Not the same owner". Nothing here is
 * automatic: every change is a click by the accountant. "Link all exact matches" links every row
 * the server marks safe (Ready to link / New owner); rows marked Doubtful keep their own buttons.
 */

type Needs = FunctionReturnType<typeof api.owners.needsOwner>;
type PropertyRow = Needs["properties"][number];
type PairRow = Needs["ownerPairs"][number];
type OwnerOption = FunctionReturnType<typeof api.owners.list>[number];

const CATEGORY_LABEL: Record<string, string> = { gold: "Gold", silver: "Silver", make_up: "Make Up" };

const MSG = {
  ownerToLink: "Select the owner to link this property to.",
  keepMissing: "Select the owner to keep.",
  mergeMissing: "Select the owner to merge into it.",
  sameOwner: "Pick two different owners to merge.",
} as const;

/** "Ann Able · ann@example.com · 3 properties": a select label that tells same-name owners apart. */
export function ownerLabel(o: { legalName: string; emails: string[]; propertyCount?: number; active?: boolean }): string {
  const parts = [o.legalName, o.emails.length > 0 ? o.emails.join(", ") : "no email"];
  if (o.propertyCount !== undefined) parts.push(`${o.propertyCount} propert${o.propertyCount === 1 ? "y" : "ies"}`);
  if (o.active === false) parts.push("inactive");
  return parts.join(" · ");
}

const emailsText = (emails: string[]): string => (emails.length === 0 ? "no email" : emails.join(", "));

type Dialog =
  | { kind: "link"; row: PropertyRow }
  | { kind: "create"; row: PropertyRow }
  | { kind: "merge"; keepOwnerId: string; mergeOwnerId: string }
  | { kind: "bulk" }
  | null;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function NeedsOwnerCard() {
  const data = useQuery(api.owners.needsOwner, {});
  const dismiss = useMutation(api.owners.dismissIdentityFlag);
  const linkProperty = useMutation(api.owners.linkProperty);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    if (busyKey) return;
    setBusyKey(key);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusyKey(null);
    }
  }

  const count = data ? data.properties.length + data.ownerPairs.length : 0;

  return (
    <Card className="mb-5">
      <CardHead
        title="Needs an owner"
        icon={<Users aria-hidden />}
        badge={data && count > 0 ? <Pill tone="warn">{count}</Pill> : null}
        right={
          <span className="flex flex-wrap gap-1.5">
            {data && data.bulk.total > 0 ? (
              <Btn sm variant="pri" disabled={busyKey !== null} onClick={() => setDialog({ kind: "bulk" })}>
                <CheckCheck aria-hidden className="h-4 w-4" /> Link all exact matches ({data.bulk.total})
              </Btn>
            ) : null}
            <Btn sm onClick={() => setDialog({ kind: "merge", keepOwnerId: "", mergeOwnerId: "" })}>
              <GitMerge aria-hidden className="h-4 w-4" /> Merge owners
            </Btn>
          </span>
        }
        hint="Owners are matched by name and email. A property is linked automatically only on an exact match; anything uncertain waits here for you."
      />
      {data === undefined ? (
        <Spinner label="Checking owners…" />
      ) : count === 0 ? (
        <p className="text-[13px] text-muted-foreground">Every property has an owner, and no two owners look alike.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {data.properties.length > 0 ? (
            <section aria-label="Properties">
              <h4 className="mb-2 text-[13px] font-semibold">Properties ({data.properties.length})</h4>
              <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
                {data.properties.map((row) => (
                  <PropertyItem
                    key={row.propertyId}
                    row={row}
                    busyKey={busyKey}
                    onLinkTo={(ownerId, ownerName) =>
                      void run(
                        `link:${row.propertyId}`,
                        () => linkProperty({ ownerId, propertyId: row.propertyId }),
                        `${row.propertyName} linked to ${ownerName}.`,
                      )
                    }
                    onDismiss={(ownerId, ownerName) =>
                      void run(
                        `dismiss:${row.propertyId}:${ownerId}`,
                        () => dismiss({ kind: "property_owner", ownerId, propertyId: row.propertyId }),
                        `Noted: ${row.propertyName}'s owner is not ${ownerName}.`,
                      )
                    }
                    onOpen={(d) => setDialog(d)}
                  />
                ))}
              </ul>
            </section>
          ) : null}
          {data.ownerPairs.length > 0 ? (
            <section aria-label="Owners that may be the same">
              <h4 className="mb-2 text-[13px] font-semibold">Owners that may be the same ({data.ownerPairs.length})</h4>
              <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
                {data.ownerPairs.map((p) => (
                  <PairItem
                    key={p.key}
                    pair={p}
                    busy={busyKey !== null}
                    onMerge={() => setDialog({ kind: "merge", keepOwnerId: p.a.ownerId, mergeOwnerId: p.b.ownerId })}
                    onDismiss={() =>
                      void run(
                        `pair:${p.key}`,
                        () => dismiss({ kind: "owner_pair", ownerId: p.a.ownerId, otherOwnerId: p.b.ownerId }),
                        `Noted: ${p.a.legalName} and ${p.b.legalName} are different owners.`,
                      )
                    }
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
      {dialog?.kind === "bulk" && data ? <LinkAllDialog counts={data.bulk} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "link" ? <LinkOwnerDialog row={dialog.row} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "create" ? <CreateOwnerDialog row={dialog.row} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "merge" ? (
        <MergeOwnersDialog
          initialKeep={dialog.keepOwnerId}
          initialMerge={dialog.mergeOwnerId}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Card>
  );
}

function PropertyItem({
  row,
  busyKey,
  onLinkTo,
  onDismiss,
  onOpen,
}: {
  row: PropertyRow;
  busyKey: string | null;
  onLinkTo: (ownerId: string, ownerName: string) => void;
  onDismiss: (ownerId: string, ownerName: string) => void;
  onOpen: (d: Dialog) => void;
}) {
  const busy = busyKey !== null;
  const unlinked = row.kind !== "mismatch";
  const canLink = unlinked && row.reason !== "open_draft";
  const ready = row.kind === "link" || row.kind === "create";
  const tone = ready ? (row.doubtful ? "neutral" : "ok") : row.kind === "mismatch" ? "bad" : "warn";
  const tag =
    row.kind === "link" ? "Ready to link" : row.kind === "create" ? "New owner" : row.kind === "mismatch" ? "Owner differs" : "Needs review";

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13.5px] font-medium">{row.propertyName}</span>
        {row.category ? <Pill>{CATEGORY_LABEL[row.category] ?? row.category}</Pill> : null}
        <Pill tone={tone}>{tag}</Pill>
        {row.doubtful ? (
          <Pill tone="warn" title="Left out of “Link all exact matches”. Check it and use the buttons below.">
            Doubtful
          </Pill>
        ) : null}
      </div>
      {row.doubt ? (
        <p className="text-[12.5px] font-medium text-warning-ink">Doubtful: {row.doubt}.</p>
      ) : row.bulk?.kind === "link_new" && row.bulk.withPropertyName ? (
        <p className="text-[12.5px] text-muted-foreground">
          Same owner as {row.bulk.withPropertyName}: “Link all exact matches” creates one owner for both.
        </p>
      ) : null}
      <p className="text-[12.5px] text-muted-foreground">
        Property page: {row.rosterName ? <span className="text-foreground">{row.rosterName}</span> : "no owner name"} ·{" "}
        {emailsText(row.rosterEmails)}
      </p>
      <p className="text-[13px]">
        {row.reasonText}
        {row.message ? <span className="text-danger-ink"> {row.message}</span> : null}
        {row.kind === "mismatch" ? (
          <span className="text-muted-foreground">
            {" "}
            Links are never moved automatically. To move it, unlink it on the owner&apos;s page first; or keep the link if
            the statements are right.
          </span>
        ) : null}
      </p>
      {row.linkedOwners.length > 0 ? (
        <p className="text-[12.5px] text-muted-foreground">
          Linked to:{" "}
          {row.linkedOwners.map((o, i) => (
            <span key={o.ownerId}>
              {i > 0 ? ", " : null}
              <Link className="underline hover:text-foreground" href={`/owner-statements/owners/${o.ownerId}`}>
                {o.legalName}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
      {row.candidates.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {row.candidates.map((c) => (
            <li key={c.ownerId} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-[12.5px]">
              <Link className="font-medium underline-offset-2 hover:underline" href={`/owner-statements/owners/${c.ownerId}`}>
                {c.legalName}
              </Link>
              <span className="text-muted-foreground">{emailsText(c.emails)}</span>
              <Pill tone={c.flag === null ? "ok" : c.flag === "same_name_different_email" ? "bad" : "warn"}>{c.flagText}</Pill>
              {!c.active ? <Pill>Inactive</Pill> : null}
              <span className="ml-auto flex flex-wrap gap-1.5">
                {canLink && c.active ? (
                  <Btn sm disabled={busy} onClick={() => onLinkTo(c.ownerId, c.legalName)}>
                    <Link2 aria-hidden className="h-3.5 w-3.5" /> Link to this owner
                  </Btn>
                ) : null}
                {c.flag !== null || row.kind === "mismatch" ? (
                  <Btn sm disabled={busy} onClick={() => onDismiss(c.ownerId, c.legalName)}>
                    Not the same owner
                  </Btn>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {canLink ? (
          <Btn sm disabled={busy} onClick={() => onOpen({ kind: "link", row })}>
            <Link2 aria-hidden className="h-3.5 w-3.5" /> Link to an existing owner…
          </Btn>
        ) : null}
        {canLink ? (
          <Btn sm variant={row.kind === "create" ? "pri" : "default"} disabled={busy} onClick={() => onOpen({ kind: "create", row })}>
            <UserPlus aria-hidden className="h-3.5 w-3.5" /> Create owner…
          </Btn>
        ) : null}
        {row.kind === "mismatch"
          ? row.linkedOwners.map((o) => (
              <Btn
                key={o.ownerId}
                sm
                disabled={busy}
                title="The property page names someone else, but the statements stay with this owner."
                onClick={() => onDismiss(o.ownerId, o.legalName)}
              >
                Keep linked to {o.legalName}
              </Btn>
            ))
          : null}
      </div>
    </li>
  );
}

function PairItem({ pair, busy, onMerge, onDismiss }: { pair: PairRow; busy: boolean; onMerge: () => void; onDismiss: () => void }) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Link className="font-medium hover:underline" href={`/owner-statements/owners/${pair.a.ownerId}`}>
          {pair.a.legalName}
        </Link>
        <span className="text-muted-foreground">and</span>
        <Link className="font-medium hover:underline" href={`/owner-statements/owners/${pair.b.ownerId}`}>
          {pair.b.legalName}
        </Link>
        <Pill tone={pair.flag === "same_name_different_email" ? "bad" : "warn"}>{pair.flagText}</Pill>
      </div>
      <p className="text-[12.5px] text-muted-foreground">
        {ownerLabel(pair.a)} — {ownerLabel(pair.b)}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Btn sm disabled={busy} onClick={onMerge}>
          <GitMerge aria-hidden className="h-3.5 w-3.5" /> Merge…
        </Btn>
        <Btn sm disabled={busy} onClick={onDismiss}>
          Not the same owner
        </Btn>
      </div>
    </li>
  );
}

// --- Link all exact matches -----------------------------------------------------------------------

function LinkAllDialog({ counts, onClose }: { counts: Needs["bulk"]; onClose: () => void }) {
  const linkAll = useMutation(api.owners.linkAllExact);
  const [busy, setBusy] = useState(false);
  const capped = counts.thisRun < counts.total;

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      // The server decides again from the database; it never trusts this list.
      const res = await linkAll({});
      const parts = [
        res.linked > 0 ? `${plural(res.linked, "property", "properties")} linked to existing owners` : null,
        res.created > 0 ? `${plural(res.created, "new owner", "new owners")} created` : null,
        res.linkedToNew > 0 ? `${plural(res.linkedToNew, "more property", "more properties")} linked to them` : null,
      ].filter((x): x is string => x !== null);
      toast.success(parts.length > 0 ? `${parts.join(", ")}.` : "Nothing was linked: nothing on the list is an exact match any more.");
      if (res.skipped > 0) toast.warning(`${plural(res.skipped, "property was", "properties were")} skipped because it changed. Check the list.`);
      if (res.remaining > 0) toast.info(`${plural(res.remaining, "more exact match is", "more exact matches are")} ready. Click “Link all exact matches” again.`);
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Link all exact matches"
      eyebrow="Needs an owner"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="pri" onClick={() => void submit()} disabled={busy || counts.total === 0}>
            {busy ? "Linking…" : `Link ${plural(counts.thisRun, "property", "properties")}`}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <p className="text-muted-foreground">
          Only properties whose owner name and email match exactly, with nothing in doubt. Existing links are never
          moved. Nothing is sent to anyone.
        </p>
        <ul className="list-disc pl-5">
          <li>{plural(counts.link, "property", "properties")} linked to an existing owner (Ready to link).</li>
          <li>
            {plural(counts.create, "new owner", "new owners")} created from the property page (New owner), using the
            default management fee.
          </li>
          {counts.linkNew > 0 ? (
            <li>{plural(counts.linkNew, "more property", "more properties")} linked to one of those new owners (same name and email).</li>
          ) : null}
          <li>{plural(counts.doubtful, "doubtful property is", "doubtful properties are")} left for you to check.</li>
        </ul>
        {capped ? (
          <p className="text-warning-ink">
            This run does the first {counts.thisRun} of {counts.total}. Click the button again for the rest.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

// --- Link to an existing owner -------------------------------------------------------------------

function LinkOwnerDialog({ row, onClose }: { row: PropertyRow; onClose: () => void }) {
  const owners = useQuery(api.owners.list, {});
  const linkProperty = useMutation(api.owners.linkProperty);
  const [ownerId, setOwnerId] = useState("");
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(() => ({ ownerId: `${base}-owner`, propertyId: `${base}-owner` }), [base]);
  const f = useFieldErrors(ids);
  const chosen = (owners ?? []).find((o) => o._id === ownerId);

  async function submit() {
    if (busy) return;
    if (!f.check(ownerId ? {} : { ownerId: MSG.ownerToLink }, ["ownerId"])) return;
    setBusy(true);
    try {
      await linkProperty({ ownerId, propertyId: row.propertyId });
      toast.success(`${row.propertyName} linked to ${chosen?.legalName ?? "the owner"}.`);
      onClose();
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Link ${row.propertyName}`}
      eyebrow="Needs an owner"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="pri" onClick={() => void submit()} disabled={busy}>
            {busy ? "Linking…" : "Link property"}
          </Btn>
        </>
      }
    >
      <p className="mb-4 text-[13px] text-muted-foreground">
        Property page: {row.rosterName ?? "no owner name"} · {emailsText(row.rosterEmails)}
      </p>
      <Field label="Owner *" htmlFor={ids.ownerId}>
        <Select
          id={ids.ownerId}
          value={ownerId}
          disabled={owners === undefined}
          onChange={(e) => {
            setOwnerId(e.target.value || "");
            f.clear("ownerId");
            f.clear("propertyId");
          }}
          aria-describedby={f.control("ownerId")["aria-describedby"] ?? f.control("propertyId")["aria-describedby"]}
          className={f.control("ownerId").className || f.control("propertyId").className}
        >
          <option value="">{owners === undefined ? "Loading owners…" : "Select an owner"}</option>
          {(owners ?? []).map((o) => (
            <option key={o._id} value={o._id}>
              {ownerLabel({ legalName: o.legalName, emails: o.emails, propertyCount: o.propertyCount })}
            </option>
          ))}
        </Select>
        {f.message("ownerId")}
        {f.errors.ownerId ? null : f.message("propertyId")}
      </Field>
    </Modal>
  );
}

// --- Create owner from the property ---------------------------------------------------------------

function CreateOwnerDialog({ row, onClose }: { row: PropertyRow; onClose: () => void }) {
  const create = useMutation(api.owners.createForProperty);
  const [legalName, setLegalName] = useState(row.rosterName ?? "");
  const [emails, setEmails] = useState(row.rosterEmails.join(", "));
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(
    () => ({ legalName: `${base}-legal`, emails: `${base}-emails`, propertyId: `${base}-legal` }),
    [base],
  );
  const f = useFieldErrors(ids);

  async function submit() {
    if (busy) return;
    if (!f.check(validateOwnerFieldsAll({ mode: "update", legalName, emails }), ["legalName", "emails"])) return;
    setBusy(true);
    try {
      await create({ propertyId: row.propertyId, legalName, emails });
      toast.success(`Owner created and linked to ${row.propertyName}. It uses the default management fee unless a property has its own.`);
      onClose();
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Create the owner of ${row.propertyName}`}
      eyebrow="Needs an owner"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="pri" onClick={() => void submit()} disabled={busy}>
            {busy ? "Creating…" : "Create and link"}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-muted-foreground">
          Prefilled from the property page. The new owner uses the default management fee unless the property has its own, so check it
          before their first statement.
        </p>
        <Field label="Legal name *" htmlFor={ids.legalName} hint="The LLC or person the statement is for.">
          <Input
            id={ids.legalName}
            value={legalName}
            autoComplete="off"
            onChange={(e) => {
              setLegalName(e.target.value);
              f.clear("legalName");
              f.clear("propertyId");
            }}
            {...f.control("legalName")}
          />
          {f.message("legalName")}
          {f.errors.legalName ? null : f.message("propertyId")}
        </Field>
        <Field label="Emails" htmlFor={ids.emails} hint="Separate addresses with commas (at most 5). The email is what tells two owners with the same name apart.">
          <Input
            id={ids.emails}
            value={emails}
            autoComplete="off"
            onChange={(e) => {
              setEmails(e.target.value);
              f.clear("emails");
            }}
            {...f.control("emails")}
          />
          {f.message("emails")}
        </Field>
      </div>
    </Modal>
  );
}

// --- Merge owners ---------------------------------------------------------------------------------

export function MergeOwnersDialog({
  initialKeep = "",
  initialMerge = "",
  onClose,
}: {
  initialKeep?: string;
  initialMerge?: string;
  onClose: () => void;
}) {
  const owners = useQuery(api.owners.list, {});
  const merge = useMutation(api.owners.merge);
  const [keepOwnerId, setKeep] = useState(initialKeep);
  const [mergeOwnerId, setMerge] = useState(initialMerge);
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(() => ({ keepOwnerId: `${base}-keep`, mergeOwnerId: `${base}-merge` }), [base]);
  const f = useFieldErrors(ids);
  const ready = keepOwnerId !== "" && mergeOwnerId !== "" && keepOwnerId !== mergeOwnerId;
  const preview = useQuery(api.owners.mergePreview, ready ? { keepOwnerId, mergeOwnerId } : "skip");

  function clientErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (!keepOwnerId) out.keepOwnerId = MSG.keepMissing;
    if (!mergeOwnerId) out.mergeOwnerId = MSG.mergeMissing;
    else if (mergeOwnerId === keepOwnerId) out.mergeOwnerId = MSG.sameOwner;
    return out;
  }

  async function submit() {
    if (busy) return;
    if (!f.check(clientErrors(), ["keepOwnerId", "mergeOwnerId"])) return;
    if (preview?.problem) {
      f.check({ [preview.problem.field]: preview.problem.message }, ["keepOwnerId", "mergeOwnerId"]);
      return;
    }
    setBusy(true);
    try {
      const res = await merge({ keepOwnerId, mergeOwnerId });
      toast.success(
        `Owners merged. ${res.propertiesMoved} propert${res.propertiesMoved === 1 ? "y" : "ies"} moved to ${preview?.keep?.legalName ?? "the kept owner"}.`,
      );
      onClose();
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  const select = (field: "keepOwnerId" | "mergeOwnerId", value: string, set: (v: string) => void, placeholder: string) => (
    <>
      <Select
        id={ids[field]}
        value={value}
        disabled={owners === undefined}
        onChange={(e) => {
          set(e.target.value || "");
          f.clear("keepOwnerId");
          f.clear("mergeOwnerId");
        }}
        aria-describedby={f.control(field)["aria-describedby"]}
        className={f.control(field).className}
      >
        <option value="">{owners === undefined ? "Loading owners…" : placeholder}</option>
        {(owners ?? []).map((o: OwnerOption) => (
          <option key={o._id} value={o._id}>
            {ownerLabel({ legalName: o.legalName, emails: o.emails, propertyCount: o.propertyCount })}
          </option>
        ))}
      </Select>
      {f.message(field)}
    </>
  );

  return (
    <Modal
      title="Merge owners"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="pri" onClick={() => void submit()} disabled={busy || (ready && (preview === undefined || preview.problem !== null))}>
            <GitMerge aria-hidden className="h-4 w-4" />
            {busy
              ? "Merging…"
              : preview?.keep && preview.merge
                ? `Merge ${preview.merge.legalName} into ${preview.keep.legalName}`
                : "Merge owners"}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-muted-foreground">
          Use this when two owners are really the same owner. The second owner&apos;s properties move to the first, their
          emails are combined, and the second owner is turned off. The first owner&apos;s payee stays. Each property keeps its own fee settings.
          Owners that already have a statement can&apos;t be merged.
        </p>
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <Field label="Keep this owner *" htmlFor={ids.keepOwnerId}>
            {select("keepOwnerId", keepOwnerId, setKeep, "Select the owner to keep")}
          </Field>
          <Btn
            sm
            className="mb-1"
            title="Swap the two owners"
            aria-label="Swap the two owners"
            disabled={busy}
            onClick={() => {
              setKeep(mergeOwnerId);
              setMerge(keepOwnerId);
              f.clear("keepOwnerId");
              f.clear("mergeOwnerId");
            }}
          >
            <ArrowLeftRight aria-hidden className="h-4 w-4" />
          </Btn>
          <Field label="Merge this owner into it *" htmlFor={ids.mergeOwnerId}>
            {select("mergeOwnerId", mergeOwnerId, setMerge, "Select the owner to merge")}
          </Field>
        </div>
        {!ready ? null : preview === undefined ? (
          <Spinner label="Checking the merge…" className="py-4" />
        ) : (
          <div className="rounded-xl border border-border p-4 text-[13px]">
            {preview.problem ? (
              <p role="alert" className="text-danger-ink">
                {preview.problem.message}
              </p>
            ) : preview.keep && preview.merge ? (
              <div className="flex flex-col gap-2">
                <p className="font-medium">
                  {preview.merge.legalName} will be merged into {preview.keep.legalName}:
                </p>
                <ul className="list-disc pl-5">
                  <li>
                    {preview.moves.length === 0
                      ? "No properties move."
                      : `${preview.moves.length} propert${preview.moves.length === 1 ? "y moves" : "ies move"}: ${preview.moves.join(", ")}.`}
                  </li>
                  {preview.shared.length > 0 ? (
                    <li>Already linked to both (the kept owner&apos;s link stays): {preview.shared.join(", ")}.</li>
                  ) : null}
                  <li>Emails after the merge: {emailsText(preview.emailsAfter)}.</li>
                  <li>
                    Kept: owner draw payee {preview.keep.payeeName ?? "not set"}. Each property keeps its own
                    management fee setting.
                  </li>
                  <li>{preview.merge.legalName} is turned off and can&apos;t get statements.</li>
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Modal>
  );
}
