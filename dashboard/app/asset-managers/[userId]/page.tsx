"use client";

import { useParams } from "next/navigation";
import { Suspense } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { RequireView } from "@/components/require-view";
import { ProfileView } from "@/components/asset-managers/profile-view";

export default function AssetManagerProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  return (
    <RequireView views={["admin"]}>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <ProfileView userId={userId as Id<"users">} />
      </Suspense>
    </RequireView>
  );
}
