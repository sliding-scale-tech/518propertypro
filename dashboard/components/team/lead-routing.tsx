"use client";

import { useMutation } from "convex/react";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "@/components/ui/toast";
import { Avatar, Card, Toggle } from "@/components/ui";

type RoutingMember = {
  userId: Id<"users">;
  name: string;
  imageUrl: string | null;
  appRole: string | null;
  appRoles: ReadonlyArray<string>;
  leadAssignee: boolean;
  unmatchedAssignee: boolean;
  tourStatus: "bookable" | "off" | "no_calendar" | "reconnect" | "no_time_zone";
};

// The Lead routing tab. Admin-only (the parent renders it for admins; the mutations enforce it again on the server).
export function LeadRouting({ members }: { members: RoutingMember[] }) {
  const setLead = useMutation(api.team.setLeadAssignee);
  const setUnmatched = useMutation(api.team.setUnmatchedAssignee);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const managers = members.filter((m) => m.appRoles.includes("asset_manager"));
  const leadPicked = managers.filter((m) => m.leadAssignee);
  const unmatchedPicked = managers.filter((m) => m.unmatchedAssignee);

  const flip = async (
    kind: "lead" | "unmatched",
    m: RoutingMember,
    next: boolean,
  ) => {
    const key = `${kind}:${m.userId}`;
    setBusyKey(key);
    try {
      await (kind === "lead" ? setLead : setUnmatched)({ userId: m.userId, value: next });
      toast.success(
        kind === "lead"
          ? next
            ? `${m.name} will receive new leads and tours`
            : `${m.name} no longer receives new leads`
          : next
            ? `${m.name} will receive callbacks from unmatched callers`
            : `${m.name} no longer receives unmatched callbacks`,
      );
    } catch (err) {
      toast.error(err);
    } finally {
      setBusyKey(null);
    }
  };

  const calendarNote = (m: RoutingMember) =>
    m.tourStatus === "no_calendar" ? "No connected calendar" : m.tourStatus === "reconnect" ? "Calendar needs reconnecting" : null;

  if (managers.length === 0) {
    return (
      <Card>
        <p className="py-4 text-center text-sm text-muted-foreground">
          No asset managers on the team yet. Invite one with the Asset manager role, then pick who receives what here.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted-foreground">
        Pick who Sarah sends things to. Only asset managers can be picked; Admins see everything either way.
      </p>

      {leadPicked.length === 0 ? (
        <p role="status" className="flex items-start gap-2 rounded-xl bg-warning-soft px-4 py-2.5 text-sm text-warning-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Nobody receives new leads and tours yet, so new leads stay unassigned.
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <RoutingList
          title="Receives new leads and tours"
          helper="Sarah gives each new lead to the person here with the fewest tours booked this week and a connected calendar."
          members={managers}
          value={(m) => m.leadAssignee}
          busyKey={busyKey}
          kind="lead"
          onChange={(m, next) => void flip("lead", m, next)}
          note={calendarNote}
        />
        <RoutingList
          title="Receives callbacks from unmatched callers"
          helper="When Sarah can't match a caller to a unit, the callback goes to someone here."
          members={managers}
          value={(m) => m.unmatchedAssignee}
          busyKey={busyKey}
          kind="unmatched"
          onChange={(m, next) => void flip("unmatched", m, next)}
          note={() => null}
          emptyNote={
            unmatchedPicked.length === 0
              ? "Nobody picked, so these callbacks go to the lead receivers or the maintenance lead."
              : null
          }
        />
      </div>
    </div>
  );
}

function RoutingList({
  title,
  helper,
  members,
  value,
  busyKey,
  kind,
  onChange,
  note,
  emptyNote,
}: {
  title: string;
  helper: string;
  members: RoutingMember[];
  value: (m: RoutingMember) => boolean;
  busyKey: string | null;
  kind: "lead" | "unmatched";
  onChange: (m: RoutingMember, next: boolean) => void;
  note: (m: RoutingMember) => string | null;
  emptyNote?: string | null;
}) {
  return (
    <Card>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <p className="mb-3.5 mt-1 text-[12.5px] text-muted-foreground">{helper}</p>
      <ul className="space-y-2">
        {members.map((m) => {
          const flag = note(m);
          return (
            <li
              key={m.userId}
              className="flex items-center gap-3 rounded-2xl border border-border px-3.5 py-2.5"
            >
              <Avatar name={m.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.name}</p>
                {flag ? <p className="text-xs text-warning-ink">{flag}</p> : null}
              </div>
              <Toggle
                label={`${title}: ${m.name}`}
                checked={value(m)}
                disabled={busyKey === `${kind}:${m.userId}`}
                onChange={(next) => onChange(m, next)}
              />
            </li>
          );
        })}
      </ul>
      {emptyNote ? <p className="mt-3 text-xs text-muted-foreground">{emptyNote}</p> : null}
    </Card>
  );
}
