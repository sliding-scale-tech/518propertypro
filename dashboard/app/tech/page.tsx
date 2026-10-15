"use client";

import { useQuery } from "convex/react";
import { ClipboardList, Loader2 } from "lucide-react";
import { useState } from "react";
import { RequireView } from "@/components/require-view";
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
      <div role="tablist" className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
        {(["open", "done"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`min-h-11 rounded-lg text-sm font-semibold ${
              tab === t ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            {t === "open" ? `Open (${open.length})` : `Done (${done.length})`}
          </button>
        ))}
      </div>

      {jobs === undefined ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : shown.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-8 text-center">
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
