"use client";

import { useMutation, useQuery } from "convex/react";
import { UserPlus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { errorMessage, useToast } from "@/components/toast";
import { MemberDrawer } from "@/components/team/member-drawer";
import { LeadRouting } from "@/components/team/lead-routing";
import { MembersList } from "@/components/team/members-list";
import { AuditTab } from "@/components/team/audit-tab";
import { InviteDialog } from "@/components/team/invite-panel";
import { PendingInvites } from "@/components/team/pending-invites";
import { TeamSettings } from "@/components/team/team-settings";
import { parseTeamTab, teamTabHref, visibleTeamTabs, type TeamTab } from "@/components/team/team-tabs";
import { Btn, Card, PageHeader, Seg } from "@/components/ui";

export default function TeamPage() {
  // The tab, and the member list's search, role filter, sort and page, live in the URL (useSearchParams).
  return (
    <Suspense fallback={null}>
      <TeamPageInner />
    </Suspense>
  );
}

function TeamPageInner() {
  /* A live query now that the roster is rows in this database rather than in Clerk — the page
     updates itself the moment someone accepts an invite, with nothing to refetch by hand. */
  const data = useQuery(api.team.overview);
  const removeMember = useMutation(api.team.removeMember);
  const setTakingTours = useMutation(api.tours.setTakingTours);
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();

  const [busy, setBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  // Which member row is open in the side drawer (by membership, so it follows live updates).
  const [openId, setOpenId] = useState<string | null>(null);

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
  // ?tab=audit still works (the old /audit redirects here); a tab the viewer may not use falls back to Members.
  const activeTab = parseTeamTab(params.get("tab"), data.isAdmin);
  const setTab = (next: TeamTab) => {
    if (next !== activeTab) router.replace(teamTabHref(next));
  };

  return (
    <div className="space-y-5 pb-10">
      <Header
        isAdmin={data.isAdmin}
        actions={
          data.isAdmin ? (
            <Btn variant="pri" onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4" />
              Invite member
            </Btn>
          ) : null
        }
      />

      <Seg<TeamTab> label="Team sections" value={activeTab} onChange={setTab} options={visibleTeamTabs(data.isAdmin)} />

      {activeTab === "members" ? (
        <>
          {data.isAdmin ? <PendingInvites invitations={data.invitations} /> : null}

          <MembersList
            members={data.members}
            isAdmin={data.isAdmin}
            busy={busy}
            onOpen={setOpenId}
            onToggleTours={(member) =>
              void run(
                () => setTakingTours({ userId: member.userId, takingTours: !member.takingTours }),
                member.takingTours
                  ? `${member.isSelf ? "You are" : `${member.name} is`} no longer taking tours`
                  : `${member.isSelf ? "You are" : `${member.name} is`} taking tours again`,
              )
            }
          />
        </>
      ) : null}

      {activeTab === "routing" ? <LeadRouting members={data.members} /> : null}

      {activeTab === "settings" ? <TeamSettings orgName={data.orgName} isAdmin={data.isAdmin} /> : null}

      {activeTab === "audit" ? <AuditTab /> : null}

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

      {data.isAdmin ? <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} /> : null}
    </div>
  );
}

function Header({ isAdmin, actions }: { isAdmin?: boolean; actions?: ReactNode }) {
  return (
    <PageHeader
      title="Team"
      subtitle={
        isAdmin === false
          ? "See who is on the team. Only an Admin can invite or remove people."
          : "Who is on the team, what they can do, and who receives new leads."
      }
      actions={actions}
    />
  );
}
