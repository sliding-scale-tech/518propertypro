"use client";

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatBps, formatCurrency, formatDate, formatPeriod } from "@/convex/rosFormat";
import { MAX_MEMO } from "@/convex/rosPolicy";
import { DownloadStatementPdfButton } from "@/components/finance/pdf/download-button";
import { Btn, Card, Field, Modal, Textarea } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { serverError } from "@/lib/form-errors";
import { STATEMENT_CHANGED, captureReviewed, finalizeArgs, reviewChanged, type Reviewed } from "./finalize-guard";
import { Checkbox, useFieldErrors } from "./form-bits";
import { ANCHOR } from "./warning-links";
import { StatusPill } from "./statements-list";

export type StatementData = FunctionReturnType<typeof api.ownerStatements.get>;

const CONFIRM_DRAWS = "Tick the box to confirm the owner draw amounts.";
const REASON_LONG = "Keep the reason under 300 characters.";

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className="text-[13.5px] font-medium tabular-nums">{children}</div>
    </div>
  );
}

/** Why Finalize is off right now, in the server's words (blocking first, then PERIOD_OPEN). */
export function finalizeBlocker(data: StatementData): string | null {
  if (data.statement.status !== "draft" || data.canFinalize) return null;
  const n = data.warnings.blocking.length;
  if (n > 0) return `Fix ${n} ${n === 1 ? "item" : "items"} under “Fix before finalizing” first.`;
  const open = data.warnings.info.find((w) => w.code === "PERIOD_OPEN");
  return open ? open.message : "This statement can't be finalized yet.";
}

/**
 * The right-hand "Review & delivery" card (spec 6.3): status, owner, period, statement date, the
 * two bottom-line totals (server figures), the finalize gate, and the draft / final actions.
 */
export function SidePanel({ data, onFinalized }: { data: StatementData; onFinalized: () => void }) {
  const router = useRouter();
  const { statement, owner, result } = data;
  const isDraft = statement.status === "draft";
  const [finalizing, setFinalizing] = useState<Reviewed | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const blocker = finalizeBlocker(data);
  const nBlocking = data.warnings.blocking.length;
  const sid = statement._id as Id<"ownerStatements">;

  return (
    <Card className="flex flex-col gap-4 lg:sticky lg:top-4">
      <h3 className="text-[15px] font-semibold">Review &amp; delivery</h3>
      <div className="flex flex-col gap-3">
        <Item label="Report status">
          <StatusPill status={statement.status} />
        </Item>
        <Item label="Owner">{owner.legalName}</Item>
        <Item label="Period">{formatPeriod(statement.periodStart, statement.periodEnd)}</Item>
        <Item label="Statement date">
          {statement.statementDate ? (
            formatDate(statement.statementDate)
          ) : (
            <span className="font-normal text-muted-foreground">Set when finalized</span>
          )}
        </Item>
        <Item label="Ending cash (All properties)">{formatCurrency(result.summary.ending.total)}</Item>
        <Item label="Available for payment">{formatCurrency(result.summary.available.total)}</Item>
        {statement.status === "final" && statement.finalizedByName ? (
          <Item label="Finalized by">{statement.finalizedByName}</Item>
        ) : null}
      </div>

      {isDraft ? (
        <>
          <RentConfirm data={data} />
          <div className="border-t border-border pt-3">
            <div className="mb-1 text-[13.5px] font-semibold">Before finalizing</div>
            {nBlocking > 0 ? (
              <p className="text-[13px] text-danger-ink">
                {nBlocking} {nBlocking === 1 ? "item needs" : "items need"} fixing.
              </p>
            ) : data.canFinalize ? (
              <p className="flex items-center gap-1.5 text-[13px] text-success-ink">
                <CheckCircle2 aria-hidden className="h-4 w-4" /> Ready to finalize
              </p>
            ) : (
              <p className="text-[13px] text-warning-ink">{blocker}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Btn
              variant="pri"
              disabled={!data.canFinalize}
              title={blocker ?? undefined}
              aria-describedby={blocker ? `${statement._id}-blocker` : undefined}
              onClick={() => setFinalizing(captureReviewed(data))}
            >
              Finalize
            </Btn>
            {blocker ? (
              <p id={`${statement._id}-blocker`} className="sr-only">
                {blocker}
              </p>
            ) : null}
            <DownloadStatementPdfButton statementId={sid} draft label="Preview PDF" />
            <Btn variant="dng" onClick={() => setDiscarding(true)}>
              Discard draft
            </Btn>
          </div>
          <p className="text-xs text-muted-foreground">The preview PDF is marked DRAFT.</p>
        </>
      ) : statement.status === "final" ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <DownloadStatementPdfButton statementId={sid} draft={false} label="Download PDF" />
          <p className="text-xs text-muted-foreground">Emailing statements to owners comes later.</p>
        </div>
      ) : null}

      {finalizing ? (
        <FinalizeDialog
          data={data}
          reviewed={finalizing}
          onClose={() => setFinalizing(null)}
          onDone={() => {
            setFinalizing(null);
            onFinalized();
          }}
        />
      ) : null}
      {discarding ? (
        <DiscardDialog
          statementId={statement._id}
          onClose={() => setDiscarding(false)}
          onDone={() => router.push(`/owner-statements?month=${statement.month}`)}
        />
      ) : null}
    </Card>
  );
}

/**
 * "I've checked the rent lines against what was actually received" (roster-rent prefill). Ticking
 * sends the rent fingerprint the accountant is looking at; any later change to a rent line unticks
 * it (server side), and RENT_NOT_CHECKED blocks Finalize until it is ticked again.
 */
function RentConfirm({ data }: { data: StatementData }) {
  const confirmRent = useMutation(api.ownerStatements.confirmRent);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const { rent, statement } = data;
  if (rent.lineCount === 0) return null;

  async function toggle(next: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await confirmRent({ statementId: statement._id, checked: next, expectedRentHash: rent.hash });
      toast.success(next ? "Rent lines confirmed." : "Rent confirmation removed.");
    } catch (e) {
      toast.error(serverError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id={ANCHOR.confirmRent} className="border-t border-border pt-3">
      <div className="mb-1 text-[13.5px] font-semibold">Confirm rent</div>
      <div className="flex items-start gap-2.5 text-[13px]">
        <Checkbox
          id={id}
          checked={rent.checked}
          disabled={busy}
          invalid={!rent.checked}
          onChange={(v) => void toggle(v)}
        />
        <label htmlFor={id}>I&apos;ve checked the rent lines against what was actually received</label>
      </div>
      <p className={`mt-1 text-xs ${rent.checked ? "text-muted-foreground" : "text-danger-ink"}`}>
        {rent.checked
          ? `Confirmed${rent.checkedByName ? ` by ${rent.checkedByName}` : ""}${rent.checkedAt ? ` on ${new Date(rent.checkedAt).toLocaleDateString("en-US")}` : ""}.`
          : `${rent.lineCount} roster rent ${rent.lineCount === 1 ? "line" : "lines"} to check. Edit, remove (didn't pay) or add rows first, then tick this.`}
      </p>
    </div>
  );
}

function FinalizeDialog({
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

function DiscardDialog({ statementId, onClose, onDone }: { statementId: string; onClose: () => void; onDone: () => void }) {
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
