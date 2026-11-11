"use client";

import { useQuery } from "convex/react";
import { ClipboardList, Loader2 } from "lucide-react";
import { useState } from "react";
import { RequireView } from "@/components/require-view";
import { JobCard } from "@/components/tech/job-card";
import { TechBadge, TechCard, TechPageTitle, TechSeg } from "@/components/tech/ui";
import { api } from "@/convex/_generated/api";

type Tab = "open" | "done";

function MyJobs() {
  const [tab, setTab] = useState<Tab>("open");
  const jobs = useQuery(api.workOrders.list, {});

  // Jobs Pat sent back or asked about come first; the server's order is kept within each group.
  const open = (jobs ?? [])
    .filter((j) => ["created", "assigned", "in_progress"].includes(j.status))
    .map((j, i) => ({ j, i }))
    .sort((a, b) => Number(!!b.j.actionRequired) - Number(!!a.j.actionRequired) || a.i - b.i)
    .map(({ j }) => j);
  const done = (jobs ?? []).filter((j) => ["completed", "reviewed_closed"].includes(j.status));
  const shown = tab === "open" ? open : done;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="flex flex-col gap-4">
      <TechPageTitle title="My jobs" subtitle={`${today} · Only work assigned to you`} />

      {jobs !== undefined && (
        <div className="flex flex-wrap gap-2">
          <TechBadge tone="info">{open.length} active</TechBadge>
          <TechBadge tone="success">{done.length} submitted</TechBadge>
        </div>
      )}

      <TechSeg
        label="Job list"
        value={tab}
        onChange={setTab}
        options={[
          { value: "open", label: `Open (${open.length})` },
          { value: "done", label: `Done (${done.length})` },
        ]}
      />

      {jobs === undefined ? (
        <TechCard as="div" className="items-center py-10 text-center">
          <Loader2 aria-hidden className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading your jobs…</p>
        </TechCard>
      ) : shown.length === 0 ? (
        <TechCard as="div" className="items-center py-10 text-center">
          <ClipboardList aria-hidden className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="text-base font-semibold">{tab === "open" ? "No open jobs right now" : "Nothing finished yet"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {tab === "open" ? "New jobs from Pat will show up here." : "Completed jobs will appear here."}
            </p>
          </div>
        </TechCard>
      ) : (
        <ul className="flex flex-col gap-4">
          {shown.map((j) => (
            <JobCard key={j._id} job={{ ...j, address: j.propertyAddress }} />
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
