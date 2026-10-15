"use client";

import { useMutation, useQuery } from "convex/react";
import { Camera, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { useToast } from "@/components/toast";
import { RequireView } from "@/components/require-view";
import { RequestDetail } from "@/components/maintenance/request-detail";
import {
  NoteDialog,
  SeverityBadge,
  btnDanger,
  btnOutline,
  btnPrimary,
  cleanError,
  formatWhen,
  mrNumber,
  timeAgo,
} from "@/components/maintenance/shared";

type Queue = NonNullable<FunctionReturnType<typeof api.maintenance.validatedQueue>>;
type Row = Queue["forwarded"][number];

function Queue() {
  const toast = useToast();
  const access = useQuery(api.team.myAccess);
  const canManage = access?.canManageMaintenance === true;
  const queue = useQuery(api.maintenance.validatedQueue);
  const sendBack = useMutation(api.maintenance.sendBackToAM);
  const closeNoWo = useMutation(api.maintenance.closeNoWorkOrder);

  const [selected, setSelected] = useState<Id<"maintenanceRequests"> | null>(null);
  const [action, setAction] = useState<{ kind: "back" | "close"; id: Id<"maintenanceRequests"> } | null>(null);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !action && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, action]);

  const rowActions = (r: Row, forwarded: boolean) =>
    canManage ? (
      <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
        <Link href={`/work-orders/new?request=${r._id}`} className={btnPrimary}>
          Create work order
        </Link>
        {forwarded && (
          <button className={btnOutline} onClick={() => setAction({ kind: "back", id: r._id })}>
            Send back to AM
          </button>
        )}
        {forwarded && (
          <button className={btnDanger} onClick={() => setAction({ kind: "close", id: r._id })}>
            Close: no work order
          </button>
        )}
      </div>
    ) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Validated queue</h1>
        <p className="text-sm text-muted-foreground">
          Requests asset managers forwarded, plus open emergencies and urgents.
          {!canManage && " You have read-only access."}
        </p>
      </div>

      {queue === undefined ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">
              🔴 Emergencies <span className="font-normal text-muted-foreground">({queue.emergencies.length})</span>
            </h2>
            {queue.emergencies.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                No open emergencies.
              </p>
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-2xl border border-red-500/30 bg-card shadow-sm">
                {queue.emergencies.map((r) => (
                  <div
                    key={r._id}
                    onClick={() => setSelected(r._id)}
                    className="flex cursor-pointer flex-wrap items-center justify-between gap-3 p-4 hover:bg-accent/40"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <SeverityBadge severity={r.severity} />
                        <span className="font-medium">{mrNumber(r.number)}</span>
                        <span className="text-muted-foreground">
                          {r.propertyName ?? "No property"}
                          {r.unitNumber ? ` · ${r.unitNumber}` : ""}
                        </span>
                        <span className="text-muted-foreground">{timeAgo(r.createdAt)} ago</span>
                        {r.mediaCount > 0 && (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Camera className="h-3.5 w-3.5" />
                            {r.mediaCount}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-sm">{r.description}</div>
                    </div>
                    {rowActions(r as Row, false)}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">
              Forwarded <span className="font-normal text-muted-foreground">({queue.forwarded.length})</span>
            </h2>
            {queue.forwarded.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                Nothing forwarded right now.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Severity</th>
                      <th className="px-4 py-2.5 font-medium">Request</th>
                      <th className="px-4 py-2.5 font-medium">Unit</th>
                      <th className="px-4 py-2.5 font-medium">Issue</th>
                      <th className="px-4 py-2.5 font-medium">Forwarded by</th>
                      <th className="px-4 py-2.5 font-medium">Forwarded</th>
                      <th className="px-4 py-2.5 font-medium">AM note</th>
                      <th className="px-4 py-2.5 font-medium">Media</th>
                      {canManage && <th className="px-4 py-2.5 font-medium">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {queue.forwarded.map((r) => (
                      <tr
                        key={r._id}
                        onClick={() => setSelected(r._id)}
                        className={`cursor-pointer border-b border-border last:border-0 hover:bg-accent/40 ${
                          selected === r._id ? "bg-accent/40" : ""
                        }`}
                      >
                        <td className="px-4 py-3">
                          <SeverityBadge severity={r.severity} />
                        </td>
                        <td className="px-4 py-3 font-medium">{mrNumber(r.number)}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {r.propertyName ?? "No property"}
                          {r.unitNumber ? ` · ${r.unitNumber}` : ""}
                        </td>
                        <td className="max-w-xs px-4 py-3">
                          <div className="text-xs capitalize text-muted-foreground">{r.issueType}</div>
                          <div className="truncate">{r.description}</div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{r.forwardedByName ?? "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                          {r.forwardedAt ? formatWhen(r.forwardedAt) : "—"}
                        </td>
                        <td className="max-w-[14rem] truncate px-4 py-3 text-muted-foreground">{r.forwardedNote ?? "—"}</td>
                        <td className="px-4 py-3">
                          {r.mediaCount > 0 ? (
                            <span className="inline-flex items-center gap-1">
                              <Camera className="h-3.5 w-3.5" />
                              {r.mediaCount}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        {canManage && <td className="px-4 py-3">{rowActions(r, true)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {/* Side panel */}
      {selected && (
        <>
          <button
            aria-label="Close panel"
            className="fixed inset-0 z-40 cursor-default bg-black/30"
            onClick={() => setSelected(null)}
          />
          <aside className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto border-l border-border bg-background p-4 shadow-2xl sm:w-[40rem] sm:p-5">
            <div className="mb-3 flex justify-end">
              <button
                onClick={() => setSelected(null)}
                aria-label="Close"
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <RequestDetail requestId={selected} embedded />
          </aside>
        </>
      )}

      {action?.kind === "back" && (
        <NoteDialog
          title="Send back to AM"
          label="Note for the asset manager"
          required
          confirmLabel="Send back"
          onClose={() => setAction(null)}
          onSubmit={async (note) => {
            try {
              await sendBack({ requestId: action.id, note });
              toast("Sent back to the asset manager.", "success");
            } catch (e) {
              toast(cleanError(e), "error");
              throw e;
            }
          }}
        />
      )}
      {action?.kind === "close" && (
        <NoteDialog
          title="Close: no work order needed"
          label="Reason"
          required
          danger
          confirmLabel="Close request"
          onClose={() => setAction(null)}
          onSubmit={async (reason) => {
            try {
              await closeNoWo({ requestId: action.id, reason });
              toast("Request closed.", "success");
            } catch (e) {
              toast(cleanError(e), "error");
              throw e;
            }
          }}
        />
      )}
    </div>
  );
}

export default function ValidatedQueuePage() {
  return (
    <RequireView views={["admin"]}>
      <Queue />
    </RequireView>
  );
}
