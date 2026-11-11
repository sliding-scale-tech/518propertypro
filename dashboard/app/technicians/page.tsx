"use client";

import { RequireView } from "@/components/require-view";
import { TechniciansTab } from "@/components/technicians/technicians-tab";
import { PageHeader } from "@/components/ui";

export default function TechniciansPage() {
  return (
    <RequireView views={["admin"]}>
      <div className="space-y-5 pb-10">
        <PageHeader title="Technicians" subtitle="Manage technicians, their assigned work orders, and maintenance workload." />
        <TechniciansTab />
      </div>
    </RequireView>
  );
}
