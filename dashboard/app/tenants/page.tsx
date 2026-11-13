"use client";

import { useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import { RequireView, rolesOfAccess } from "@/components/require-view";
import { CallbacksList } from "@/components/residents/callbacks-list";
import { ResidentCalls } from "@/components/residents/resident-calls";
import { ResidentsList } from "@/components/residents/residents-list";
import { PageHeader, Seg } from "@/components/ui";

type Tab = "calls" | "callbacks" | "residents";

function TenantsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const access = useQuery(api.team.myAccess);
  // Resident-call detail: admin and (scoped) asset manager; the server returns nothing for other views.
  const roles = rolesOfAccess(access);
  const canSeeCalls = roles.includes("admin") || roles.includes("asset_manager");
  const requested = params.get("tab");
  const tab: Tab = canSeeCalls ? (requested === "residents" ? "residents" : requested === "callbacks" ? "callbacks" : "calls") : "residents";

  return (
    <div className="space-y-5 pb-10">
      <PageHeader
        title="Tenants"
        subtitle={
          tab === "calls"
            ? "Every resident call, including maintenance requests raised from calls."
            : tab === "callbacks"
              ? "Callers Sarah could not match to a unit, waiting for a callback."
              : "Tenant directory used to recognise callers."
        }
        actions={
          canSeeCalls ? (
            <Seg<Tab>
              label="Tenants view"
              value={tab}
              options={[
                { value: "calls", label: "Resident calls" },
                { value: "callbacks", label: "Callbacks" },
                { value: "residents", label: "Residents" },
              ]}
              onChange={(next) => router.replace(`/tenants?tab=${next}`, { scroll: false })}
            />
          ) : undefined
        }
      />
      {tab === "calls" ? <ResidentCalls /> : tab === "callbacks" ? <CallbacksList /> : <ResidentsList />}
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
