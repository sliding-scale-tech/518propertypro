"use client";

import type { FunctionReturnType } from "convex/server";
import { AlertTriangle, Moon, Trash2 } from "lucide-react";
import Link from "next/link";
import type { api } from "@/convex/_generated/api";
import { useState } from "react";
import { MemberDetails, APP_ROLE_OPTIONS, AppRolesBadges } from "@/components/team/member-details";
import { Btn, ConfirmDialog, Drawer, Pill } from "@/components/ui";

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
 * Everything about one person, in sections: header (who, roles, status), then Roles, Contact,
 * Notifications and Out of office (one Save each, see MemberDetails), and a quiet Danger zone with
 * Remove. The row on the Team page stays compact and opens this. Every action is still enforced
 * server-side.
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
  const [confirmRemove, setConfirmRemove] = useState(false);
  const status = member ? TOUR_STATUS[member.tourStatus] : null;
  const roleOpt = member ? APP_ROLE_OPTIONS.find((o) => o.value === member.appRole) : null;
  const description = member ? member.skill || roleOpt?.blurb || "" : "";
  const [now] = useState(() => Date.now());
  const outOfOffice = member !== null && member.unavailableUntil !== null && member.unavailableUntil > now;
  // Only the problems get a line in the header; "Bookable" and "Not taking tours" are not warnings.
  const calendarNote = member && (member.tourStatus === "no_calendar" || member.tourStatus === "reconnect" || member.tourStatus === "no_time_zone") ? status : null;

  return (
    <Drawer
      open={member !== null}
      onClose={() => {
        setConfirmRemove(false);
        onClose();
      }}
      eyebrow="Team member"
      title={member?.name ?? "Team member"}
      width={480}
    >
      {member && status ? (
        <>
          <div className="space-y-2">
            <p className="break-words text-[13px] text-muted-foreground">{member.email}</p>
            {description ? <p className="text-[12.5px] text-muted-foreground">{description}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              <AppRolesBadges appRoles={member.appRoles} />
              {outOfOffice ? (
                <Pill>
                  <Moon className="h-3 w-3" />
                  Out of office until {new Date(member.unavailableUntil!).toLocaleDateString()}
                </Pill>
              ) : (
                <Pill tone={member.tourStatus === "bookable" ? "ok" : calendarNote ? "warn" : "neutral"}>
                  {calendarNote ? "Taking tours" : status.label}
                </Pill>
              )}
            </div>
            {calendarNote ? (
              <p className={`flex items-center gap-1.5 text-xs ${calendarNote.text}`}>
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {calendarNote.label}
              </p>
            ) : null}
            {member.appRoles.includes("asset_manager") && (isAdmin || member.isSelf) ? (
              <p className="text-xs">
                <Link href="/properties" className="text-muted-foreground hover:underline">
                  Owns {member.unitsOwned} unit{member.unitsOwned === 1 ? "" : "s"}
                </Link>
              </p>
            ) : null}
          </div>

          {isAdmin && member.appRoles.includes("technician") ? (
            <Link
              href={`/technicians/${member.userId}`}
              className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-primary px-4 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              View profile
            </Link>
          ) : null}

          {/* Keyed so one person's unsaved drafts never carry over to the next person opened. */}
          <MemberDetails
            key={member.membershipId}
            member={member}
            isAdmin={isAdmin}
            canSetUnavailable={canSetUnavailable}
            showSummary={false}
          />

          {isAdmin && !member.isSelf ? (
            <section className="mt-4 space-y-2 border-t border-border pt-5">
              <h4 className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">Danger zone</h4>
              <div className="flex flex-wrap items-center gap-3">
                <Btn sm variant="dng" onClick={() => setConfirmRemove(true)} disabled={busy || member.unitsOwned > 0}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove from team
                </Btn>
                {member.unitsOwned > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    Reassign their {member.unitsOwned} unit{member.unitsOwned === 1 ? "" : "s"} first.
                  </span>
                ) : null}
              </div>
            </section>
          ) : null}

          <ConfirmDialog
            open={confirmRemove}
            danger
            busy={busy}
            title={`Remove ${member.name}?`}
            message="They lose access to the dashboard straight away. You can invite them again later."
            confirmLabel="Remove from team"
            onCancel={() => setConfirmRemove(false)}
            onConfirm={() => {
              setConfirmRemove(false);
              onRemove(member);
            }}
          />
        </>
      ) : null}
    </Drawer>
  );
}
