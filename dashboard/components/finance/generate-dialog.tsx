"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { api } from "@/convex/_generated/api";
import { formatMonth } from "@/convex/rosFormat";
import { MAX_MEMO, MSG } from "@/convex/rosPolicy";
import { Btn, Field, Modal, Select, Textarea, cx } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { Checkbox, Spinner, useFieldErrors } from "./form-bits";

/** Exact server messages (ownerStatements.createDraft / discard, spec 5.4). */
const OWNER_MISSING = "Select the owner this statement is for.";
const PROPERTIES_MISSING = "Tick at least one property for this statement.";
const REASON_LONG = "Keep the reason under 300 characters.";

const ORDER = ["ownerId", "month", "propertyIds"] as const;

/** The open draft blocking a property (ownerStatements.generateOptions `openDraft`). */
type OpenDraft = { statementId: string; month: string; ownerName: string; propertyNames: string[] };

/**
 * "Generate statement" (spec 6.2): owner (by name), month, and the owner's properties. Every
 * selectable property starts ticked; one that can't go on a statement is shown disabled with the
 * server's reason. On success it opens the new draft.
 */
export function GenerateDialog({
  months,
  initialOwnerId,
  initialMonth,
  onClose,
}: {
  months: { value: string; label: string }[];
  initialOwnerId: string;
  initialMonth: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const createDraft = useMutation(api.ownerStatements.createDraft);
  const owners = useQuery(api.owners.list, {});

  const [ownerId, setOwnerId] = useState(initialOwnerId);
  const [month, setMonth] = useState(initialMonth);
  // Ticks the user changed, per owner+month; anything else follows the server's defaultTicked.
  const [ticks, setTicks] = useState<{ key: string; ids: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  // The open draft the user asked to discard (confirmation shown instead of this dialog).
  const [discarding, setDiscarding] = useState<OpenDraft | null>(null);

  const base = useId();
  const ids = useMemo(
    () => ({ ownerId: `${base}-owner`, month: `${base}-month`, propertyIds: `${base}-props` }),
    [base],
  );
  const f = useFieldErrors(ids);

  const options = useQuery(api.ownerStatements.generateOptions, ownerId && month ? { ownerId, month } : "skip");
  const key = `${ownerId}:${month}`;
  const props = options?.properties ?? [];
  const ticked =
    ticks && ticks.key === key
      ? new Set(ticks.ids)
      : new Set(props.filter((p) => p.defaultTicked).map((p) => p.propertyId as string));

  const setTicked = (next: Set<string>) => {
    setTicks({ key, ids: [...next] });
    f.clear("propertyIds");
  };

  async function submit() {
    if (busy) return;
    const chosen = props.filter((p) => p.selectable && ticked.has(p.propertyId)).map((p) => p.propertyId as string);
    const all: Record<string, string> = {};
    if (!ownerId) all.ownerId = OWNER_MISSING;
    if (!month) all.month = MSG.CREATE_MONTH_MISSING;
    if (ownerId && month && chosen.length === 0) all.propertyIds = PROPERTIES_MISSING;
    if (!f.check(all, ORDER)) return;
    setBusy(true);
    try {
      const { statementId } = await createDraft({ ownerId, month, propertyIds: chosen });
      router.push(`/owner-statements/${statementId}`);
      onClose();
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  const selectable = props.filter((p) => p.selectable);

  const toggle = (propertyId: string, on: boolean) => {
    const next = new Set(ticked);
    if (on) next.add(propertyId);
    else next.delete(propertyId);
    setTicked(next);
  };

  /** Enter on a focused row checkbox toggles it too (Space already does). */
  const onRowKey = (e: KeyboardEvent<HTMLLabelElement>, propertyId: string) => {
    if (e.key !== "Enter" || !(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    toggle(propertyId, !ticked.has(propertyId));
  };

  /**
   * After a discard the freed properties are ticked like the others: the server's defaultTicked does
   * it unless the user already changed ticks for this owner+month, so add them to those ticks.
   */
  const onDiscarded = (statementId: string) => {
    setDiscarding(null);
    if (!ticks || ticks.key !== key) return;
    const freed = props.filter((p) => p.openDraft?.statementId === statementId).map((p) => p.propertyId as string);
    setTicks({ key, ids: [...new Set([...ticks.ids, ...freed])] });
  };

  return (
    <>
    {discarding ? (
      <DiscardDraftDialog draft={discarding} onClose={() => setDiscarding(null)} onDone={onDiscarded} />
    ) : null}
    <Modal
      open={discarding === null}
      title="Generate statement"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="pri" onClick={() => void submit()} disabled={busy}>
            {busy ? "Generating…" : "Generate draft"}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Owner *" htmlFor={ids.ownerId}>
            <Select
              id={ids.ownerId}
              value={ownerId}
              disabled={owners === undefined}
              placeholder={owners === undefined ? "Loading owners…" : "Select an owner"}
              onChange={(e) => {
                setOwnerId(e.target.value || "");
                f.clear("ownerId");
                f.clear("propertyIds");
              }}
              aria-describedby={f.control("ownerId")["aria-describedby"]}
              className={f.control("ownerId").className}
            >
              <option value="">{owners === undefined ? "Loading owners…" : "Select an owner"}</option>
              {(owners ?? []).map((o) => (
                <option key={o._id} value={o._id} data-sublabel={o.contactName || undefined}>
                  {o.legalName}
                </option>
              ))}
            </Select>
            {f.message("ownerId")}
          </Field>
          <Field label="Month *" htmlFor={ids.month}>
            <Select
              id={ids.month}
              value={month}
              onChange={(e) => {
                setMonth(e.target.value || "");
                f.clear("month");
                f.clear("propertyIds");
              }}
              aria-describedby={f.control("month")["aria-describedby"]}
              className={f.control("month").className}
            >
              <option value="">Select a month</option>
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
            {f.message("month")}
          </Field>
        </div>

        <div id={ids.propertyIds} role="group" aria-labelledby={`${ids.propertyIds}-label`} tabIndex={-1} className="flex flex-col gap-2 outline-none">
          <div className="flex flex-wrap items-center gap-2">
            <span id={`${ids.propertyIds}-label`} className="text-[12.5px] font-medium text-muted-foreground">Properties *</span>
            {selectable.length > 0 ? (
              <div className="ml-auto flex gap-3 text-[12.5px]">
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={() => setTicked(new Set(selectable.map((p) => p.propertyId as string)))}
                >
                  Select all
                </button>
                <button type="button" className="font-medium text-primary hover:underline" onClick={() => setTicked(new Set())}>
                  Clear
                </button>
              </div>
            ) : null}
          </div>
          {!ownerId || !month ? (
            <p className="text-[12.5px] text-faint">Pick the owner and month to see their properties.</p>
          ) : options === undefined ? (
            <Spinner label="Loading properties…" className="py-4" />
          ) : props.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              This owner has no linked properties.{" "}
              <Link href={`/owner-statements/owners/${ownerId}`} className="font-medium text-primary hover:underline">
                Link properties on the owner page
              </Link>
              .
            </p>
          ) : (
            <ul
              className={cx(
                "flex flex-col divide-y divide-border rounded-2xl border",
                f.errors.propertyIds ? "border-danger-ink" : "border-border",
              )}
            >
              {props.map((p) => {
                const cid = `${base}-p-${p.propertyId}`;
                if (p.selectable) {
                  // The whole row is the label, so a click anywhere on it ticks / unticks.
                  return (
                    <li key={p.propertyId} className="first:rounded-t-2xl last:rounded-b-2xl">
                      <label
                        htmlFor={cid}
                        onKeyDown={(e) => onRowKey(e, p.propertyId)}
                        className="flex cursor-pointer items-start gap-3 rounded-[inherit] px-3.5 py-2.5 text-[13.5px] hover:bg-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-ring"
                      >
                        <Checkbox id={cid} checked={ticked.has(p.propertyId)} onChange={(on) => toggle(p.propertyId, on)} />
                        <span className="min-w-0">{p.name}</span>
                      </label>
                    </li>
                  );
                }
                const draft = p.openDraft;
                return (
                  <li key={p.propertyId} className="flex items-start gap-3 px-3.5 py-2.5">
                    <Checkbox id={cid} checked={false} disabled onChange={() => {}} />
                    <div className="min-w-0 text-[13.5px] text-muted-foreground">
                      <label htmlFor={cid}>{p.name}</label>
                      {p.reason ? <span className="mt-0.5 block text-xs text-danger-ink/80">{p.reason}</span> : null}
                      {draft ? (
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          <Btn
                            sm
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/owner-statements/${draft.statementId}`);
                              onClose();
                            }}
                          >
                            Open draft
                          </Btn>
                          <Btn
                            sm
                            variant="dng"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDiscarding(draft);
                            }}
                          >
                            Discard draft
                          </Btn>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {f.message("propertyIds")}
        </div>
      </div>
    </Modal>
    </>
  );
}

/**
 * Confirmation for "Discard draft" on a blocked property (same rules as the statement page's
 * discard: optional reason up to 300 characters). Calls ownerStatements.discard; generateOptions is
 * reactive, so the property list refreshes by itself.
 */
function DiscardDraftDialog({
  draft,
  onClose,
  onDone,
}: {
  draft: OpenDraft;
  onClose: () => void;
  onDone: (statementId: string) => void;
}) {
  const discard = useMutation(api.ownerStatements.discard);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(() => ({ reason: `${base}-reason` }), [base]);
  const f = useFieldErrors(ids);

  async function submit() {
    if (busy) return;
    const r = reason.trim();
    if (!f.check(r.length > MAX_MEMO ? { reason: REASON_LONG } : {}, ["reason"])) return;
    setBusy(true);
    try {
      await discard({ statementId: draft.statementId, reason: r || undefined });
      toast.success("Draft discarded.");
      onDone(draft.statementId);
    } catch (e) {
      f.fromServer(e);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Discard the ${formatMonth(draft.month)} draft for ${draft.ownerName}?`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="dng" onClick={() => void submit()} disabled={busy}>
            {busy ? "Discarding…" : "Discard draft"}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13.5px] text-muted-foreground">
          It covers: {draft.propertyNames.join(", ")}. Nothing in the ledger, payments or work orders changes.
        </p>
        <Field label="Reason (optional)" htmlFor={ids.reason}>
          <Textarea
            id={ids.reason}
            rows={2}
            value={reason}
            maxLength={MAX_MEMO + 20}
            onChange={(e) => {
              setReason(e.target.value);
              f.clear("reason");
            }}
            {...f.control("reason", "min-h-[60px]")}
          />
          {f.message("reason")}
        </Field>
      </div>
    </Modal>
  );
}
