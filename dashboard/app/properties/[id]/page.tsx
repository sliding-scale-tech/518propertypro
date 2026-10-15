"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RequireView } from "@/components/require-view";
import { useToast } from "@/components/toast";
import { cleanError } from "@/components/maintenance/shared";
import { PropertyForm } from "@/components/properties/property-form";
import { UnitsManager } from "@/components/units/units-manager";

function PropertyDetail({ id }: { id: Id<"properties"> }) {
  const toast = useToast();
  const access = useQuery(api.team.myAccess);
  const properties = useQuery(api.properties.list);
  const update = useMutation(api.properties.updateProfile);
  const [busy, setBusy] = useState(false);
  const property = properties?.find((p) => p._id === id);

  if (properties === undefined) return <p className="py-10 text-sm text-muted-foreground">Loading…</p>;
  if (!property) return <p className="py-10 text-sm text-muted-foreground">Property not found.</p>;

  return (
    <div className="space-y-8 pb-10">
      <div>
        <Link href="/properties" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="h-4 w-4" />
          Properties
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{property.name}</h1>
      </div>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">Profile</h2>
        {/* key remounts the form with fresh values after a save or a remote change. */}
        <PropertyForm
          key={`${property.updatedAt}`}
          initial={{
            name: property.name,
            address: property.address ?? null,
            isPilot: property.isPilot,
            gasPhone: property.utilityGasPhone ?? "",
          }}
          submitLabel="Save profile"
          busy={busy}
          readOnly={access?.view !== "admin"}
          onSubmit={async (v) => {
            setBusy(true);
            try {
              await update({
                propertyId: id,
                name: v.name,
                address: v.address ?? undefined,
                isPilot: v.isPilot,
                ...(v.gasPhone ? { utilityGasPhone: v.gasPhone } : { clearGasPhone: true }),
              });
              toast("Profile saved");
            } catch (err) {
              toast(cleanError(err), "error");
            } finally {
              setBusy(false);
            }
          }}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">Units</h2>
        <UnitsManager propertyId={id} />
      </section>
    </div>
  );
}

export default function PropertyDetailPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireView views={["admin", "asset_manager", "accountant"]}>
      <PropertyDetail id={params.id as Id<"properties">} />
    </RequireView>
  );
}
