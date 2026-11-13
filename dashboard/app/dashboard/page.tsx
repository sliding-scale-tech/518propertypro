"use client";

import { useUser } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { CheckCircle2, HardHat, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { AppRole } from "@/convex/roleSet";
import { RequireView, useMyRoles } from "@/components/require-view";
import { Card, IconTile, Kpi, KpiRow, PageHeader } from "@/components/ui";
import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { AmDashboard } from "@/components/dashboard/am-dashboard";
import { browserTimeZone, greeting } from "@/components/dashboard/format";

/**
 * Accountant: finished work this week, a Finance note, and a Finance note. `withGreeting` is false
 * when it is a later section of a multi-role dashboard (the first section already greets).
 */
function AccountantDashboard({ withGreeting = true }: { withGreeting?: boolean }) {
  const { user } = useUser();
  const data = useQuery(api.dashboard.overview, { fallbackTimeZone: browserTimeZone() });
  const m = data?.maintenance;

  const firstName = user?.firstName?.trim() || user?.fullName?.split(" ")[0] || "there";

  return (
    <div className={withGreeting ? "space-y-5 pb-10" : "space-y-5"}>
      {withGreeting ? (
        <PageHeader
          title={`${greeting(new Date())}, ${firstName}`}
          subtitle="Here’s what’s happening with your properties today."
        />
      ) : null}

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

/** Technician section of a multi-role dashboard: their jobs live in the technician app. */
function TechnicianSection() {
  return (
    <Card className="flex flex-wrap items-center gap-3 !rounded-[18px] !px-4 !py-3.5">
      <IconTile tone="acc">
        <HardHat />
      </IconTile>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold">Your technician jobs</h3>
        <p className="text-xs text-muted-foreground">Open the technician app to see and work on the jobs assigned to you.</p>
      </div>
      <Link
        href="/tech"
        className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted"
      >
        Open my jobs
      </Link>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="text-lg font-semibold tracking-[-0.01em]">{title}</h2>
      {children}
    </section>
  );
}

/**
 * A multi-role person (B31) sees one section per role they hold, each the same component that
 * role's own dashboard uses. The first section keeps its greeting; later ones get a heading.
 */
function MultiRoleDashboard({ roles }: { roles: AppRole[] }) {
  const am = roles.includes("asset_manager");
  const accountant = roles.includes("accountant");
  const tech = roles.includes("technician");
  return (
    <div className="space-y-8 pb-10">
      {am ? <AmDashboard /> : null}
      {accountant ? (
        am ? (
          <Section title="Finance">
            <AccountantDashboard withGreeting={false} />
          </Section>
        ) : (
          <AccountantDashboard />
        )
      ) : null}
      {tech ? (
        <Section title="Technician">
          <TechnicianSection />
        </Section>
      ) : null}
    </div>
  );
}

function DashboardSwitch() {
  const roles = useMyRoles() ?? [];
  if (roles.includes("admin")) return <AdminDashboard />;
  const sections = roles.filter((r) => r === "asset_manager" || r === "accountant" || r === "technician");
  // Single role: exactly the dashboard that role has always had.
  if (sections.length === 1 && sections[0] === "asset_manager") return <AmDashboard />;
  if (sections.length === 1 && sections[0] === "accountant") return <AccountantDashboard />;
  if (sections.length > 1) return <MultiRoleDashboard roles={sections} />;
  return <AdminDashboard />;
}

export default function DashboardPage() {
  return (
    <RequireView views={["admin", "accountant", "asset_manager"]}>
      <DashboardSwitch />
    </RequireView>
  );
}
