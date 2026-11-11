"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import { Globe, Mail, RefreshCw, Shield, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { errorMessage, useToast } from "@/components/toast";
import { AppRoleBadge } from "@/components/team/member-details";
import { MemberDrawer } from "@/components/team/member-drawer";
import { LeadRouting } from "@/components/team/lead-routing";
import { AuditTab } from "@/components/team/audit-tab";
import { Avatar, Btn, Card, CardHead, Chips, Input, PageHeader, Seg, Select, Toggle } from "@/components/ui";
import {
  InvitePanel,
  ROLE_FILTERS,
  inviteTypeLabel,
  matchesRoleFilter,
  parseRoleFilter,
  type RoleFilter,
} from "@/components/team/invite-panel";

export default function TeamPage() {
  /* A live query now that the roster is rows in this database rather than in Clerk — the page
     updates itself the moment someone accepts an invite, with nothing to refetch by hand. */
  const data = useQuery(api.team.overview);
  // Same underlying query the Calendar page uses for tour settings — timeZone is the one field
  // of it this page needs.
  const availability = useQuery(api.tours.availabilitySettings);
  const revokeInvite = useMutation(api.team.revokeInvite);
  const resendInvite = useAction(api.team.invite);
  const removeMember = useMutation(api.team.removeMember);
  const rename = useMutation(api.team.rename);
  const setTakingTours = useMutation(api.tours.setTakingTours);
  const toast = useToast();

  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Which member row is open in the side drawer (by membership, so it follows live updates).
  const [openId, setOpenId] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>(() => {
    if (typeof window === "undefined") return "all";
    return parseRoleFilter(new URLSearchParams(window.location.search).get("role"));
  });
  // ?tab=audit deep link (the old /audit redirects here). Read from window to avoid a Suspense boundary.
  const [tab, setTabState] = useState<"members" | "audit">(() => {
    if (typeof window === "undefined") return "members";
    return new URLSearchParams(window.location.search).get("tab") === "audit" ? "audit" : "members";
  });
  const setTab = (next: "members" | "audit") => {
    setTabState(next);
    window.history.replaceState(null, "", next === "audit" ? "/team?tab=audit" : "/team");
  };

  // `name` starts null and only takes the stored value until the admin edits it, so a live
  // update from someone else cannot yank the text out from under them mid-type.
  const nameValue = name ?? data?.orgName ?? "";

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
    } catch (err) {
      toast(errorMessage(err, "That didn't work."), "error");
    } finally {
      setBusy(false);
    }
  };

  if (data === null) {
    return (
      <div className="pb-10">
        <Header />
        <Card>
          <p className="text-sm text-muted-foreground">You are not on a team yet.</p>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="pb-10">
        <Header />
        <Card>
          <p className="py-6 text-center text-sm text-muted-foreground">Loading your team…</p>
        </Card>
      </div>
    );
  }

  const viewer = data.members.find((m) => m.isSelf);
  const openMember = data.members.find((m) => m.membershipId === openId) ?? null;
  const activeTab = data.isAdmin ? tab : "members";

  return (
    <div className="space-y-5 pb-10">
      <Header isAdmin={data.isAdmin} />

      {data.isAdmin ? (
        <Seg
          label="Team sections"
          value={activeTab}
          onChange={setTab}
          options={[
            { value: "members", label: "Members" },
            { value: "audit", label: "Audit log" },
          ]}
        />
      ) : null}

      {activeTab === "audit" ? (
        <AuditTab />
      ) : (
        <>
          <Card>
            <CardHead title="Team name" icon={<Users />} />
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                value={nameValue}
                onChange={(event) => setName(event.target.value)}
                disabled={!data.isAdmin}
                aria-label="Team name"
              />
              {data.isAdmin ? (
                <Btn
                  variant="pri"
                  onClick={() => void run(() => rename({ name: nameValue }), "Team renamed")}
                  disabled={busy || !nameValue.trim() || nameValue.trim() === data.orgName}
                >
                  Save
                </Btn>
              ) : null}
            </div>
            {!data.isAdmin ? (
              <p className="mt-2 text-xs text-muted-foreground">Only an Admin can rename the team.</p>
            ) : null}
          </Card>

          <TimeZoneSection isAdmin={data.isAdmin} timeZone={availability?.timeZone ?? null} />

          {data.isAdmin ? <LeadRouting members={data.members} /> : null}

          <InvitePanel />

          <Card>
            <CardHead
              title={
                <>
                  Members <span className="text-muted-foreground">({data.members.length})</span>
                </>
              }
              icon={<Shield />}
              hint={`The Tours switch decides whether Sarah books tours for someone. ${
                data.isAdmin ? "You can switch anyone's." : "You can switch your own; an Admin can switch anyone's."
              }`}
            />

            <div className="mb-4">
              <Chips
                label="Filter by role"
                value={roleFilter}
                onChange={(next) => {
                  setRoleFilter(next);
                  const params = new URLSearchParams(window.location.search);
                  if (next === "all") params.delete("role");
                  else params.set("role", next);
                  const qs = params.toString();
                  window.history.replaceState(null, "", qs ? `/team?${qs}` : "/team");
                }}
                options={ROLE_FILTERS.map((f) => ({
                  value: f.value,
                  label: `${f.label} (${data.members.filter((m) => matchesRoleFilter(f.value, m)).length})`,
                })).filter((o) => o.value !== "none" || roleFilter === "none" || data.members.some((m) => m.appRole === null))}
              />
            </div>

            <div className="space-y-2">
              {data.members.filter((m) => matchesRoleFilter(roleFilter, m)).length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  No one with this role yet.
                </p>
              ) : null}
              {data.members
                .filter((m) => matchesRoleFilter(roleFilter, m))
                .map((member) => {
                  const canSwitch = data.isAdmin || member.isSelf;
                  return (
                    <motion.div
                      key={member.membershipId}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-center rounded-2xl border border-border transition-colors hover:bg-muted/50"
                    >
                      {/* The whole row opens the drawer. The Tours switch is a sibling, not a child, so
                          it works on its own without opening it. */}
                      <button
                        type="button"
                        onClick={() => setOpenId(member.membershipId)}
                        aria-label={`Open details for ${member.name}`}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-4 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                      >
                        {member.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={member.imageUrl} alt="" className="h-[30px] w-[30px] shrink-0 rounded-full object-cover" />
                        ) : (
                          <Avatar
                            name={member.name}
                            tone={
                              member.appRole === "admin"
                                ? "warn"
                                : member.appRole === "technician"
                                  ? "ok"
                                  : member.appRole === "accountant"
                                    ? "vio"
                                    : "acc"
                            }
                          />
                        )}
                        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                          <span className="truncate">{member.name}</span>
                          {member.isSelf ? <span className="text-xs font-normal text-muted-foreground">you</span> : null}
                          <AppRoleBadge appRole={member.appRole} />
                        </span>
                      </button>
                      <div
                        className="flex shrink-0 items-center gap-2 py-3 pr-4"
                        title={canSwitch ? undefined : "Only an Admin can change a teammate's tours"}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-xs font-medium text-muted-foreground">Tours</span>
                        <Toggle
                          label={`Tours for ${member.name}`}
                          checked={member.takingTours}
                          disabled={busy || !canSwitch}
                          onChange={() =>
                            void run(
                              () => setTakingTours({ userId: member.userId, takingTours: !member.takingTours }),
                              member.takingTours
                                ? `${member.isSelf ? "You are" : `${member.name} is`} no longer taking tours`
                                : `${member.isSelf ? "You are" : `${member.name} is`} taking tours again`,
                            )
                          }
                        />
                      </div>
                    </motion.div>
                  );
                })}
            </div>
          </Card>

          <MemberDrawer
            member={openMember}
            isAdmin={data.isAdmin}
            canSetUnavailable={
              openMember !== null &&
              (data.isAdmin ||
                openMember.isSelf ||
                (viewer?.jobRoles ?? []).some((r) => r === "executive" || r === "maintenance_lead"))
            }
            busy={busy}
            onClose={() => setOpenId(null)}
            onRemove={(member) => {
              setOpenId(null);
              void run(() => removeMember({ membershipId: member.membershipId }), `${member.name} removed from the team`);
            }}
          />

          {data.isAdmin ? (
            <Card>
              <CardHead
                title={
                  <>
                    Pending invites <span className="text-muted-foreground">({data.invitations.length})</span>
                  </>
                }
                icon={<Mail />}
              />

              {data.invitations.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  Nobody is waiting on an invite.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.invitations.map((invitation) => (
                    <div
                      key={invitation.id}
                      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border px-4 py-3.5"
                    >
                      <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning-ink">
                        <Mail className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{invitation.email}</p>
                        <p className="text-xs text-muted-foreground">
                          Invited {new Date(invitation.createdAt).toLocaleDateString()} ·{" "}
                          {inviteTypeLabel(invitation)} · expires {new Date(invitation.expiresAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Btn
                        sm
                        aria-label={`Resend invite to ${invitation.email}`}
                        disabled={busy || invitation.appRole === null}
                        onClick={() =>
                          void run(
                            () =>
                              resendInvite({
                                email: invitation.email,
                                appRole: invitation.appRole ?? undefined,
                                phone: invitation.phone ?? undefined,
                                fullName: invitation.fullName ?? undefined,
                              }),
                            `Invite re-sent to ${invitation.email}`,
                          )
                        }
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Resend
                      </Btn>
                      <Btn
                        sm
                        aria-label={`Revoke invite for ${invitation.email}`}
                        onClick={() => void run(() => revokeInvite({ inviteId: invitation.id }), "Invite revoked")}
                        disabled={busy}
                      >
                        <X className="h-3.5 w-3.5" />
                        Revoke
                      </Btn>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ) : null}
        </>
      )}
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
      toast(errorMessage(err, "Could not save the time zone."), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHead title="Team time zone" icon={<Globe />} />

      {!timeZone ? (
        <p className="mb-4 flex items-start gap-2 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-ink">
          <span>
            Not set yet, so Sarah cannot book tours — she takes down a preferred time for the team to confirm
            instead.
            {isAdmin ? "" : " Ask an Admin to set it."}
          </span>
        </p>
      ) : null}

      {isAdmin ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Select value={value} onChange={(e) => setDraft(e.target.value)} aria-label="Team time zone" className="flex-1">
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
          <Btn variant="pri" onClick={() => void save()} disabled={busy || value === timeZone}>
            Save
          </Btn>
        </div>
      ) : timeZone ? (
        <p className="text-sm">{timeZone.replace(/_/g, " ")}</p>
      ) : null}

      <p className="mt-3 text-xs text-muted-foreground">
        Where the property is. Everyone&apos;s tour hours and every booked tour use this zone.
        {isAdmin ? "" : " Only an Admin can change it."}
      </p>
    </Card>
  );
}

function Header({ isAdmin }: { isAdmin?: boolean }) {
  return (
    <PageHeader
      title="Team"
      subtitle={
        <>
          Everyone here shares one dashboard — the same agent, property, knowledge base, screening questions and
          leads.{" "}
          {isAdmin === false
            ? "You can see who is on the team; only an Admin can invite or remove people."
            : "Inviting and removing people is Admin-only."}
        </>
      }
    />
  );
}
