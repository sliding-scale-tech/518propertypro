"use client";

import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RequireView } from "@/components/require-view";
import { btnOutline } from "@/components/maintenance/shared";
import {
  SeverityBadge,
  StatusPill,
  mrNumber,
  timeAgo,
} from "@/components/maintenance/shared";
import { useResidentActions } from "@/components/residents/use-resident-actions";

function Detail({ id }: { id: Id<"residents"> }) {
  const access = useQuery(api.team.myAccess);
  const isAdmin = access?.view === "admin";
  const resident = useQuery(api.residents.get, { residentId: id });
  const actions = useResidentActions();
  const requests = useQuery(
    api.maintenance.list,
    resident ? { tab: "all", unitId: resident.unitId } : "skip",
  );

  if (resident === undefined) return <p className="py-10 text-sm text-muted-foreground">Loading…</p>;
  if (resident === null) return <p className="py-10 text-sm text-muted-foreground">Resident not found.</p>;

  const mine = (requests ?? []).filter((r) => r.residentId === resident._id);

  return (
    <div className="space-y-8 pb-10">
      <div>
        <Link href="/residents" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="h-4 w-4" />
          Residents
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{resident.fullName}</h1>
          {!resident.active ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Inactive</span>
          ) : null}
          {isAdmin ? (
            <button className={btnOutline} onClick={() => actions.edit(resident)}>
              Edit
            </button>
          ) : null}
          {isAdmin && resident.active ? (
            <button className={btnOutline} onClick={() => actions.deactivate(resident)}>
              Deactivate
            </button>
          ) : null}
        </div>
      </div>

      <section className="grid gap-3 rounded-2xl border border-border bg-card p-5 text-sm sm:grid-cols-2">
        <p>
          <span className="text-muted-foreground">Property: </span>
          {resident.propertyName}
        </p>
        <p>
          <span className="text-muted-foreground">Unit: </span>
          {resident.unitNumber}
        </p>
        {resident.phones && resident.phones.length > 0 ? (
          <p>
            <span className="text-muted-foreground">Phones: </span>
            {resident.phones.join(", ")}
          </p>
        ) : null}
        {resident.email ? (
          <p>
            <span className="text-muted-foreground">Email: </span>
            {resident.email}
          </p>
        ) : null}
        <p>
          <span className="text-muted-foreground">Lease end: </span>
          {resident.leaseEnd ?? "—"}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Maintenance requests</h2>
        {requests === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">No maintenance requests for this resident.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {mine.map((r) => (
              <li key={r._id}>
                <Link href={`/maintenance/${r._id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-accent/40">
                  <span className="font-semibold tabular-nums">{mrNumber(r.number)}</span>
                  <SeverityBadge severity={r.severity} />
                  <StatusPill status={r.status} />
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{r.description}</span>
                  <span className="text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isAdmin ? actions.dialogs : null}
    </div>
  );
}

export default function ResidentDetailPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireView views={["admin", "asset_manager", "accountant"]}>
      <Detail id={params.id as Id<"residents">} />
    </RequireView>
  );
}
