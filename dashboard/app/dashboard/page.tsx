"use client";

import { useUser } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { CheckCircle2, Wallet } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { RequireView } from "@/components/require-view";
import { Card, IconTile, Kpi, KpiRow, PageHeader } from "@/components/ui";
import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { AmDashboard } from "@/components/dashboard/am-dashboard";
import { browserTimeZone, greeting } from "@/components/dashboard/format";

/** Accountant: finished work this week, a Finance note, and a Finance note. */
function AccountantDashboard() {
  const { user } = useUser();
  const data = useQuery(api.dashboard.overview, { fallbackTimeZone: browserTimeZone() });
  const m = data?.maintenance;

  const firstName = user?.firstName?.trim() || user?.fullName?.split(" ")[0] || "there";

  return (
    <div className="space-y-5 pb-10">
      <PageHeader
        title={`${greeting(new Date())}, ${firstName}`}
        subtitle="Here’s what’s happening with your properties today."
      />

      <KpiRow>
        <Kpi label="Work orders completed this week" icon={<CheckCircle2 />} value={m?.completedThisWeek ?? "—"} />
        <Card className="flex items-center gap-3 !rounded-[18px] !px-4 !py-3.5">
          <IconTile tone="acc">
            <Wallet />
          </IconTile>
          <div>
            <h2 className="text-sm font-semibold">Finance</h2>
            <p className="text-xs text-muted-foreground">Payments and owner statements are coming soon.</p>
          </div>
        </Card>
      </KpiRow>
    </div>
  );
}

function DashboardSwitch() {
  const access = useQuery(api.team.myAccess);
  if (access?.view === "asset_manager") return <AmDashboard />;
  if (access?.view === "accountant") return <AccountantDashboard />;
  return <AdminDashboard />;
}

export default function DashboardPage() {
  return (
    <RequireView views={["admin", "accountant", "asset_manager"]}>
      <DashboardSwitch />
    </RequireView>
  );
}
