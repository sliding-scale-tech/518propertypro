"use client";

import { useMutation, useQuery } from "convex/react";
import { Percent } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { formatBps } from "@/convex/rosFormat";
import {
  DEFAULT_FEE_DRAFT_NOTE,
  FEE_MSG,
  defaultFeeConfirmText,
  readFeeInput,
  resetOverridesLabel,
  setDefaultFeeProblem,
  type FeeCounts,
} from "@/convex/rosPolicy";
import { Btn, Field, Input, Modal } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { serverError } from "@/lib/form-errors";
import { Checkbox, useFieldErrors } from "./form-bits";

type Snapshot = FeeCounts & { currentBps: number };

/**
 * "Change fee for all properties" (Owners page header): the default fee every property without its
 * own fee uses. Step 1 asks for the new %, step 2 is the confirmation alert with the counts the
 * server re-checks (feeSettings.setDefaultFee expectedCounts).
 */
export function DefaultFeeButton() {
  const settings = useQuery(api.feeSettings.get, {});
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn onClick={() => setOpen(true)} disabled={settings === undefined}>
        <Percent aria-hidden className="h-4 w-4" /> Change fee for all properties
      </Btn>
      {open && settings ? <DefaultFeeDialog settings={settings} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** "Default management fee: 5.00% · 2 properties have their own fee." for the page subtitle. */
export function useDefaultFeeLine(): string | null {
  const s = useQuery(api.feeSettings.get, {});
  if (!s) return null;
  const own = s.ownFeeCount === 0 ? "" : ` · ${s.ownFeeCount} ${s.ownFeeCount === 1 ? "property has its" : "properties have their"} own fee`;
  return `Default management fee: ${formatBps(s.defaultBps)}%${own}.`;
}

function DefaultFeeDialog({
  settings,
  onClose,
}: {
  settings: { defaultBps: number; totalProperties: number; ownFeeCount: number };
  onClose: () => void;
}) {
  const setDefaultFee = useMutation(api.feeSettings.setDefaultFee);
  const [value, setValue] = useState("");
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [newBps, setNewBps] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [alsoReset, setAlsoReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(() => ({ bps: `${base}-fee`, alsoResetOverrides: `${base}-reset` }), [base]);
  const f = useFieldErrors(ids);

  const live: Snapshot = {
    totalProperties: settings.totalProperties,
    ownFeeCount: settings.ownFeeCount,
    currentBps: settings.defaultBps,
  };

  function next() {
    const r = readFeeInput(value);
    if (!r.ok) {
      f.check({ bps: r.message }, ["bps"]);
      return;
    }
    if (r.bps === null) {
      f.check({ bps: FEE_MSG.defaultMissing }, ["bps"]);
      return;
    }
    if (r.bps === live.currentBps && live.ownFeeCount === 0) {
      f.check({ bps: FEE_MSG.defaultUnchanged(formatBps(r.bps)) }, ["bps"]);
      return;
    }
    setNewBps(r.bps);
    setSnapshot(live);
    setAlsoReset(false);
    setStep("confirm");
  }

  async function confirm() {
    if (busy || newBps === null || snapshot === null) return;
    const problem = setDefaultFeeProblem({
      bps: newBps,
      alsoResetOverrides: alsoReset,
      currentBps: snapshot.currentBps,
      actual: snapshot,
      expected: snapshot,
    });
    if (problem) {
      // Only "already this fee" can come back here: the person must tick the reset box or go back.
      f.check({ alsoResetOverrides: problem.message }, ["alsoResetOverrides"]);
      return;
    }
    setBusy(true);
    try {
      const res = await setDefaultFee({ bps: newBps, alsoResetOverrides: alsoReset, expectedCounts: snapshot });
      toast.success(
        res.reset > 0
          ? `The management fee is now ${formatBps(res.defaultBps)}% for all properties (${res.reset} reset).`
          : `The default management fee is now ${formatBps(res.defaultBps)}%.`,
      );
      onClose();
    } catch (e) {
      const err = serverError(e);
      if (err.field === "expectedCounts") {
        // Show the current numbers so the person decides again on what is really there.
        toast.error(err.message);
        setSnapshot(live);
        setAlsoReset(false);
      } else if (err.field === "bps") {
        setStep("enter");
        f.fromServer(e);
      } else {
        toast.error(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (step === "confirm" && newBps !== null && snapshot !== null) {
    const m = snapshot.ownFeeCount;
    return (
      <Modal
        title="Change the fee for all properties?"
        size="sm"
        onClose={busy ? () => undefined : onClose}
        footer={
          <>
            <Btn onClick={onClose} disabled={busy}>
              Cancel
            </Btn>
            <Btn variant="pri" onClick={() => void confirm()} disabled={busy}>
              {busy ? "Changing…" : "Confirm"}
            </Btn>
          </>
        }
      >
        <div role="alert" className="flex flex-col gap-3 text-[13.5px]">
          <p>{defaultFeeConfirmText(snapshot.currentBps, newBps, snapshot)}</p>
          {m > 0 ? (
            <div>
              <div className="flex items-start gap-2.5">
                <Checkbox
                  id={ids.alsoResetOverrides}
                  checked={alsoReset}
                  invalid={!!f.errors.alsoResetOverrides}
                  describedBy={f.control("alsoResetOverrides")["aria-describedby"]}
                  onChange={(v) => {
                    setAlsoReset(v);
                    f.clear("alsoResetOverrides");
                  }}
                />
                <label htmlFor={ids.alsoResetOverrides}>{resetOverridesLabel(m, newBps)}</label>
              </div>
              {f.message("alsoResetOverrides")}
            </div>
          ) : null}
          <p className="text-muted-foreground">{DEFAULT_FEE_DRAFT_NOTE}</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Change fee for all properties"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="pri" onClick={next}>
            Continue
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13.5px]">
        <p className="text-muted-foreground">
          The default fee is {formatBps(live.currentBps)}%. Properties with their own fee keep it unless you reset them.
        </p>
        <Field label="New management fee % *" htmlFor={ids.bps} hint="For example 5.00 (0.00 to 100.00).">
          <div className="relative max-w-[180px]">
            <Input
              id={ids.bps}
              value={value}
              inputMode="decimal"
              autoComplete="off"
              placeholder={formatBps(live.currentBps)}
              onChange={(e) => {
                setValue(e.target.value);
                f.clear("bps");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") next();
              }}
              {...f.control("bps", "!pr-7 tabular-nums")}
            />
            <span aria-hidden className="pointer-events-none absolute right-[11px] top-1/2 -translate-y-1/2 text-[13.5px] text-muted-foreground">
              %
            </span>
          </div>
          {f.message("bps")}
        </Field>
      </div>
    </Modal>
  );
}
