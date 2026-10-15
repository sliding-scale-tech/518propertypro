import type { SevLevel } from "@/components/ui";

export type Severity = SevLevel;

export const ISSUE_TYPES = [
  "electrical",
  "water_leak",
  "broken_item",
  "gas",
  "fire",
  "flooding",
  "tenant_responsibility",
  "other",
] as const;

export function issueLabel(s: string): string {
  return s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export const SEVERITY_CHOICES: Array<{ value: Severity; label: string }> = [
  { value: "emergency", label: "Emergency" },
  { value: "urgent", label: "Urgent" },
  { value: "routine", label: "Routine" },
  { value: "informational", label: "Informational" },
];

/** Work-order priority has no "informational" level. */
export function priorityOf(sev: Severity): "emergency" | "urgent" | "routine" {
  return sev === "informational" ? "routine" : sev;
}

export const WINDOW_PRESETS = ["Today, 1–3 PM", "Today, 3–5 PM", "Tomorrow, 9–11 AM", "Tomorrow, 1–3 PM"];

export function mrId(n: number): string {
  return `MR-${n}`;
}
export function woId(n: number): string {
  return `WO-${n}`;
}

export function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function fmtMoney(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function hoursText(h: number): string {
  return `${Math.round(h * 100) / 100} h`;
}

export type Lane = "review" | "pat" | "tech" | "signoff";
export const LANES: Lane[] = ["review", "pat", "tech", "signoff"];

/** Readable timeline text for an audit row (note/withdraw/reassign get bespoke wording). */
export function auditText(a: { actorLabel: string; action: string; note?: string | null }): string {
  switch (a.action) {
    case "note_added":
      return `${a.actorLabel} added a note${a.note ? `: ${a.note}` : ""}`;
    case "withdrawn_from_pat":
      return `${a.actorLabel} withdrew it from Pat${a.note ? `: ${a.note}` : ""}`;
    case "reassigned_with_unit":
      return `Moved to a new asset manager with the unit${a.note ? ` (${a.note})` : ""}`;
    default: {
      const s = a.action.replace(/_/g, " ");
      return `${a.actorLabel} · ${s.charAt(0).toUpperCase()}${s.slice(1)}${a.note ? `: ${a.note}` : ""}`;
    }
  }
}
