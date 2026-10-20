"use client";

import { useMutation } from "convex/react";
import { AlertTriangle, Route } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "@/components/ui/toast";
import { Avatar, Card, CardHead, Toggle } from "@/components/ui";

type RoutingMember = {
  userId: Id<"users">;
  name: string;
  imageUrl: string | null;
  appRole: string | null;
  leadAssignee: boolean;
  unmatchedAssignee: boolean;
  tourStatus: "bookable" | "off" | "no_calendar" | "reconnect" | "no_time_zone";
};

// Admin-only (the parent renders it for admins; the mutations enforce it again on the server).
export function LeadRouting({ members }: { members: RoutingMember[] }) {
  const setLead = useMutation(api.team.setLeadAssignee);
  const setUnmatched = useMutation(api.team.setUnmatchedAssignee);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const managers = members.filter((m) => m.appRole === "asset_manager");
  const hasCalendar = (m: RoutingMember) => m.tourStatus !== "no_calendar" && m.tourStatus !== "reconnect";
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

  const warnings: string[] = [];
  if (leadPicked.length === 0) warnings.push("Nobody receives new leads and tours yet, so new leads stay unassigned.");
  else if (!leadPicked.some(hasCalendar))
    warnings.push("None of the people receiving new leads has a connected Google Calendar, so Sarah cannot book their tours.");
  if (unmatchedPicked.length === 0)
    warnings.push("Nobody is picked for unmatched callers, so those callbacks fall back to the lead receivers or the maintenance lead.");

  return (
    <Card>
      <CardHead
        title="Lead routing"
        icon={<Route />}
        hint="Only asset managers can be picked. Admins see everything either way."
      />

      {warnings.length > 0 ? (
        <div
          role="status"
          className="mb-4 flex items-start gap-2 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-ink"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="space-y-1">
            {warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        </div>
      ) : null}

      {managers.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No asset managers on the team yet. Invite one with the Asset manager role.
        </p>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          <RoutingList
            title="Receives new leads and tours"
            helper="Sarah assigns each new lead to the person here with the fewest tours booked this week and a connected calendar."
            members={managers}
            value={(m) => m.leadAssignee}
            busyKey={busyKey}
            kind="lead"
            onChange={(m, next) => void flip("lead", m, next)}
            note={(m) => (hasCalendar(m) ? null : "No connected calendar")}
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
          />
        </div>
      )}
    </Card>
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
}: {
  title: string;
  helper: string;
  members: RoutingMember[];
  value: (m: RoutingMember) => boolean;
  busyKey: string | null;
  kind: "lead" | "unmatched";
  onChange: (m: RoutingMember, next: boolean) => void;
  note: (m: RoutingMember) => string | null;
}) {
  return (
    <div>
      <h4 className="text-[13.5px] font-semibold">{title}</h4>
      <p className="mb-3 mt-1 text-xs text-muted-foreground">{helper}</p>
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
    </div>
  );
}
