"use client";

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useId, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { formatBps, formatCurrency } from "@/convex/rosFormat";
import { MAX_MEMO } from "@/convex/rosPolicy";
import { Btn, Field, Modal, Textarea } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { STATEMENT_CHANGED, finalizeArgs, reviewChanged, type Reviewed } from "./finalize-guard";
import { Checkbox, useFieldErrors } from "./form-bits";

export type StatementData = FunctionReturnType<typeof api.ownerStatements.get>;

const CONFIRM_DRAWS = "Tick the box to confirm the owner draw amounts.";
const REASON_LONG = "Keep the reason under 300 characters.";

/** Why Finalize is off right now, in the server's words (blocking first, then PERIOD_OPEN). */
export function finalizeBlocker(data: StatementData): string | null {
  if (data.statement.status !== "draft" || data.canFinalize) return null;
  const n = data.warnings.blocking.length;
  if (n > 0) return `Fix ${n} ${n === 1 ? "item" : "items"} on the Check step first.`;
  const open = data.warnings.info.find((w) => w.code === "PERIOD_OPEN");
  return open ? open.message : "This statement can't be finalized yet.";
}

/**
 * Finalize and Discard dialogs (spec 6.3). The Finalize dialog freezes what the user reviewed
 * (finalize-guard.ts): it sends the figures and hash captured when it opened, never the live ones,
 * and refuses while the live statement differs.
 */
export function FinalizeDialog({
  data,
  reviewed,
  onClose,
  onDone,
}: {
  data: StatementData;
  /** Captured when the dialog opened. */
  reviewed: Reviewed;
  onClose: () => void;
  onDone: () => void;
}) {
  const finalize = useMutation(api.ownerStatements.finalize);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(() => ({ confirm: `${base}-confirm` }), [base]);
  const f = useFieldErrors(ids);
  const { statement, owner, result } = data;
  // The live statement moved on while the dialog was open (another tab, a WO edit, ...).
  const changed = reviewChanged(reviewed, data.previewHash);

  async function submit() {
    if (busy) return;
    if (changed) {
      toast.error(STATEMENT_CHANGED);
      return;
    }
    if (!f.check(confirmed ? {} : { confirm: CONFIRM_DRAWS }, ["confirm"])) return;
    setBusy(true);
    try {
      await finalize(finalizeArgs(statement._id, reviewed));
      toast.success(`${statement.monthLabel} is final for ${owner.legalName}.`);
      onDone();
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  const money = (cents: number, skipped: boolean) => (skipped ? "skipped" : formatCurrency(cents));

  return (
    <Modal
      title={`Finalize ${statement.monthLabel} for ${owner.legalName}?`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="pri" onClick={() => void submit()} disabled={busy || changed}>
            {busy ? "Finalizing…" : "Finalize"}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13.5px]">
        {changed ? (
          <p role="alert" className="rounded-xl border border-danger-ink/30 bg-danger-soft px-3 py-2 text-danger-ink">
            {STATEMENT_CHANGED} Close this and open Finalize again.
          </p>
        ) : null}
        <ul className="flex flex-col gap-1.5">
          {data.properties.map((p) => {
            const i = result.columns.findIndex((c) => c.propertyId === p.propertyId);
            return (
              <li key={p.propertyId}>
                <span className="font-medium">{p.name}</span>: ending cash{" "}
                {i >= 0 ? formatCurrency(result.summary.ending.byProperty[i]) : "-"}, owner draw{" "}
                {money(p.draw.amountCents, p.draw.excluded)}, management fee {money(p.fee.amountCents, p.fee.excluded)}
                {p.fee.bps !== null ? ` (${formatBps(p.fee.bps)}%)` : ""},
                available for payment {i >= 0 ? formatCurrency(result.summary.available.byProperty[i]) : "-"}
              </li>
            );
          })}
        </ul>
        <p className="text-muted-foreground">
          Finalizing locks {statement.monthLabel} for these properties. Corrections go on next month&apos;s statement.
        </p>
        <div>
          <div className="flex items-start gap-2.5">
            <Checkbox
              id={ids.confirm}
              checked={confirmed}
              invalid={!!f.errors.confirm}
              describedBy={f.control("confirm")["aria-describedby"]}
              onChange={(v) => {
                setConfirmed(v);
                f.clear("confirm");
              }}
            />
            <label htmlFor={ids.confirm}>I&apos;ve checked the owner draw amounts</label>
          </div>
          {f.message("confirm")}
        </div>
      </div>
    </Modal>
  );
}

export function DiscardDialog({ statementId, onClose, onDone }: { statementId: string; onClose: () => void; onDone: () => void }) {
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
      await discard({ statementId, reason: r || undefined });
      toast.success("Draft discarded.");
      onDone();
    } catch (e) {
      f.fromServer(e);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Discard this draft?"
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
          Nothing in the ledger or on any work order changes. The month is freed so you can generate it again.
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
