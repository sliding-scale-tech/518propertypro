"use client";

import { useMutation } from "convex/react";
import { useId, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { GeneratedDraw, GeneratedFee } from "@/convex/rosCalc";
import { MAX_AMOUNT_CENTS, formatBps, formatCurrency, parseDollarsToCents } from "@/convex/rosFormat";
import { MAX_MEMO } from "@/convex/rosPolicy";
import { Btn, Field, Modal, Textarea } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { MoneyInput, centsToInput, useFieldErrors } from "./form-bits";

/** Exact server messages (ownerStatements.setGenerated, spec 5.4). */
const AMOUNT_INVALID = "Enter the amount like 657.32.";
const AMOUNT_TOO_BIG = "The amount can't be more than $1,000,000.00.";
const MEMO_LONG = "Keep the memo under 300 characters.";

/**
 * Edit the management fee (amount + memo) or the owner draw (amount) of one property on a draft,
 * with "Reset to calculated / suggested" (spec 6.3). Skipping is a separate row action.
 */
export function GeneratedDialog({
  statementId,
  propertyId,
  propertyName,
  kind,
  fee,
  draw,
  onClose,
}: {
  statementId: string;
  propertyId: string;
  propertyName: string;
  kind: "fee" | "draw";
  fee: GeneratedFee;
  draw: GeneratedDraw;
  onClose: () => void;
}) {
  const setGenerated = useMutation(api.ownerStatements.setGenerated);
  const current = kind === "fee" ? fee.amountCents : draw.amountCents;
  const [amount, setAmount] = useState(centsToInput(current));
  const [memo, setMemo] = useState(fee.memo);
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(() => ({ amountCents: `${base}-amount`, memo: `${base}-memo` }), [base]);
  const f = useFieldErrors(ids);

  async function run(args: { amountCents?: number | null; memo?: string | null }, done: string) {
    setBusy(true);
    try {
      await setGenerated({ statementId, propertyId, kind, ...args });
      toast.success(done);
      onClose();
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (busy) return;
    const cents = parseDollarsToCents(amount);
    const all: Record<string, string> = {};
    if (cents === null) all.amountCents = AMOUNT_INVALID;
    else if (cents > MAX_AMOUNT_CENTS) all.amountCents = AMOUNT_TOO_BIG;
    if (kind === "fee" && memo.trim().length > MAX_MEMO) all.memo = MEMO_LONG;
    if (!f.check(all, ["amountCents", "memo"])) return;
    const args: { amountCents?: number | null; memo?: string | null } = {};
    if (cents !== current) args.amountCents = cents;
    if (kind === "fee" && memo.trim() !== fee.memo) args.memo = memo.trim() === "" ? null : memo.trim();
    if (Object.keys(args).length === 0) {
      onClose();
      return;
    }
    await run(args, kind === "fee" ? "Management fee updated." : "Owner draw updated.");
  }

  const title = kind === "fee" ? `Management fee: ${propertyName}` : `Owner draw: ${propertyName}`;
  const canReset = kind === "fee" ? fee.overridden : draw.overridden;

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          {canReset ? (
            <Btn
              className="mr-auto"
              disabled={busy}
              onClick={() =>
                void run(
                  kind === "fee" ? { amountCents: null, memo: null } : { amountCents: null },
                  kind === "fee" ? "Management fee reset to calculated." : "Owner draw reset to suggested.",
                )
              }
            >
              {kind === "fee" ? "Reset to calculated" : "Reset to suggested"}
            </Btn>
          ) : null}
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="pri" onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {kind === "fee" ? (
          <p className="text-[13px] text-muted-foreground">
            {fee.bps === null
              ? "The owner's management fee % isn't set."
              : `Calculated: ${formatCurrency(fee.computedCents)} (${formatBps(fee.bps)}% of ${formatCurrency(fee.baseCents)} fee-base income).`}
          </p>
        ) : (
          <p className="text-[13px] text-muted-foreground">Suggested: {formatCurrency(draw.suggestedCents)}</p>
        )}
        <Field label="Amount *" htmlFor={ids.amountCents}>
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
        {kind === "fee" ? (
          <Field label="Memo" htmlFor={ids.memo} hint="Prints on the statement. Leave blank for the standard memo.">
            <Textarea
              id={ids.memo}
              rows={2}
              value={memo}
              maxLength={MAX_MEMO + 20}
              onChange={(e) => {
                setMemo(e.target.value);
                f.clear("memo");
              }}
              {...f.control("memo", "min-h-[60px]")}
            />
            {f.message("memo")}
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
