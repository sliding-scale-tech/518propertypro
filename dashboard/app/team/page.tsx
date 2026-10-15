"use client";

import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import { Globe, Mail, Shield, Trash2, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useToast } from "@/components/toast";
import { MemberDetails } from "@/components/team/member-details";
import {
  InvitePanel,
  ROLE_FILTERS,
  inviteTypeLabel,
  matchesRoleFilter,
  type RoleFilter,
} from "@/components/team/invite-panel";

const inputClass =
  "h-11 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/20";

// team.overview's tourStatus: whether Sarah can book this person right now, or what is stopping her.
const TOUR_STATUS = {
  bookable: { label: "Bookable for tours", text: "text-emerald-600", dot: "bg-emerald-500" },
  off: { label: "Not taking tours", text: "text-muted-foreground", dot: "bg-muted-foreground" },
  no_calendar: { label: "Taking tours, but Google Calendar is not connected", text: "text-amber-600", dot: "bg-amber-500" },
  reconnect: { label: "Taking tours, but needs to reconnect Google Calendar", text: "text-amber-600", dot: "bg-amber-500" },
  no_time_zone: { label: "Taking tours, waiting on the team time zone", text: "text-amber-600", dot: "bg-amber-500" },
} as const;

export default function TeamPage() {
  /* A live query now that the roster is rows in this database rather than in Clerk — the page
     updates itself the moment someone accepts an invite, with nothing to refetch by hand. */
  const data = useQuery(api.team.overview);
  // Same underlying query the Calendar page uses for tour settings — timeZone is the one field
  // of it this page needs.
  const availability = useQuery(api.tours.availabilitySettings);
  const revokeInvite = useMutation(api.team.revokeInvite);
  const removeMember = useMutation(api.team.removeMember);
  const rename = useMutation(api.team.rename);
  const setTakingTours = useMutation(api.tours.setTakingTours);
  const toast = useToast();

  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  // `name` starts null and only takes the stored value until the admin edits it, so a live
  // update from someone else cannot yank the text out from under them mid-type.
  const nameValue = name ?? data?.orgName ?? "";

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
    } catch (err) {
      toast(err instanceof Error ? err.message : "That didn't work.", "error");
    } finally {
      setBusy(false);
    }
  };

  if (data === null) {
    return (
      <div className="space-y-7 pb-10">
        <Header />
        <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">
          You are not on a team yet.
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-7 pb-10">
        <Header />
        <p className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground shadow-sm">
          Loading your team…
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-7 pb-10">
      <Header isAdmin={data.isAdmin} />

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
        <div className="mb-5 flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">Team name</h2>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={nameValue}
            onChange={(event) => setName(event.target.value)}
            disabled={!data.isAdmin}
            className={`${inputClass} disabled:opacity-60`}
          />
          {data.isAdmin ? (
            <button
              onClick={() => void run(() => rename({ name: nameValue }), "Team renamed")}
              disabled={busy || !nameValue.trim() || nameValue.trim() === data.orgName}
              className="h-11 shrink-0 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              Save
            </button>
          ) : null}
        </div>
        {!data.isAdmin ? (
          <p className="mt-2 text-xs text-muted-foreground">Only an admin can rename the team.</p>
        ) : null}
      </section>

      <TimeZoneSection isAdmin={data.isAdmin} timeZone={availability?.timeZone ?? null} />

      <InvitePanel />

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
        <div className="mb-5 flex items-center gap-2">
          <Shield className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">
            Members <span className="text-muted-foreground">({data.members.length})</span>
          </h2>
        </div>
        <p className="-mt-3 mb-4 text-xs text-muted-foreground">
          The Tours switch decides whether Sarah books tours for someone.{" "}
          {data.isAdmin ? "You can switch anyone's." : "You can switch your own; an admin can switch anyone's."}
        </p>

        <div className="mb-4 flex flex-wrap gap-2">
          {ROLE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setRoleFilter(f.value)}
              aria-pressed={roleFilter === f.value}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                roleFilter === f.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input hover:bg-accent"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {data.members.filter((m) => matchesRoleFilter(roleFilter, m)).map((member) => {
            const canSwitch = data.isAdmin || member.isSelf;
            const status = TOUR_STATUS[member.tourStatus];
            const viewer = data.members.find((m) => m.isSelf);
            const canSetUnavailable =
              data.isAdmin ||
              member.isSelf ||
              (viewer?.jobRoles ?? []).some((r) => r === "executive" || r === "maintenance_lead");
            return (
            <motion.div
              key={member.membershipId}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-border px-4 py-3.5"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-50 text-sm font-semibold text-blue-600">
                {member.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={member.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  (member.name[0] ?? "?").toUpperCase()
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {member.name}
                  {member.isSelf ? (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">you</span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                <p className={`mt-1 flex items-center gap-1.5 text-xs ${status.text}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                  {status.label}
                </p>
              </div>
              <label
                className={`flex shrink-0 items-center gap-2 ${canSwitch ? "cursor-pointer" : "cursor-not-allowed"}`}
                title={canSwitch ? undefined : "Only an admin can change a teammate's tours"}
              >
                <span className="text-xs font-medium text-muted-foreground">Tours</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={member.takingTours}
                  aria-label={`Tours for ${member.name}`}
                  disabled={busy || !canSwitch}
                  onClick={() =>
                    void run(
                      () => setTakingTours({ userId: member.userId, takingTours: !member.takingTours }),
                      member.takingTours
                        ? `${member.isSelf ? "You are" : `${member.name} is`} no longer taking tours`
                        : `${member.isSelf ? "You are" : `${member.name} is`} taking tours again`,
                    )
                  }
                  className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors disabled:opacity-50 ${
                    member.takingTours ? "bg-primary" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                      member.takingTours ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </label>
              {data.isAdmin && !member.isSelf ? (
                <span
                  title={
                    member.unitsOwned > 0
                      ? `Reassign their ${member.unitsOwned} unit${member.unitsOwned === 1 ? "" : "s"} first.`
                      : undefined
                  }
                  className="shrink-0"
                >
                  <button
                    onClick={() =>
                      void run(
                        () => removeMember({ membershipId: member.membershipId }),
                        `${member.name} removed from the team`,
                      )
                    }
                    disabled={busy || member.unitsOwned > 0}
                    aria-label={`Remove ${member.name}`}
                    className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </span>
              ) : (
                <span className="w-8 shrink-0" />
              )}
              <MemberDetails
                member={member}
                isAdmin={data.isAdmin}
                canSetUnavailable={canSetUnavailable}
              />
            </motion.div>
            );
          })}
        </div>
      </section>

      {data.isAdmin ? (
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
          <div className="mb-5 flex items-center gap-2">
            <Mail className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-base font-semibold">
              Pending invites{" "}
              <span className="text-muted-foreground">({data.invitations.length})</span>
            </h2>
          </div>

          {data.invitations.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Nobody is waiting on an invite.
            </p>
          ) : (
            <div className="space-y-2">
              {data.invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex items-center gap-4 rounded-xl border border-border px-4 py-3.5"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                    <Mail className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{invitation.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Invited {new Date(invitation.createdAt).toLocaleDateString()} ·{" "}
                      {inviteTypeLabel(invitation)}
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      void run(
                        () => revokeInvite({ inviteId: invitation.id }),
                        "Invite revoked",
                      )
                    }
                    disabled={busy}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
                  >
                    <X className="h-3.5 w-3.5" />
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

/**
 * Where the property is. Every member's tour hours, every day off, and every booked tour are
 * interpreted in this one zone — it is the team's, not any one person's, which is why it lives
 * here rather than on each person's own Calendar page. Sarah refuses to book anything at all
 * until it is set (see convex/tours.ts's loadContext), so setting it is the first real step in
 * turning tour booking on for a team.
 */
function TimeZoneSection({ isAdmin, timeZone }: { isAdmin: boolean; timeZone: string | null }) {
  const setTimeZone = useMutation(api.tours.setTimeZone);
  const toast = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const zones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
  // Suggest the admin's own zone the first time, but never save it without them pressing Save.
  const value = draft ?? timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const save = async () => {
    setBusy(true);
    try {
      await setTimeZone({ timeZone: value });
      setDraft(null);
      toast("Team time zone saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save the time zone.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
      <div className="mb-5 flex items-center gap-2">
        <Globe className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-base font-semibold">Team time zone</h2>
      </div>

      {!timeZone ? (
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <span>
            Not set yet, so Sarah cannot book tours — she takes down a preferred time for the team to confirm
            instead.
            {isAdmin ? "" : " Ask a team admin to set it."}
          </span>
        </p>
      ) : null}

      {isAdmin ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          <select
            value={value}
            onChange={(e) => setDraft(e.target.value)}
            className={`${inputClass} h-11 flex-1`}
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <button
            onClick={() => void save()}
            disabled={busy || value === timeZone}
            className="h-11 shrink-0 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      ) : timeZone ? (
        <p className="text-sm">{timeZone.replace(/_/g, " ")}</p>
      ) : null}

      <p className="mt-3 text-xs text-muted-foreground">
        Where the property is. Everyone&apos;s tour hours and every booked tour use this zone.
        {isAdmin ? "" : " Only an admin can change it."}
      </p>
    </section>
  );
}

function Header({ isAdmin }: { isAdmin?: boolean }) {
  return (
    <header>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Team</h1>
      <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
        Everyone here shares one dashboard — the same agent, property, knowledge base, screening
        questions and leads.{" "}
        {isAdmin === false
          ? "You can see who is on the team; only an admin can invite or remove people."
          : "Inviting and removing people is admin-only."}
      </p>
    </header>
  );
}
