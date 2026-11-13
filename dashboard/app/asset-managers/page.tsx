"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { RequireView } from "@/components/require-view";
import { ManagersTab } from "@/components/asset-managers/managers-tab";
import { PropertyAssignmentsTab } from "@/components/asset-managers/property-assignments-tab";
import { TeamsTab } from "@/components/asset-managers/teams-tab";
import { PageHeader, Seg } from "@/components/ui";

type Tab = "managers" | "teams" | "assignments";

function AssetManagersInner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = raw === "assignments" || raw === "teams" ? raw : "managers";

  function setTab(next: Tab) {
    router.replace(next === "managers" ? pathname : `${pathname}?tab=${next}`, { scroll: false });
  }

  return (
    <div className="space-y-5 pb-10">
      <PageHeader title="Asset Managers" subtitle="Manage asset managers, their assigned units, and maintenance workload." />
      <Seg
        label="Asset managers sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: "managers", label: "Asset managers" },
          { value: "teams", label: "Teams" },
          { value: "assignments", label: "Property assignments" },
        ]}
      />
      {tab === "managers" ? <ManagersTab /> : tab === "teams" ? <TeamsTab /> : <PropertyAssignmentsTab />}
    </div>
  );
}

export default function AssetManagersPage() {
  return (
    <RequireView views={["admin"]}>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <AssetManagersInner />
      </Suspense>
    </RequireView>
  );
}
