"use client";

import { useMutation, useQuery } from "convex/react";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RequireView } from "@/components/require-view";
import { useToast } from "@/components/toast";
import { btnOutline, btnPrimary, cleanError, inputClass } from "@/components/maintenance/shared";
import { ResidentModal } from "@/components/residents/resident-modal";
import { useResidentActions } from "@/components/residents/use-resident-actions";

function ResidentsInner() {
  const toast = useToast();
  const access = useQuery(api.team.myAccess);
  const isAdmin = access?.view === "admin";
  const properties = useQuery(api.properties.list);
  const create = useMutation(api.residents.create);
  const actions = useResidentActions();

  const [search, setSearch] = useState("");
  const [propertyId, setPropertyId] = useState("all");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const residents = useQuery(api.residents.list, {
    propertyId: propertyId === "all" ? undefined : (propertyId as Id<"properties">),
    search: search.trim() || undefined,
    includeInactive,
  });

  // The server may omit contact details for some viewers: hide the column when nothing came back.
  const showPhones = residents?.some((r) => (r.phones?.length ?? 0) > 0) ?? false;
  const showEmail = residents?.some((r) => !!r.email) ?? false;

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Residents</h1>
          <p className="mt-1 text-sm text-muted-foreground">Tenant directory used to recognise callers.</p>
        </div>
        {isAdmin ? (
          <button className={btnPrimary} onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Add resident
          </button>
        ) : null}
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, unit or phone"
            aria-label="Search residents"
            className={`${inputClass} pl-9`}
          />
        </div>
        <select
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          aria-label="Filter by property"
          className={`${inputClass} sm:w-56`}
        >
          <option value="all">All properties</option>
          {(properties ?? []).map((p) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
            className="h-4 w-4 accent-blue-600"
          />
          Include inactive
        </label>
      </div>

      {residents === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : residents.length === 0 ? (
        <p className="rounded-xl border border-border py-10 text-center text-sm text-muted-foreground">
          No residents found.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/45 text-left text-[11px] tracking-wide text-muted-foreground uppercase">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Property / unit</th>
                {showPhones ? <th className="px-4 py-3 font-medium">Phones</th> : null}
                {showEmail ? <th className="px-4 py-3 font-medium">Email</th> : null}
                <th className="px-4 py-3 font-medium">Lease end</th>
                <th className="px-4 py-3 font-medium">Status</th>
                {isAdmin ? <th className="px-4 py-3 font-medium">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {residents.map((r) => (
                <tr key={r._id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-semibold">
                    <Link href={`/residents/${r._id}`} className="hover:underline">
                      {r.fullName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {r.propertyName} · {r.unitNumber}
                  </td>
                  {showPhones ? <td className="px-4 py-3 tabular-nums">{r.phones?.join(", ") || "—"}</td> : null}
                  {showEmail ? <td className="px-4 py-3">{r.email ?? "—"}</td> : null}
                  <td className="px-4 py-3 tabular-nums">{r.leaseEnd ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        r.active ? "bg-emerald-50 text-emerald-600" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {r.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  {isAdmin ? (
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button className={btnOutline} onClick={() => actions.edit(r)}>
                          Edit
                        </button>
                        {r.active ? (
                          <button className={btnOutline} onClick={() => actions.deactivate(r)}>
                            Deactivate
                          </button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isAdmin ? actions.dialogs : null}

      {adding ? (
        <ResidentModal
          title="Add resident"
          unitOptions={actions.unitOptions}
          busy={busy}
          initial={{ unitId: "", fullName: "", phones: [], email: "", leaseEnd: "" }}
          onClose={() => setAdding(false)}
          onSubmit={async (v) => {
            setBusy(true);
            try {
              await create({
                unitId: v.unitId as Id<"units">,
                fullName: v.fullName,
                phones: v.phones,
                email: v.email || undefined,
                leaseEnd: v.leaseEnd || undefined,
              });
              toast("Resident added");
              setAdding(false);
            } catch (err) {
              toast(cleanError(err), "error");
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}

export default function ResidentsPage() {
  return (
    <RequireView views={["admin", "asset_manager", "accountant"]}>
      <ResidentsInner />
    </RequireView>
  );
}
