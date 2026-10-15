"use client";

import { useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import { RequireView } from "@/components/require-view";
import { ResidentCalls } from "@/components/residents/resident-calls";
import { ResidentsList } from "@/components/residents/residents-list";
import { PageHeader, Seg } from "@/components/ui";

type Tab = "calls" | "residents";

function TenantsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const access = useQuery(api.team.myAccess);
  // Resident-call detail: admin and (scoped) asset manager; the server returns nothing for other views.
  const canSeeCalls = access?.view === "admin" || access?.view === "asset_manager";
  const requested = params.get("tab");
  const tab: Tab = canSeeCalls && requested !== "residents" ? "calls" : "residents";

  return (
    <div className="space-y-5 pb-10">
      <PageHeader
        title="Tenants"
        subtitle={
          tab === "calls"
            ? "Non-maintenance resident calls. Maintenance is under Work orders."
            : "Tenant directory used to recognise callers."
        }
        actions={
          canSeeCalls ? (
            <Seg<Tab>
              label="Tenants view"
              value={tab}
              options={[
                { value: "calls", label: "Resident calls" },
                { value: "residents", label: "Residents" },
              ]}
              onChange={(next) => router.replace(next === "calls" ? "/tenants?tab=calls" : "/tenants?tab=residents", { scroll: false })}
            />
          ) : undefined
        }
      />
      {tab === "calls" ? <ResidentCalls /> : <ResidentsList />}
    </div>
  );
}

export default function TenantsPage() {
  return (
    <RequireView views={["admin", "asset_manager", "accountant"]}>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <TenantsInner />
      </Suspense>
    </RequireView>
  );
}
