"use client";

import type { FunctionReturnType } from "convex/server";
import { AlertTriangle, Trash2 } from "lucide-react";
import type { api } from "@/convex/_generated/api";
import { MemberDetails, APP_ROLE_OPTIONS } from "@/components/team/member-details";
import { Btn, Drawer, DrawerSection, Pill } from "@/components/ui";

type Member = NonNullable<FunctionReturnType<typeof api.team.overview>>["members"][number];

// team.overview's tourStatus: whether Sarah can book this person right now, or what is stopping her.
export const TOUR_STATUS = {
  bookable: { label: "Bookable for tours", text: "text-success-ink", dot: "bg-success-ink" },
  off: { label: "Not taking tours", text: "text-muted-foreground", dot: "bg-faint" },
  no_calendar: { label: "Taking tours, but Google Calendar is not connected", text: "text-warning-ink", dot: "bg-warning-ink" },
  reconnect: { label: "Taking tours, but needs to reconnect Google Calendar", text: "text-warning-ink", dot: "bg-warning-ink" },
  no_time_zone: { label: "Taking tours, waiting on the team time zone", text: "text-warning-ink", dot: "bg-warning-ink" },
} as const;

/**
 * Everything about one person that used to sit inline on their row: contact, role, notify-by,
 * out of office, tour status, and removal. The row on the Team page stays compact (avatar, name,
 * role, Tours switch) and opens this. Every action is still enforced server-side.
 */
export function MemberDrawer({
  member,
  isAdmin,
  canSetUnavailable,
  busy,
  onClose,
  onRemove,
}: {
  /** The person to show; null keeps the drawer closed. */
  member: Member | null;
  isAdmin: boolean;
  canSetUnavailable: boolean;
  busy: boolean;
  onClose: () => void;
  onRemove: (member: Member) => void;
}) {
  const status = member ? TOUR_STATUS[member.tourStatus] : null;
  const roleOpt = member ? APP_ROLE_OPTIONS.find((o) => o.value === member.appRole) : null;
  const description = member ? member.skill || roleOpt?.blurb || "" : "";

  return (
    <Drawer open={member !== null} onClose={onClose} eyebrow="Team member" title={member?.name ?? "Team member"} width={480}>
      {member && status ? (
        <>
          <div className="space-y-1">
            <p className="break-words text-[13px] text-muted-foreground">{member.email}</p>
            {description ? <p className="text-[12.5px] text-muted-foreground">{description}</p> : null}
            <p className={`flex items-center gap-1.5 text-xs ${status.text}`}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.dot}`} />
              {status.label}
            </p>
            {member.appRole === "technician" && !member.phone && (isAdmin || member.isSelf) ? (
              <p className="pt-1">
                <Pill tone="warn">
                  <AlertTriangle className="h-3 w-3" />
                  Add a phone number so they can get job texts later
                </Pill>
              </p>
            ) : null}
          </div>

          <DrawerSection title="Role and contact">
            {/* Keyed so one person's unsaved drafts never carry over to the next person opened. */}
            <MemberDetails key={member.membershipId} member={member} isAdmin={isAdmin} canSetUnavailable={canSetUnavailable} />
          </DrawerSection>

          {isAdmin && !member.isSelf ? (
            <DrawerSection title="Remove from team">
              <div className="flex flex-wrap items-center gap-3">
                <Btn variant="dng" onClick={() => onRemove(member)} disabled={busy || member.unitsOwned > 0}>
                  <Trash2 className="h-4 w-4" />
                  Remove {member.name}
                </Btn>
                {member.unitsOwned > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    Reassign their {member.unitsOwned} unit{member.unitsOwned === 1 ? "" : "s"} first.
                  </span>
                ) : null}
              </div>
            </DrawerSection>
          ) : null}
        </>
      ) : null}
    </Drawer>
  );
}
