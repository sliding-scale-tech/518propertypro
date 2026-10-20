"use client";

import { useParams } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import { RequireView } from "@/components/require-view";
import { ManagerCalendar } from "@/components/asset-managers/manager-calendar";

export default function AssetManagerCalendarPage() {
  const { userId } = useParams<{ userId: string }>();
  return (
    <RequireView views={["admin"]}>
      <ManagerCalendar userId={userId as Id<"users">} />
    </RequireView>
  );
}
