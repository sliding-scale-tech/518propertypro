"use client";

import { useQuery } from "convex/react";
import { X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Dropdown } from "@/components/ui/dropdown";

export type Severity = "emergency" | "urgent" | "routine" | "informational";
export type Status =
  | "new"
  | "under_review"
  | "more_info_needed"
  | "forwarded_to_pat"
  | "work_order_created"
  | "closed_out_of_scope"
  | "closed_duplicate";

export const OPEN_STATUSES: Status[] = ["new", "under_review", "more_info_needed", "forwarded_to_pat"];

export const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring";

export const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
export const btnOutline =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-input bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50";
export const btnDanger =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-50";

export const SEVERITY_META: Record<Severity, { label: string; dot: string; cls: string }> = {
  emergency: { label: "Emergency", dot: "🔴", cls: "bg-red-500/15 text-red-700 dark:text-red-400" },
  urgent: { label: "Urgent", dot: "🟠", cls: "bg-orange-500/15 text-orange-700 dark:text-orange-400" },
  routine: { label: "Routine", dot: "🟡", cls: "bg-yellow-500/20 text-yellow-800 dark:text-yellow-400" },
  informational: { label: "Info", dot: "⚪", cls: "bg-slate-500/15 text-slate-600 dark:text-slate-300" },
};

export const SEVERITY_OPTIONS = (Object.keys(SEVERITY_META) as Severity[]).map((s) => ({
  value: s,
  label: `${SEVERITY_META[s].dot} ${SEVERITY_META[s].label}`,
}));

export const STATUS_LABEL: Record<Status, string> = {
  new: "New",
  under_review: "Under review",
  more_info_needed: "Waiting on tenant",
  forwarded_to_pat: "Forwarded to Pat",
  work_order_created: "Work order created",
  closed_out_of_scope: "Closed",
  closed_duplicate: "Closed (duplicate)",
};

const STATUS_CLS: Record<Status, string> = {
  new: "bg-primary/15 text-primary",
  under_review: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  more_info_needed: "bg-warning/15 text-warning-foreground",
  forwarded_to_pat: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  work_order_created: "bg-success/15 text-success-foreground",
  closed_out_of_scope: "bg-muted text-muted-foreground",
  closed_duplicate: "bg-muted text-muted-foreground",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const m = SEVERITY_META[severity];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${m.cls}`}>
      <span aria-hidden>{m.dot}</span>
      {m.label}
    </span>
  );
}

export function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function mrNumber(n: number) {
  return `MR-${n}`;
}

export function timeAgo(ms: number, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function formatWhen(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Convex wraps server errors ("[CONVEX M(...)] Uncaught Error: msg"); show only the message. */
export function cleanError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const after = raw.includes("Uncaught Error:") ? raw.split("Uncaught Error:").pop()! : raw;
  return after.split("\n")[0].replace(/\s+at handler.*$/, "").trim() || "Something went wrong.";
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-card p-5 shadow-xl sm:max-w-lg sm:rounded-2xl"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/**
 * Note / reason prompt. `presets` adds a pick list whose label is prefixed to the text; the
 * "Other" preset needs free text. `onSubmit` throws to keep the dialog open (caller toasts).
 */
export function NoteDialog({
  title,
  description,
  label,
  required,
  confirmLabel,
  presets,
  danger,
  onSubmit,
  onClose,
}: {
  title: string;
  description?: string;
  label: string;
  required: boolean;
  confirmLabel: string;
  presets?: string[];
  danger?: boolean;
  onSubmit: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [preset, setPreset] = useState(presets?.[0] ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const isOther = presets ? preset === "Other" : true;
  const final = presets
    ? isOther
      ? text.trim()
      : [preset, text.trim()].filter(Boolean).join(": ")
    : text.trim();
  const valid = !required || final.length > 0;

  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid || busy) return;
          setBusy(true);
          try {
            await onSubmit(final);
            onClose();
          } catch {
            setBusy(false);
          }
        }}
      >
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        {presets ? (
          <Field label="Reason">
            <Dropdown value={preset} options={presets.map((p) => ({ value: p, label: p }))} onChange={setPreset} />
          </Field>
        ) : null}
        <Field label={presets && !isOther ? `${label} (optional)` : label}>
          <textarea
            className={`${inputClass} min-h-24`}
            value={text}
            maxLength={450}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnOutline} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={danger ? btnDanger : btnPrimary} disabled={!valid || busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Property then unit, from the team's real units. */
export function UnitPicker({
  value,
  onChange,
}: {
  value: Id<"units"> | "";
  onChange: (id: Id<"units"> | "") => void;
}) {
  const properties = useQuery(api.properties.list);
  const units = useQuery(api.units.list, {});
  const [propertyId, setPropertyId] = useState<string>("");

  const propertyOptions = useMemo(
    () => [
      { value: "", label: "Select property…" },
      ...(properties ?? []).map((p) => ({ value: p._id as string, label: p.name })),
    ],
    [properties],
  );
  const unitOptions = useMemo(
    () => [
      { value: "", label: propertyId ? "Select unit…" : "Pick a property first" },
      ...[...(units ?? [])]
        .filter((u) => u.propertyId === propertyId)
        .sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }))
        .map((u) => ({ value: u._id as string, label: `Unit ${u.unitNumber}` })),
    ],
    [units, propertyId],
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Dropdown
        value={propertyId}
        options={propertyOptions}
        onChange={(v) => {
          setPropertyId(v);
          onChange("");
        }}
      />
      <Dropdown value={value as string} options={unitOptions} onChange={(v) => onChange(v as Id<"units"> | "")} />
    </div>
  );
}

export function UnitPickerDialog({
  title,
  confirmLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  confirmLabel: string;
  onSubmit: (unitId: Id<"units">) => Promise<void>;
  onClose: () => void;
}) {
  const [unitId, setUnitId] = useState<Id<"units"> | "">("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4">
        <UnitPicker value={unitId} onChange={setUnitId} />
        <div className="flex justify-end gap-2">
          <button className={btnOutline} onClick={onClose}>
            Cancel
          </button>
          <button
            className={btnPrimary}
            disabled={!unitId || busy}
            onClick={async () => {
              if (!unitId) return;
              setBusy(true);
              try {
                await onSubmit(unitId);
                onClose();
              } catch {
                setBusy(false);
              }
            }}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
