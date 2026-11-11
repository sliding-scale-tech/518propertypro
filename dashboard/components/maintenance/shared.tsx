"use client";

import { useQuery } from "convex/react";
import { useMemo, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Dropdown } from "@/components/ui/dropdown";
import { Modal as UiModal } from "@/components/ui/modal";

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
  "w-full rounded-xl border border-input bg-card px-[11px] py-2 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-faint focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60";

export const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-primary bg-primary px-3.5 py-2 text-[13.5px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45";
export const btnOutline =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-[13.5px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45";
export const btnDanger =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-[13.5px] font-medium text-danger-ink transition-colors hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45";

export const SEVERITY_META: Record<Severity, { label: string; dot: string; cls: string }> = {
  emergency: { label: "Emergency", dot: "🔴", cls: "bg-danger-soft text-danger-ink" },
  urgent: { label: "Urgent", dot: "🟠", cls: "bg-warning-soft text-warning-ink" },
  routine: { label: "Routine", dot: "🟡", cls: "bg-accent text-accent-foreground" },
  informational: { label: "Info", dot: "⚪", cls: "bg-muted text-muted-foreground" },
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
  new: "bg-accent text-accent-foreground",
  under_review: "bg-accent text-accent-foreground",
  more_info_needed: "bg-warning-soft text-warning-ink",
  forwarded_to_pat: "bg-violet-soft text-violet",
  work_order_created: "bg-success-soft text-success-ink",
  closed_out_of_scope: "bg-muted text-muted-foreground",
  closed_duplicate: "bg-muted text-muted-foreground",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const m = SEVERITY_META[severity];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-[9px] text-xs font-medium leading-5 ${m.cls}`}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {m.label}
    </span>
  );
}

export function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-[9px] text-xs font-medium leading-5 ${STATUS_CLS[status]}`}>
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

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <UiModal title={title} onClose={onClose}>
      {children}
    </UiModal>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12.5px] font-medium text-muted-foreground">{label}</span>
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
  extra,
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
  /** Extra controls (for example a checkbox) rendered above the buttons. */
  extra?: ReactNode;
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
        {extra}
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
