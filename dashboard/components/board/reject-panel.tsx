"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Textarea } from "@/components/ui";
import { errorMessage, toast } from "@/components/ui/toast";
import { DesignSelect } from "./design-select";
import { OUT_OF_SCOPE_REASONS } from "./shared";

export const MIN_EXPLANATION = 5;

/**
 * "Close as Out of Scope" form: required reason + explanation, the confirm callout, and the two
 * buttons. `mode` picks the backend call: "am" = maintenance.closeOutOfScope (request still with
 * the asset manager), "admin" = maintenance.closeNoWorkOrder (forwarded to the admin).
 * Texting is off, so the tenant is never texted (the checkbox is shown disabled).
 */
export function RejectPanel({
  requestId,
  mode,
  onDone,
  onCancel,
}: {
  requestId: Id<"maintenanceRequests">;
  mode: "am" | "admin";
  onDone: () => void;
  onCancel: () => void;
}) {
  const closeOutOfScope = useMutation(api.maintenance.closeOutOfScope);
  const closeNoWorkOrder = useMutation(api.maintenance.closeNoWorkOrder);
  const [reason, setReason] = useState("");
  const [explanation, setExplanation] = useState("");
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const explanationOk = explanation.trim().length >= MIN_EXPLANATION;
  const valid = reason !== "" && explanationOk;

  const submit = async () => {
    setTouched(true);
    if (!valid || busy) return;
    setBusy(true);
    try {
      const args = { requestId, reason, explanation: explanation.trim() };
      if (mode === "am") await closeOutOfScope(args);
      else await closeNoWorkOrder(args);
      toast.success("Request rejected as out of scope.");
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-1 flex-col gap-4 px-5 py-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-medium text-slate-500">Closure reason *</span>
          <DesignSelect
            ariaLabel="Closure reason"
            variant="field"
            value={reason}
            placeholder="Select a reason"
            onChange={setReason}
            options={OUT_OF_SCOPE_REASONS.map((r) => ({ value: r, label: r }))}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-medium text-slate-500">Explanation *</span>
          <Textarea
            value={explanation}
            maxLength={1000}
            onChange={(e) => setExplanation(e.target.value)}
            aria-label="Explanation"
            aria-invalid={touched && !explanationOk}
            placeholder="Why is this out of scope?"
          />
          {touched && !explanationOk ? (
            <span className="text-[12px] text-rose-600">Add a short explanation (at least {MIN_EXPLANATION} characters).</span>
          ) : null}
        </label>
        <div className="rounded-[12px] bg-amber-50 px-3.5 py-3">
          <div className="text-[12.5px] font-semibold text-amber-900">Confirm the decision</div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-amber-800">
            The request will close with your name, time and explanation. No work order will be created.
          </p>
        </div>
        <div>
          <label className="flex items-center gap-2 text-[13px] text-slate-500" title="Texting is off for now">
            <input type="checkbox" checked={false} disabled readOnly />
            Text the tenant the out-of-scope message
          </label>
          <p className="mt-1 text-xs text-slate-500">Texting is off for now. The tenant will not be texted.</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-slate-100 px-5 py-4">
        <button
          type="button"
          disabled={busy || !valid}
          onClick={submit}
          className="h-11 w-full rounded-lg border border-rose-200 bg-rose-50 text-[13.5px] font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-50"
        >
          {busy ? "Rejecting…" : "Confirm Rejection"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="h-11 w-full rounded-lg border border-blue-500 bg-white text-[13.5px] font-semibold text-blue-600 transition-colors hover:bg-blue-50 disabled:opacity-50"
        >
          Keep Reviewing
        </button>
      </div>
    </>
  );
}
