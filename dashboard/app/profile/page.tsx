"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { RequireView } from "@/components/require-view";
import { errorMessage, useToast } from "@/components/toast";
import { MemberDetails } from "@/components/team/member-details";
import { Card, CardHead, PageHeader, Toggle } from "@/components/ui";

function ProfileInner() {
  const data = useQuery(api.team.overview);
  const setTakingTours = useMutation(api.tours.setTakingTours);
  const toast = useToast();
  const me = data?.members.find((m) => m.isSelf);

  return (
    <div className="space-y-5 pb-10">
      <PageHeader eyebrow="Profile" title={me?.name ?? "Your profile"} subtitle={me?.email} />
      {data && !me ? (
        <p className="text-sm text-muted-foreground">We couldn&rsquo;t find your profile.</p>
      ) : null}
      {me ? (
        <>
          <Card>
            <CardHead title="Contact and out of office" />
            <MemberDetails member={me} isAdmin={false} canSetUnavailable />
          </Card>
          <Card>
            <CardHead title="Tours" hint="When on, Sarah can book tours on your calendar." />
            <Toggle
              label="Sarah books tours for me"
              checked={me.takingTours}
              onChange={(next) =>
                void setTakingTours({ userId: me.userId, takingTours: next }).then(
                  () => toast(next ? "Tours on" : "Tours off"),
                  (err: unknown) => toast(errorMessage(err, "That didn't work."), "error"),
                )
              }
            />
          </Card>
        </>
      ) : null}
    </div>
  );
}

export default function ProfilePage() {
  return (
    <RequireView views={["asset_manager", "admin", "accountant"]}>
      <ProfileInner />
    </RequireView>
  );
}
