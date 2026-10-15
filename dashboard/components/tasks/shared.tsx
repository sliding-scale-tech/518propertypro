"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useMemo } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type Member = { userId: Id<"users">; name: string; imageUrl: string | null };

export const UNASSIGNED = "none";

/** Team members from team.overview, for the assignee pickers. Empty until loaded. */
export function useMembers(): Member[] {
  const overview = useQuery(api.team.overview);
  return useMemo(
    () =>
      (overview?.members ?? []).map((m) => ({
        userId: m.userId,
        name: m.name,
        imageUrl: m.imageUrl,
      })),
    [overview],
  );
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "")).toUpperCase();
}

/** Small round avatar: photo when present, initials otherwise. */
export function AssigneeAvatar({ member }: { member: Member }) {
  return (
    <span
      title={member.name}
      className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-[10px] font-semibold text-primary"
    >
      {member.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={member.imageUrl} alt={member.name} className="h-full w-full object-cover" />
      ) : (
        initialsOf(member.name)
      )}
    </span>
  );
}

/** Display-only links to the records a task is about; renders nothing when there are none. */
export function TaskLinks({
  unitId,
  requestId,
  workOrderId,
}: {
  unitId?: Id<"units">;
  requestId?: Id<"maintenanceRequests">;
  workOrderId?: Id<"workOrders">;
}) {
  if (!unitId && !requestId && !workOrderId) return null;
  const cls = "rounded bg-muted px-2 py-1 text-xs font-medium text-primary hover:underline";
  return (
    <div className="flex flex-wrap gap-2">
      {unitId ? (
        <Link href="/properties" className={cls}>
          Unit
        </Link>
      ) : null}
      {requestId ? (
        <Link href={`/maintenance/${requestId}`} className={cls}>
          Maintenance request
        </Link>
      ) : null}
      {workOrderId ? (
        <Link href={`/work-orders/${workOrderId}`} className={cls}>
          Work order
        </Link>
      ) : null}
    </div>
  );
}
