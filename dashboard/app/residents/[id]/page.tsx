"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RequireView } from "@/components/require-view";
import { STATUS_LABEL, mrNumber, timeAgo } from "@/components/maintenance/shared";
import { useResidentActions } from "@/components/residents/use-resident-actions";
import { Btn, Card, CardHead, KeyValue, ListRow, PageHeader, Pill, SevChip } from "@/components/ui";

function Detail({ id }: { id: Id<"residents"> }) {
  const router = useRouter();
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

  const details = [
    { label: "Property", value: resident.propertyName },
    { label: "Unit", value: resident.unitNumber },
    ...(resident.phones && resident.phones.length > 0
      ? [{ label: "Phones", value: <span className="tabular-nums">{resident.phones.join(", ")}</span> }]
      : []),
    ...(resident.email ? [{ label: "Email", value: resident.email }] : []),
    { label: "Lease end", value: resident.leaseEnd ?? "—" },
  ];

  return (
    <div className="space-y-5 pb-10">
      <Link href="/tenants?tab=residents" className="text-[13px] font-medium text-primary hover:underline">
        ← Residents
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {resident.fullName}
            {!resident.active ? <Pill>Inactive</Pill> : null}
          </span>
        }
        actions={
          isAdmin ? (
            <>
              <Btn onClick={() => actions.edit(resident)}>Edit</Btn>
              {resident.active ? (
                <Btn variant="dng" onClick={() => actions.deactivate(resident)}>
                  Deactivate
                </Btn>
              ) : null}
            </>
          ) : undefined
        }
      />

      <Card>
        <CardHead title="Details" />
        <KeyValue items={details} />
      </Card>

      <Card>
        <CardHead title="Maintenance requests" />
        {requests === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">No maintenance requests for this resident.</p>
        ) : (
          mine.map((r, i) => (
            <ListRow
              key={r._id}
              first={i === 0}
              title={
                <span className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{mrNumber(r.number)}</span>
                  {r.description}
                </span>
              }
              sub={timeAgo(r.createdAt)}
              right={
                <>
                  <SevChip level={r.severity} score={r.severityScore} />
                  <Pill>{STATUS_LABEL[r.status]}</Pill>
                </>
              }
              onClick={() => router.push(`/maintenance/${r._id}`)}
            />
          ))
        )}
      </Card>

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
