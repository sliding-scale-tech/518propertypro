"use client";

import { useMutation } from "convex/react";
import { AlertTriangle, CalendarDays } from "lucide-react";
import { useState } from "react";
import { TourStaffSection } from "@/components/settings/tour-staff-section";
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

/**
 * The Lead routing tab, in order: Tour staff (per team), Backup tour staff (memberships.leadAssignee),
 * Callbacks from unmatched callers. Leads themselves are not routed here (B41): a new lead goes to the
 * asset manager of the building the caller picks, or stays Unassigned on the Leads page for an admin.
 * Admin-only (the parent renders it for admins; the mutations enforce it again on the server).
 */
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
            ? `${m.name} is now backup tour staff`
            : `${m.name} is no longer backup tour staff`
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

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted-foreground">
        Pick who Sarah sends tours and callbacks to: the tour staff for each team&apos;s buildings, the backup tour
        staff for callers who haven&apos;t picked a building, and who calls back callers she can&apos;t match. New leads
        go to the asset manager of the building the caller picks; until they pick one, a lead stays Unassigned on the
        Leads page for an admin to assign. Admins see everything either way.
      </p>

      <Card className="!p-0">
        <div className="px-[22px] py-5">
          <div className="mb-3">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-muted-foreground">
              <CalendarDays />
              Tour staff
            </h3>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Who gives tours for each team&apos;s buildings. Once a caller picks a building, Sarah offers times only
              from that team&apos;s list: a time is open if anyone on it is free, and the tour goes to whoever is. Each
              person&apos;s tour hours, days off and out-of-office still apply. If no one on the list can be booked (no
              calendar connected, not taking tours, or out of office), Sarah takes the caller&apos;s preferred time for
              the team to confirm.
            </p>
          </div>
          <TourStaffSection />
        </div>
      </Card>

      {managers.length === 0 ? (
        <Card>
          <p className="py-4 text-center text-sm text-muted-foreground">
            No asset managers on the team yet. Invite one with the Asset manager role, then pick the backup tour staff
            and who calls back unmatched callers here.
          </p>
        </Card>
      ) : null}

      {managers.length > 0 && leadPicked.length === 0 ? (
        <p role="status" className="flex items-start gap-2 rounded-xl bg-warning-soft px-4 py-2.5 text-sm text-warning-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Nobody is backup tour staff yet, so a caller who hasn&apos;t picked a building can&apos;t be booked; Sarah takes
          their preferred time for the team to confirm instead.
        </p>
      ) : null}

      {managers.length > 0 ? (
      <div className="grid gap-4 md:grid-cols-2">
        <RoutingList
          title="Backup tour staff"
          helper="Gives tours when the caller hasn't picked a building, and backs up unmatched-caller callbacks. Sarah books whoever here is free, has the fewest tours this week and a connected calendar. Only asset managers can be picked."
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
              ? "Nobody picked, so these callbacks go to the backup tour staff or the maintenance lead."
              : null
          }
        />
      </div>
      ) : null}
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
