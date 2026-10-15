"use client";

import { Suspense } from "react";
import { RequireView } from "@/components/require-view";
import { PropertyPage } from "@/components/properties/property-page";

export default function PropertiesPage() {
  return (
    <RequireView views={["admin", "asset_manager", "accountant"]}>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <PropertyPage />
      </Suspense>
    </RequireView>
  );
}
