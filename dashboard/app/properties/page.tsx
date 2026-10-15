"use client";

import { useMutation, useQuery } from "convex/react";
import { Building2, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { RequireView } from "@/components/require-view";
import { useToast } from "@/components/toast";
import { Modal, btnPrimary, cleanError } from "@/components/maintenance/shared";
import { PropertyForm } from "@/components/properties/property-form";

function PropertiesInner() {
  const toast = useToast();
  const access = useQuery(api.team.myAccess);
  const properties = useQuery(api.properties.list);
  const create = useMutation(api.properties.create);
  const isAdmin = access?.view === "admin";
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Properties</h1>
          <p className="mt-1 text-sm text-muted-foreground">Buildings, their units and utility contacts.</p>
        </div>
        {isAdmin ? (
          <button className={btnPrimary} onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Add property
          </button>
        ) : null}
      </header>

      {properties === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : properties.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <Building2 className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm">No properties yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/45 text-left text-[11px] tracking-wide text-muted-foreground uppercase">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 font-medium">Units</th>
                <th className="px-4 py-3 font-medium">Gas utility phone</th>
              </tr>
            </thead>
            <tbody>
              {properties.map((p) => (
                <tr key={p._id} className="border-b border-border last:border-0 hover:bg-accent/40">
                  <td className="px-4 py-3 font-semibold">
                    <Link href={`/properties/${p._id}`} className="hover:underline">
                      {p.name}
                    </Link>
                    {p.isPilot ? (
                      <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                        Pilot
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{p.address?.formatted ?? "—"}</td>
                  <td className="px-4 py-3 tabular-nums">{p.unitCount}</td>
                  <td className="px-4 py-3 tabular-nums">{p.utilityGasPhone ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding ? (
        <Modal title="Add property" onClose={() => setAdding(false)}>
          <PropertyForm
            initial={{ name: "", address: null, isPilot: false, gasPhone: "" }}
            submitLabel="Add property"
            busy={busy}
            onCancel={() => setAdding(false)}
            onSubmit={async (v) => {
              setBusy(true);
              try {
                await create({
                  name: v.name,
                  address: v.address ?? undefined,
                  isPilot: v.isPilot,
                  utilityGasPhone: v.gasPhone || undefined,
                });
                toast("Property added");
                setAdding(false);
              } catch (err) {
                toast(cleanError(err), "error");
              } finally {
                setBusy(false);
              }
            }}
          />
        </Modal>
      ) : null}
    </div>
  );
}

export default function PropertiesPage() {
  return (
    <RequireView views={["admin", "asset_manager", "accountant"]}>
      <PropertiesInner />
    </RequireView>
  );
}
