"use client";

import { useQuery } from "convex/react";
import { ClipboardList, Loader2 } from "lucide-react";
import { Suspense, useState } from "react";
import { RequireView } from "@/components/require-view";
import { JobCard } from "@/components/tech/job-card";
import { TechBadge, TechCard, TechPageTitle, TechSeg } from "@/components/tech/ui";
import { Pagination, paginate, useUrlPaging } from "@/components/ui";
import { api } from "@/convex/_generated/api";

type Tab = "open" | "done";

/** Jobs per page: a short page is easier to scroll on a phone. The page number is in the URL (?page=). */
const JOBS_PER_PAGE = 20;
/** workOrders.list returns at most this many jobs; a full list means older ones are not shown. */
const LIST_LIMIT = 300;

function MyJobs() {
  const [tab, setTab] = useState<Tab>("open");
  const access = useQuery(api.team.myAccess);
  // Someone with the technician role plus another (e.g. asset manager or accountant) gets the union
  // of what their roles reach from workOrders.list, so ask for their own jobs only. A technician-only
  // account is already limited to its own jobs server-side; an admin (never a technician) keeps the full list.
  const ownJobsOnly = !!access && access.roles.includes("technician");
  const jobs = useQuery(
    api.workOrders.list,
    access === undefined || access === null ? "skip" : ownJobsOnly ? { technicianUserId: access.userId } : {},
  );
  const paging = useUrlPaging();

  // Jobs Pat sent back or asked about come first; the server's order is kept within each group.
  const open = (jobs ?? [])
    .filter((j) => ["created", "assigned", "in_progress"].includes(j.status))
    .map((j, i) => ({ j, i }))
    .sort((a, b) => Number(!!b.j.actionRequired) - Number(!!a.j.actionRequired) || a.i - b.i)
    .map(({ j }) => j);
  const done = (jobs ?? []).filter((j) => ["completed", "reviewed_closed"].includes(j.status));
  const paged = paginate(tab === "open" ? open : done, paging.page, JOBS_PER_PAGE);
  const shown = paged.rows;
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
        onChange={(t) => {
          setTab(t);
          paging.resetPage();
        }}
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
        <>
          <ul className="flex flex-col gap-4">
            {shown.map((j) => (
              <JobCard key={j._id} job={{ ...j, address: j.propertyAddress }} />
            ))}
          </ul>
          <Pagination
            label="Jobs pages"
            page={paged.page}
            pageSize={JOBS_PER_PAGE}
            total={paged.total}
            onPage={(p) => {
              paging.setPage(p);
              window.scrollTo({ top: 0 });
            }}
          />
        </>
      )}
      {jobs !== undefined && jobs.length >= LIST_LIMIT ? (
        <p role="status" className="text-center text-xs text-muted-foreground">
          Showing your {LIST_LIMIT} most urgent jobs. Older ones are not listed here.
        </p>
      ) : null}
    </div>
  );
}

export default function TechPage() {
  return (
    <RequireView views={["technician", "admin"]}>
      <Suspense fallback={null}>
        <MyJobs />
      </Suspense>
    </RequireView>
  );
}
