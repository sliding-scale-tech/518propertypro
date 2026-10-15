"use client";

import { useQuery } from "convex/react";
import { DoorOpen } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RequireView } from "@/components/require-view";
import { inputClass } from "@/components/units/types";
import { UnitsManager } from "@/components/units/units-manager";

function UnitsPageInner() {
  const properties = useQuery(api.properties.list);
  const [picked, setPicked] = useState<string>("");

  if (properties === undefined) return <p className="py-10 text-sm text-muted-foreground">Loading…</p>;

  // Fall back to the first property until the viewer picks one.
  const propertyId: Id<"properties"> | undefined =
    properties.find((p) => p._id === picked)?._id ?? properties[0]?._id;

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Units</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every unit has exactly one asset manager.</p>
        </div>
        {properties.length > 1 ? (
          <select
            value={propertyId ?? ""}
            onChange={(e) => setPicked(e.target.value)}
            aria-label="Property"
            className={`${inputClass} sm:w-64`}
          >
            {properties.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : null}
      </header>
      {propertyId ? (
        <UnitsManager key={propertyId} propertyId={propertyId} />
      ) : (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <DoorOpen className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm">Create a property before adding units.</p>
          <Link href="/properties" className="mt-2 inline-block text-sm font-semibold text-primary underline">
            Go to Properties
          </Link>
        </div>
      )}
    </div>
  );
}

export default function UnitsPage() {
  return (
    <RequireView views={["admin", "asset_manager", "accountant"]}>
      <UnitsPageInner />
    </RequireView>
  );
}
