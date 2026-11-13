"use client";

import { useMutation, useQuery } from "convex/react";
import { CalendarClock } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { toast } from "@/components/ui/toast";
import { Avatar, Btn, Pill, Select, cx } from "@/components/ui";

export type LeadAssignmentFields = {
  assignedUser: { userId: string; name: string } | null;
  // How the owner was set (B41): by the building the caller picked, or by hand. null when unassigned.
  assignment?: { by: "building" | "manual"; building: string | null } | null;
  assignedToMe: boolean;
  tour: { start: number; timeZone: string; assignedUserId: string; assignedName: string } | null;
};

/**
 * Display name of whoever owns the lead. Only the assigned user: the person giving a tour is not the
 * lead's owner (B41), so a lead with a tour but no owner still shows as Unassigned.
 */
export function assigneeName(l: LeadAssignmentFields): string | null {
  return l.assignedUser?.name ?? null;
}

/** "By building: 12 Main St", "By an admin", or null when unassigned. */
export function assignmentLabel(l: LeadAssignmentFields): string | null {
  if (!l.assignedUser || !l.assignment) return null;
  if (l.assignment.by === "building") {
    return l.assignment.building ? `Asset manager of ${l.assignment.building}` : "By the building picked";
  }
  return l.assignment.building ? `Assigned by hand (${l.assignment.building})` : "Assigned by hand";
}

export function isUnassigned(l: LeadAssignmentFields): boolean {
  return assigneeName(l) === null;
}

/** "Tue 3:00 PM" in the team's time zone. */
export function formatTourSlot(start: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(new Date(start));
  } catch {
    return new Date(start).toLocaleString();
  }
}

/** "Tour: Tue 3:00 PM with Alex", or null when no tour is booked. */
export function tourLabel(l: LeadAssignmentFields): string | null {
  if (!l.tour) return null;
  const first = l.tour.assignedName.trim().split(/\s+/)[0] || "the team";
  return `Tour: ${formatTourSlot(l.tour.start, l.tour.timeZone)} with ${first}`;
}

/** Avatar + first name, or an "Unassigned" pill. */
export function AssigneeCell({ lead }: { lead: LeadAssignmentFields }) {
  const name = assigneeName(lead);
  if (!name) {
    return (
      <span title="No building picked yet. An admin can assign this lead by hand.">
        <Pill>Unassigned</Pill>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Avatar name={name} size="sm" tone={lead.assignedToMe ? "ok" : "acc"} />
      <span className="text-[13px]">{name.trim().split(/\s+/)[0]}</span>
      {lead.assignedToMe ? <Pill tone="ok">You</Pill> : null}
    </span>
  );
}

export function TourLine({ lead }: { lead: LeadAssignmentFields }) {
  const label = tourLabel(lead);
  if (!label) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <CalendarClock className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}

/** Shown on an unassigned lead: what happens next, and who can fix it. */
export function UnassignedHint({ lead, isAdmin }: { lead: LeadAssignmentFields; isAdmin?: boolean }) {
  if (!isUnassigned(lead)) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Not assigned yet: the caller hasn&apos;t picked a building. It goes to that building&apos;s asset manager once
      they do{isAdmin ? ", or assign it by hand below." : ", or an admin can assign it by hand."}
    </p>
  );
}

const UNASSIGNED = "unassigned";

/**
 * Admin only: assign the lead by hand (Sarah never changes a manual assignment) or set it back to
 * Unassigned (then picking a building routes it again). The server (leads.assignLead) re-checks.
 */
export function AssignLeadControl({ lead, conversationId }: { lead: LeadAssignmentFields; conversationId: string }) {
  const members = useQuery(api.leads.assignableMembers);
  const assignLead = useMutation(api.leads.assignLead);
  const current = lead.assignedUser?.userId ?? UNASSIGNED;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = draft ?? current;

  const save = async () => {
    // null, "" and the sentinel all mean Unassigned.
    const picked = !value || value === UNASSIGNED ? null : value;
    if (picked && !members?.some((m) => m.userId === picked)) {
      const msg = "Choose who should own this lead, or Unassigned.";
      setError(msg);
      toast.error(msg);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const r = await assignLead({ conversationId, userId: picked });
      setDraft(null);
      toast.success(r.assigneeName ? `Lead assigned to ${r.assigneeName}` : "Lead set back to Unassigned");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      className="space-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void save();
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="text-xs text-muted-foreground">Assign lead</span>
        <Select
          value={value}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          disabled={busy || members === undefined}
          aria-label="Assign lead to"
          aria-invalid={!!error}
          className={cx("sm:w-64", error && "!border-danger-ink")}
        >
          <option value={UNASSIGNED}>Unassigned</option>
          {/* A current owner who is no longer on the list (left the team) still shows by name. */}
          {lead.assignedUser && members && !members.some((m) => m.userId === lead.assignedUser?.userId) ? (
            <option value={lead.assignedUser.userId}>{lead.assignedUser.name}</option>
          ) : null}
          {(members ?? []).map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </Select>
        <Btn type="submit" sm variant="pri" disabled={busy || value === current}>
          Save
        </Btn>
      </div>
      {error ? <p className="text-xs text-danger-ink">{error}</p> : null}
      <p className="text-[11.5px] text-muted-foreground">
        Sarah never changes a lead you assign by hand. Unassigned leads go to the building&apos;s asset manager once
        the caller picks one.
      </p>
    </form>
  );
}
