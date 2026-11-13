"use client";

import { useAction, useConvex } from "convex/react";
import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2 } from "lucide-react";
import { useId, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { BulkPreview, BulkResult } from "@/convex/bulkReassign";
import { BULK_REASON_MAX, validateBulkInput, type BulkField, type BulkTeam } from "@/convex/bulkReassignLib";
import { serverError } from "@/lib/form-errors";
import { Btn, Field, Listbox, Modal, Textarea, cx, type ListboxOption } from "@/components/ui";
import { toast } from "@/components/toast";

export type BulkScope =
  | { kind: "building"; propertyId: Id<"properties">; name: string }
  | {
      kind: "team";
      team: BulkTeam;
      label: string;
      /** Who holds this team's units now (for "Only units held by"). */
      holders: Array<{ userId: Id<"users">; name: string; units: number }>;
    };

type Step = "form" | "preview" | "done";
type Errors = Partial<Record<BulkField, string>>;

/**
 * Bulk "Change asset manager": pick the new manager (and, for a team, optionally only one current
 * holder's units) and a reason, preview exactly what moves, then confirm. Validated here with the
 * same rules and words as the server (convex/bulkReassignLib.ts), and again by the server.
 */
export function BulkChangeDialog({
  scope,
  managers,
  onClose,
}: {
  scope: BulkScope;
  /** Every asset manager on the team, by name. */
  managers: Array<{ userId: Id<"users">; name: string }>;
  onClose: () => void;
}) {
  const convex = useConvex();
  const apply = useAction(api.bulkReassign.apply);
  const base = useId();
  const ids = { to: `${base}-to`, from: `${base}-from`, reason: `${base}-reason` };

  const [step, setStep] = useState<Step>("form");
  const [toUserId, setToUserId] = useState<string>("");
  const [fromUserId, setFromUserId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [preview, setPreview] = useState<Extract<BulkPreview, { ok: true }> | null>(null);

  const scopeArgs = scope.kind === "building" ? { propertyId: scope.propertyId } : { team: scope.team };

  const title = scope.kind === "building" ? `Change asset manager · ${scope.name}` : `Change asset manager · ${scope.label}`;

  function clearError(field: BulkField) {
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  }

  async function goPreview() {
    if (busy) return;
    const problems = validateBulkInput({ toUserId, reason, fromUserId });
    if (problems.length > 0) {
      const next: Errors = {};
      for (const p of problems) next[p.field] ??= p.message;
      setErrors(next);
      toast.error(problems[0].message);
      document.getElementById(problems[0].field === "reason" ? ids.reason : problems[0].field === "fromUserId" ? ids.from : ids.to)?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      // Read once at click time: what Confirm would do now. The apply re-checks everything.
      const res = await convex.query(api.bulkReassign.preview, {
        ...scopeArgs,
        toUserId,
        fromUserId: fromUserId || undefined,
      });
      if (!res) {
        toast.error("Only admins can do this.");
      } else if (!res.ok) {
        // e.g. "Delia already manages all 48 of these units": stay on the form, field marked.
        toast.error(res.message);
        if (res.field) setErrors({ [res.field]: res.message });
      } else {
        setPreview(res);
        setStep("preview");
      }
    } catch (e) {
      toast.error(serverError(e).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apply({ ...scopeArgs, toUserId, fromUserId: fromUserId || undefined, reason });
      setResult(res);
      setStep("done");
      toast.success(`${res.moved} unit${res.moved === 1 ? "" : "s"} moved to ${res.toName}`);
    } catch (e) {
      const err = serverError(e);
      toast.error(err.message);
      if (err.field === "toUserId" || err.field === "reason" || err.field === "fromUserId") {
        setErrors({ [err.field]: err.message });
        setStep("form");
      }
    } finally {
      setBusy(false);
    }
  }

  const toOptions: ListboxOption[] = managers.map((m) => ({ value: m.userId, label: m.name }));
  const fromOptions: ListboxOption[] =
    scope.kind === "team"
      ? [
          { value: "", label: "Everyone on this team" },
          ...scope.holders.map((h) => ({ value: h.userId, label: h.name, sublabel: `${h.units} unit${h.units === 1 ? "" : "s"}` })),
        ]
      : [];

  const footer =
    step === "form" ? (
      <>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="pri" onClick={() => void goPreview()} disabled={busy}>
          {busy ? "Checking…" : "Preview"}
        </Btn>
      </>
    ) : step === "preview" ? (
      <>
        <Btn onClick={() => setStep("form")} disabled={busy}>
          Back
        </Btn>
        <Btn variant="pri" onClick={() => void confirm()} disabled={busy || !preview}>
          {busy ? "Moving units…" : "Confirm change"}
        </Btn>
      </>
    ) : (
      <Btn variant="pri" onClick={onClose}>
        Done
      </Btn>
    );

  return (
    <Modal title={title} onClose={busy ? () => undefined : onClose} footer={footer}>
      {step === "form" ? (
        <div className="space-y-4">
          <p className="text-[13px] text-muted-foreground">
            {scope.kind === "building"
              ? "Moves every unit in this building to one asset manager. Their open maintenance requests move with them, and so do the open leads this building routed from the old manager."
              : "Moves every unit in this team's buildings to one asset manager, or only the units one person holds now. Their open maintenance requests move with them, and so do the open leads those buildings routed from the old manager."}
          </p>
          {scope.kind === "team" ? (
            <Field label="Move units held by" htmlFor={ids.from}>
              <Listbox
                id={ids.from}
                value={fromUserId}
                options={fromOptions}
                onValueChange={(v) => {
                  setFromUserId(v ?? "");
                  clearError("fromUserId");
                }}
                aria-invalid={!!errors.fromUserId}
                aria-describedby={errors.fromUserId ? `${ids.from}-err` : undefined}
                className={cx(errors.fromUserId && "!border-danger-ink")}
              />
              <FieldMsg id={`${ids.from}-err`} text={errors.fromUserId} />
            </Field>
          ) : null}
          <Field label="New asset manager" htmlFor={ids.to}>
            <Listbox
              id={ids.to}
              value={toUserId}
              options={toOptions}
              placeholder={toOptions.length ? "Choose the new asset manager" : "No asset managers yet"}
              disabled={toOptions.length === 0}
              onValueChange={(v) => {
                setToUserId(v ?? "");
                clearError("toUserId");
              }}
              aria-invalid={!!errors.toUserId}
              aria-describedby={errors.toUserId ? `${ids.to}-err` : undefined}
              className={cx(errors.toUserId && "!border-danger-ink")}
            />
            <FieldMsg id={`${ids.to}-err`} text={errors.toUserId} />
          </Field>
          <Field label="Reason" htmlFor={ids.reason} hint={errors.reason ? undefined : "Saved in the history of every unit that moves."}>
            <Textarea
              id={ids.reason}
              value={reason}
              maxLength={BULK_REASON_MAX + 50}
              placeholder="e.g., Nikki is handing the Silver portfolio to Delia"
              onChange={(e) => {
                setReason(e.target.value);
                clearError("reason");
              }}
              aria-invalid={!!errors.reason}
              aria-describedby={errors.reason ? `${ids.reason}-err` : undefined}
              className={cx(errors.reason && "!border-danger-ink")}
            />
            <FieldMsg id={`${ids.reason}-err`} text={errors.reason} />
          </Field>
        </div>
      ) : step === "preview" ? (
        <div className="space-y-3">
          {!preview ? null : (
            <>
              <div className="rounded-xl border border-border bg-accent px-3.5 py-3">
                <div className="flex items-center gap-2 text-[13px] font-semibold">
                  <ArrowRight aria-hidden className="h-4 w-4 text-primary" />
                  {preview.scopeName}
                </div>
                <p className="mt-1 text-[13.5px]">{preview.sentence}</p>
              </div>
              {preview.defaultsSwitching > 0 ? (
                <p className="text-[12.5px] text-muted-foreground">
                  {preview.toName} also becomes the default asset manager of {preview.defaultsSwitching} building
                  {preview.defaultsSwitching === 1 ? "" : "s"}, so new units there start with them.
                </p>
              ) : null}
              {preview.toursNote ? (
                <p className="flex items-start gap-2 rounded-xl border border-dashed border-border-strong px-3 py-2 text-[12.5px] text-muted-foreground">
                  <CalendarDays aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {preview.toursNote}
                </p>
              ) : null}
              <p className="text-[12.5px] text-muted-foreground">
                Reason: <span className="text-foreground">{reason.trim()}</span>
              </p>
            </>
          )}
        </div>
      ) : result ? (
        <div className="space-y-3">
          <p className="flex items-start gap-2 text-[13.5px]">
            <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-success-ink" />
            <span>
              Moved {result.moved} unit{result.moved === 1 ? "" : "s"}
              {result.buildingCount > 1 ? ` in ${result.buildingCount} buildings` : ""} to {result.toName}
              {withMoved(result)}
              .
            </span>
          </p>
          {result.defaultsSwitched > 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              {result.toName} is now the default asset manager of {result.defaultsSwitched} building
              {result.defaultsSwitched === 1 ? "" : "s"}.
            </p>
          ) : null}
          {result.toursNote ? (
            <p className="flex items-start gap-2 rounded-xl border border-dashed border-border-strong px-3 py-2 text-[12.5px] text-muted-foreground">
              <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {result.toursNote}
            </p>
          ) : null}
          <p className="text-[12.5px] text-muted-foreground">Each unit&apos;s history shows this change, who made it and the reason.</p>
        </div>
      ) : null}
    </Modal>
  );
}

/** ", with 7 open maintenance requests and 3 open leads" (only what moved), or "". */
function withMoved(r: Pick<BulkResult, "requestsMoved" | "leadsMoved">): string {
  const parts = [
    r.requestsMoved > 0 ? `${r.requestsMoved} open maintenance request${r.requestsMoved === 1 ? "" : "s"}` : null,
    r.leadsMoved > 0 ? `${r.leadsMoved} open lead${r.leadsMoved === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? `, with ${parts.join(" and ")}` : "";
}

function FieldMsg({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return (
    <p id={id} role="alert" className="text-xs text-danger-ink">
      {text}
    </p>
  );
}
