"use client";

import { useParams } from "next/navigation";
import { RequireView } from "@/components/require-view";
import { JobDetail } from "@/components/tech/job-detail";

export default function TechJobPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireView views={["technician", "admin"]}>
      <JobDetail id={params.id} />
    </RequireView>
  );
}
