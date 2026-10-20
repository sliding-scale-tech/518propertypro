import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { Avatar, Pill } from "@/components/ui";

export type LeadAssignmentFields = {
  assignedUser: { userId: string; name: string } | null;
  assignedToMe: boolean;
  tour: { start: number; timeZone: string; assignedUserId: string; assignedName: string } | null;
};

/** Display name of whoever owns the lead: the assigned user, else the person hosting the tour. */
export function assigneeName(l: LeadAssignmentFields): string | null {
  return l.assignedUser?.name ?? l.tour?.assignedName ?? null;
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
      <span title="No lead assignee is set. An admin can choose one under Team, Lead routing.">
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

/** Shown on an unassigned lead: the one thing that fixes it. */
export function UnassignedHint({ lead }: { lead: LeadAssignmentFields }) {
  if (!isUnassigned(lead)) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Not assigned yet. Choose who receives new leads under{" "}
      <Link href="/team" className="font-medium text-primary underline-offset-2 hover:underline">
        Team, Lead routing
      </Link>
      ; the next lead logged is assigned to them.
    </p>
  );
}
