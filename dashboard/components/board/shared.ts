import type { SevLevel } from "@/components/ui";

export type Severity = SevLevel;

export { OUT_OF_SCOPE_REASONS } from "@/convex/maintenanceReasons";

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

export function ago(ms: number): string {
  const hours = Math.max(0, Math.floor((Date.now() - ms) / 3_600_000));
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** "James T." from a full name. */
export function shortPerson(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0]} ${parts[parts.length - 1]![0]}.`;
}

export function fmtDay(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtStamp(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "8-10-2026, 7:58AM" */
export function fmtCreated(ms: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(" ", "");
  return `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}, ${time}`;
}

/** "October 19, 2026 · 10:12 AM" */
export function fmtLong(ms: number): string {
  const d = new Date(ms);
  const day = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}

/** Kanban / table status keys (same as convex/board.ts StatusKey). */
export type StatusKey =
  | "am_review"
  | "admin_review"
  | "escalated"
  | "in_progress"
  | "completed"
  | "closed"
  | "rejected";

/** Table chip values. "closed" also covers rejected on the server. */
export type TableStatus = "all" | "am_review" | "admin_review" | "escalated" | "in_progress" | "completed" | "closed";

export const STATUS_LABELS: Record<StatusKey, string> = {
  am_review: "Asset Manager Review",
  admin_review: "Admin Review",
  escalated: "Escalated",
  in_progress: "Work in Progress",
  completed: "Completed (Needs Sign Off)",
  closed: "Closed",
  rejected: "Rejected as Out of Scope",
};

/** Pill colours per status (tailwind classes). */
export const STATUS_PILL: Record<StatusKey, string> = {
  am_review: "bg-violet-50 text-violet-700",
  admin_review: "bg-indigo-50 text-indigo-700",
  escalated: "bg-amber-50 text-amber-700",
  in_progress: "bg-sky-50 text-sky-700",
  completed: "bg-emerald-50 text-emerald-700",
  closed: "bg-slate-100 text-slate-600",
  rejected: "bg-rose-50 text-rose-600",
};

/**
 * Old ?lane= values (review / pat / tech / signoff) and the new keys, both mapped to a table
 * status. Anything else is "all".
 */
export function tableStatusFromParam(raw: string | null): TableStatus {
  switch (raw) {
    case "review":
    case "am_review":
      return "am_review";
    case "pat":
    case "escalated":
      return "escalated";
    case "admin_review":
      return "admin_review";
    case "tech":
    case "in_progress":
      return "in_progress";
    case "signoff":
    case "completed":
      return "completed";
    case "closed":
    case "rejected":
      return "closed";
    default:
      return "all";
  }
}

/** Named priority levels, coloured like the design (red / orange / blue, informational grey). */
export const PRIORITY_LEVELS: Array<{ value: Severity; label: string; dot: string; chip: string; accent: string }> = [
  { value: "emergency", label: "Emergency", dot: "#ef4444", chip: "bg-rose-50 text-rose-600", accent: "border-l-rose-500" },
  { value: "urgent", label: "Urgent", dot: "#f97316", chip: "bg-orange-50 text-orange-700", accent: "border-l-orange-500" },
  { value: "routine", label: "Routine", dot: "#3b82f6", chip: "bg-sky-50 text-sky-700", accent: "border-l-sky-500" },
  { value: "informational", label: "Informational", dot: "#94a3b8", chip: "bg-slate-100 text-slate-600", accent: "border-l-slate-300" },
];

export function priorityMeta(level: string) {
  return PRIORITY_LEVELS.find((p) => p.value === level) ?? PRIORITY_LEVELS[2]!;
}

/** Only https storage links (or http on localhost for local dev) are ever opened or embedded. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol === "https:") return u.toString();
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return u.toString();
  } catch {
    // not a URL
  }
  return null;
}

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
