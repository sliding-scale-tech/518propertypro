"use client";

import { useMutation, useQuery } from "convex/react";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ResidentModal } from "@/components/residents/resident-modal";
import { useResidentActions } from "@/components/residents/use-resident-actions";
import { errorMessage, useToast } from "@/components/toast";
import { Btn, Card, CardHead, DataTable, Input, Pill, Select, type Column } from "@/components/ui";

/** Tenant directory used to recognise callers. Embedded in the Tenants page (Residents tab). */
export function ResidentsList() {
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

  type Row = NonNullable<typeof residents>[number];
  // The server may omit contact details for some viewers: hide the column when nothing came back.
  const showPhones = residents?.some((r) => (r.phones?.length ?? 0) > 0) ?? false;
  const showEmail = residents?.some((r) => !!r.email) ?? false;

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Name",
      render: (r) => (
        <Link href={`/residents/${r._id}`} className="font-semibold hover:text-primary hover:underline">
          {r.fullName}
        </Link>
      ),
    },
    { key: "unit", header: "Property / unit", render: (r) => `${r.propertyName} · ${r.unitNumber}` },
  ];
  if (showPhones) {
    columns.push({ key: "phones", header: "Phones", className: "tabular-nums", render: (r) => r.phones?.join(", ") || "—" });
  }
  if (showEmail) columns.push({ key: "email", header: "Email", render: (r) => r.email ?? "—" });
  columns.push(
    { key: "lease", header: "Lease end", className: "tabular-nums", render: (r) => r.leaseEnd ?? "—" },
    {
      key: "status",
      header: "Status",
      render: (r) => <Pill tone={r.active ? "ok" : "neutral"}>{r.active ? "Active" : "Inactive"}</Pill>,
    },
  );
  if (isAdmin) {
    columns.push({
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      render: (r) => (
        <div className="flex justify-end gap-2">
          <Btn sm onClick={() => actions.edit(r)}>
            Edit
          </Btn>
          {r.active ? (
            <Btn sm variant="dng" onClick={() => actions.deactivate(r)}>
              Deactivate
            </Btn>
          ) : null}
        </div>
      ),
    });
  }

  return (
    <Card>
      <CardHead
        title="Residents"
        hint="Tenant directory used to recognise callers."
        right={
          isAdmin ? (
            <Btn variant="pri" sm onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add resident
            </Btn>
          ) : undefined
        }
      />
      <div className="mb-3.5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, unit or phone"
            aria-label="Search residents"
            className="pl-9"
          />
        </div>
        <Select
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          aria-label="Filter by property"
          className="sm:w-56"
        >
          <option value="all">All properties</option>
          {(properties ?? []).map((p) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Include inactive
        </label>
      </div>

      {residents === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <DataTable caption="Residents" columns={columns} rows={residents} rowKey={(r) => r._id} empty="No residents found." />
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
              toast(errorMessage(err), "error");
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
    </Card>
  );
}
