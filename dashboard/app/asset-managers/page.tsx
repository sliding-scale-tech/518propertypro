"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { RequireView } from "@/components/require-view";
import { ManagersTab } from "@/components/asset-managers/managers-tab";
import { PropertyAssignmentsTab } from "@/components/asset-managers/property-assignments-tab";
import { PageHeader, Seg } from "@/components/ui";

type Tab = "managers" | "assignments";

function AssetManagersInner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab: Tab = params.get("tab") === "assignments" ? "assignments" : "managers";

  function setTab(next: Tab) {
    router.replace(next === "assignments" ? `${pathname}?tab=assignments` : pathname, { scroll: false });
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
          { value: "assignments", label: "Property assignments" },
        ]}
      />
      {tab === "managers" ? <ManagersTab /> : <PropertyAssignmentsTab />}
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
