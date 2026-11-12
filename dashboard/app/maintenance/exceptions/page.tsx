"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage, useToast } from "@/components/toast";
import { Dropdown } from "@/components/ui/dropdown";
import { RequireView } from "@/components/require-view";
import { PageHeader, Pagination, useUrlPaging } from "@/components/ui";
import {
  Field,
  Modal,
  SeverityBadge,
  UnitPickerDialog,
  btnOutline,
  btnPrimary,
  inputClass,
  mrNumber,
  timeAgo,
} from "@/components/maintenance/shared";

const REASON_LABEL: Record<string, string> = {
  "no unit match": "No unit match",
  "unit has no asset manager": "Unit has no asset manager",
  "AM unavailable": "Assigned asset manager unavailable",
  "unit not active for maintenance intake": "Unit not active for maintenance intake",
};

function FallbackDialog({
  requestId,
  onClose,
}: {
  requestId: Id<"maintenanceRequests">;
  onClose: () => void;
}) {
  const toast = useToast();
  const approve = useMutation(api.maintenance.approveFallback);
  const team = useQuery(api.team.overview);
  const [userId, setUserId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const options = useMemo(
    () => [
      { value: "", label: "Select a person…" },
      ...(team?.members ?? [])
        .filter((m) => m.jobRoles.includes("asset_manager") || m.jobRoles.includes("maintenance_lead"))
        .map((m) => ({ value: m.userId as string, label: m.name })),
    ],
    [team],
  );

  return (
    <Modal title="Approve temporary fallback" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          This person handles this one request only. The note goes in the audit trail.
        </p>
        <Field label="Handled by">
          <Dropdown value={userId} options={options} onChange={setUserId} />
        </Field>
        <Field label="Note (required)">
          <textarea className={`${inputClass} min-h-20`} value={note} maxLength={450} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <button className={btnOutline} onClick={onClose}>
            Cancel
          </button>
          <button
            className={btnPrimary}
            disabled={!userId || !note.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await approve({ requestId, userId: userId as Id<"users">, note: note.trim() });
                toast("Fallback approved.", "success");
                onClose();
              } catch (e) {
                toast(errorMessage(e), "error");
                setBusy(false);
              }
            }}
          >
            {busy ? "Working…" : "Approve"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Exceptions() {
  const toast = useToast();
  const access = useQuery(api.team.myAccess);
  const canManage = access?.canManageMaintenance === true;
  const paging = useUrlPaging();
  const data = useQuery(api.maintenance.exceptions, { page: paging.page, pageSize: paging.pageSize });
  const rows = data?.rows;
  const resolve = useMutation(api.maintenance.resolveException);
  const [resolving, setResolving] = useState<Id<"maintenanceRequests"> | null>(null);
  const [fallback, setFallback] = useState<Id<"maintenanceRequests"> | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, NonNullable<typeof rows>>();
    for (const r of rows ?? []) {
      const key = r.routeReason ?? "other";
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Exceptions"
        subtitle={`Requests that could not be routed safely.${!canManage ? " You have read-only access." : ""}`}
      />

      {data?.capped ? (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-[12.5px] text-amber-800">
          Showing the {data.cap} most recent exceptions. Older ones are not listed until these are resolved.
        </p>
      ) : null}

      {rows === undefined ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : groups.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
          Nothing in the exception queue.
        </div>
      ) : (
        groups.map(([reason, items]) => (
          <section key={reason} className="space-y-2">
            <h2 className="text-sm font-semibold">
              {REASON_LABEL[reason] ?? reason}{" "}
              <span className="font-normal text-muted-foreground">({data?.reasonCounts[reason] ?? items.length})</span>
            </h2>
            <div className="divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card">
              {items.map((r) => (
                <div key={r._id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <SeverityBadge severity={r.severity} />
                      <Link href={`/maintenance/${r._id}`} className="font-medium hover:underline">
                        {mrNumber(r.number)}
                      </Link>
                      <span className="text-muted-foreground">{timeAgo(r.createdAt)} ago</span>
                    </div>
                    <div className="truncate text-sm">{r.description}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.callerName ?? "Unknown caller"}
                      {r.spokenAddress || r.spokenUnit
                        ? ` · said: ${[r.spokenAddress, r.spokenUnit && `unit ${r.spokenUnit}`].filter(Boolean).join(", ")}`
                        : ""}
                      {r.propertyName ? ` · ${r.propertyName}` : ""}
                      {r.unitNumber ? ` ${r.unitNumber}` : ""}
                      {r.assignedAssetManagerName ? ` · AM: ${r.assignedAssetManagerName}` : ""}
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap gap-2">
                      <button className={btnPrimary} onClick={() => setResolving(r._id)}>
                        Resolve to unit
                      </button>
                      {reason === "unit has no asset manager" && (
                        <Link href="/properties" className={btnOutline}>
                          Assign AM to unit
                        </Link>
                      )}
                      {reason === "AM unavailable" && (
                        <button className={btnOutline} onClick={() => setFallback(r._id)}>
                          Approve fallback
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      {data && data.total > 0 ? (
        <Pagination
          label="Exceptions pages"
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          onPage={paging.setPage}
          onPageSize={paging.setPageSize}
        />
      ) : null}

      {resolving && (
        <UnitPickerDialog
          title="Resolve to unit"
          confirmLabel="Resolve and re-route"
          onClose={() => setResolving(null)}
          onSubmit={async (unitId) => {
            try {
              await resolve({ requestId: resolving, unitId });
              toast("Resolved and re-routed.", "success");
            } catch (e) {
              toast(errorMessage(e), "error");
              throw e;
            }
          }}
        />
      )}
      {fallback && <FallbackDialog requestId={fallback} onClose={() => setFallback(null)} />}
    </div>
  );
}

export default function ExceptionsPage() {
  return (
    <RequireView views={["admin"]}>
      <Suspense fallback={null}>
        <Exceptions />
      </Suspense>
    </RequireView>
  );
}

