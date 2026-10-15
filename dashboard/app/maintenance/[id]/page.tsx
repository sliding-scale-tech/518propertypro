"use client";

import { useParams } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import { RequireView } from "@/components/require-view";
import { RequestDetail } from "@/components/maintenance/request-detail";

export default function MaintenanceDetailPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireView views={["admin", "asset_manager"]}>
      <RequestDetail requestId={params.id as Id<"maintenanceRequests">} />
    </RequireView>
  );
}
