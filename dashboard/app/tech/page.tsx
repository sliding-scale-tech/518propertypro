"use client";

import { useQuery } from "convex/react";
import { ClipboardList, Loader2 } from "lucide-react";
import { useState } from "react";
import { RequireView } from "@/components/require-view";
import { Seg } from "@/components/ui";
import { JobCard } from "@/components/tech/job-card";
import { api } from "@/convex/_generated/api";

type Tab = "open" | "done";

function MyJobs() {
  const [tab, setTab] = useState<Tab>("open");
  const jobs = useQuery(api.workOrders.list, {});

  const open = (jobs ?? []).filter((j) => ["created", "assigned", "in_progress"].includes(j.status));
  const done = (jobs ?? []).filter((j) => ["completed", "reviewed_closed"].includes(j.status));
  const shown = tab === "open" ? open : done;

  return (
    <div>
      <h1 className="text-xl font-semibold">My jobs</h1>
      <div className="mt-4">
        <Seg
          label="Job list"
          value={tab}
          onChange={setTab}
          options={[
            { value: "open", label: `Open (${open.length})` },
            { value: "done", label: `Done (${done.length})` },
          ]}
        />
      </div>

      {jobs === undefined ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : shown.length === 0 ? (
        <div className="mt-8 rounded-[20px] border border-dashed border-border p-8 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">{tab === "open" ? "No open jobs right now" : "Nothing finished yet"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {tab === "open" ? "New jobs from Pat will show up here." : "Completed jobs will appear here."}
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {shown.map((j) => (
            <JobCard key={j._id} job={j} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TechPage() {
  return (
    <RequireView views={["technician", "admin"]}>
      <MyJobs />
    </RequireView>
  );
}
