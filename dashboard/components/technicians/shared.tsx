"use client";

import { Pill } from "@/components/ui";

export type TechStatus = "busy" | "idle";
export type WoStatusGroup = "pending" | "in_progress" | "needs_sign_off" | "closed" | "cancelled";

/** Busy = at least one work order in progress; Idle otherwise (see convex/technicians.ts). */
export function TechStatusBadge({ status }: { status: TechStatus }) {
  return status === "busy" ? <Pill tone="ok">Busy</Pill> : <Pill tone="warn">Idle</Pill>;
}

const WO_TONE = {
  pending: "warn",
  in_progress: "acc",
  needs_sign_off: "ok",
  closed: "neutral",
  cancelled: "neutral",
} as const;

export function WoStatusPill({ group, label }: { group: WoStatusGroup; label: string }) {
  return <Pill tone={WO_TONE[group]}>{label}</Pill>;
}

export const WO_STATUS_OPTIONS: Array<{ value: WoStatusGroup; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "Work in Progress" },
  { value: "needs_sign_off", label: "Completed (Needs Sign Off)" },
  { value: "closed", label: "Closed" },
  { value: "cancelled", label: "Cancelled" },
];

/** Red border for a field that failed validation (the shared Input/Select have no invalid style). */
export const INVALID = "border-danger-ink focus:border-danger-ink";

export const EMAIL_RE = /^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[^\s@<>"',;:()[\]\\]{2,}$/;
export const E164_RE = /^\+[1-9]\d{6,14}$/;
