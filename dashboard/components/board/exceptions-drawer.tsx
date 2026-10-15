"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/components/tech/lib";
import { useToast } from "@/components/toast";
import { Btn, Card, Drawer, DrawerSection, Field, Select, SevChip, Textarea } from "@/components/ui";
import { fmtDateTime, mrId } from "./shared";

const REASON_LABEL: Record<string, string> = {
  "no unit match": "No unit match",
  "unit has no asset manager": "Unit has no asset manager",
  "AM unavailable": "Assigned asset manager unavailable",
  "unit not active for maintenance intake": "Unit not active for maintenance intake",
};

type Row = NonNullable<ReturnType<typeof useExceptionRows>>[number];

function useExceptionRows(open: boolean) {
  return useQuery(api.maintenance.exceptions, open ? {} : "skip");
}

function ResolveForm({ row, onDone }: { row: Row; onDone: () => void }) {
  const toast = useToast();
  const resolve = useMutation(api.maintenance.resolveException);
  const properties = useQuery(api.properties.list);
  const units = useQuery(api.units.list, {});
  const [propertyId, setPropertyId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [busy, setBusy] = useState(false);
  const options = (units ?? []).filter((u) => u.propertyId === propertyId);

  return (
    <div className="mt-2 flex flex-col gap-2.5 rounded-xl bg-muted p-3">
      <Field label="Property">
        <Select
          value={propertyId}
          onChange={(e) => {
            setPropertyId(e.target.value);
            setUnitId("");
          }}
          aria-label="Property"
        >
          <option value="">Select a property…</option>
          {(properties ?? []).map((p) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Unit">
        <Select value={unitId} disabled={!propertyId} onChange={(e) => setUnitId(e.target.value)} aria-label="Unit">
          <option value="">Select a unit…</option>
          {options.map((u) => (
            <option key={u._id} value={u._id}>
              {u.unitNumber}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex gap-2">
        <Btn
          variant="pri"
          sm
          disabled={busy || !unitId}
          onClick={async () => {
            setBusy(true);
            try {
              await resolve({ requestId: row._id, unitId: unitId as Id<"units"> });
              toast("Resolved and re-routed.");
              onDone();
            } catch (e) {
              toast(errorMessage(e), "error");
              setBusy(false);
            }
          }}
        >
          Resolve and re-route
        </Btn>
        <Btn sm onClick={onDone} disabled={busy}>
          Cancel
        </Btn>
      </div>
    </div>
  );
}

function FallbackForm({ row, onDone }: { row: Row; onDone: () => void }) {
  const toast = useToast();
  const approve = useMutation(api.maintenance.approveFallback);
  const team = useQuery(api.team.overview);
  const [userId, setUserId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const people = (team?.members ?? []).filter(
    (m) => m.jobRoles.includes("asset_manager") || m.jobRoles.includes("maintenance_lead"),
  );

  return (
    <div className="mt-2 flex flex-col gap-2.5 rounded-xl bg-muted p-3">
      <p className="text-xs text-muted-foreground">
        This person handles this one request only. The note goes in the audit trail.
      </p>
      <Field label="Handled by">
        <Select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Handled by">
          <option value="">Select a person…</option>
          {people.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Note (required)">
        <Textarea value={note} maxLength={450} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
      </Field>
      <div className="flex gap-2">
        <Btn
          variant="pri"
          sm
          disabled={busy || !userId || !note.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await approve({ requestId: row._id, userId: userId as Id<"users">, note: note.trim() });
              toast("Fallback approved.");
              onDone();
            } catch (e) {
              toast(errorMessage(e), "error");
              setBusy(false);
            }
          }}
        >
          Approve fallback
        </Btn>
        <Btn sm onClick={onDone} disabled={busy}>
          Cancel
        </Btn>
      </div>
    </div>
  );
}

/** "N requests need routing" list (A14). Admin only; Pat resolves each to a unit or approves a fallback. */
export function ExceptionsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows = useExceptionRows(open);
  const [active, setActive] = useState<{ id: string; mode: "resolve" | "fallback" } | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows ?? []) {
      const key = r.routeReason ?? "other";
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <Drawer open={open} onClose={onClose} eyebrow="Needs routing" title="Requests that could not be routed">
      {rows === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing needs routing.</p>
      ) : (
        groups.map(([reason, items]) => (
          <DrawerSection key={reason} title={`${REASON_LABEL[reason] ?? reason} (${items.length})`}>
            <div className="flex flex-col gap-2.5">
              {items.map((r) => (
                <Card key={r._id} className="!px-3.5 !py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <SevChip level={r.severity} score={r.severityScore ?? undefined} />
                    <Link href={`/maintenance/${r._id}`} className="font-mono font-medium hover:underline">
                      {mrId(r.number)}
                    </Link>
                    <span className="text-xs text-muted-foreground">{fmtDateTime(r.createdAt)}</span>
                  </div>
                  <p className="mt-1.5 text-[13.5px]">{r.description}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.callerName ?? "Unknown caller"}
                    {r.spokenAddress || r.spokenUnit
                      ? ` · said: ${[r.spokenAddress, r.spokenUnit && `unit ${r.spokenUnit}`].filter(Boolean).join(", ")}`
                      : ""}
                    {r.propertyName ? ` · ${r.propertyName}` : ""}
                    {r.assignedAssetManagerName ? ` · AM: ${r.assignedAssetManagerName}` : ""}
                  </p>
                  {active?.id === r._id && active.mode === "resolve" ? (
                    <ResolveForm row={r} onDone={() => setActive(null)} />
                  ) : active?.id === r._id && active.mode === "fallback" ? (
                    <FallbackForm row={r} onDone={() => setActive(null)} />
                  ) : (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <Btn variant="pri" sm onClick={() => setActive({ id: r._id, mode: "resolve" })}>
                        Resolve to unit
                      </Btn>
                      {reason === "unit has no asset manager" ? (
                        <Link
                          href="/properties"
                          className="inline-flex items-center rounded-[10px] border border-border px-2.5 py-[5px] text-[12.5px] font-medium hover:bg-muted"
                        >
                          Assign AM to unit
                        </Link>
                      ) : null}
                      {reason === "AM unavailable" ? (
                        <Btn sm onClick={() => setActive({ id: r._id, mode: "fallback" })}>
                          Approve fallback
                        </Btn>
                      ) : null}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </DrawerSection>
        ))
      )}
      <Link href="/maintenance/exceptions" className="text-[13px] font-medium text-primary hover:underline">
        Open the full exceptions page →
      </Link>
    </Drawer>
  );
}
