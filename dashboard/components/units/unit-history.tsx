"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Manager } from "./types";

/**
 * Mounted ONLY for admin/executive viewers (the query throws for anyone else), and only while a
 * row is expanded, so it is never subscribed otherwise.
 */
export function UnitHistory({ unitId, managers }: { unitId: Id<"units">; managers: Manager[] }) {
  const events = useQuery(api.audit.forEntity, { entity: "unit", entityId: unitId });
  const nameOf = (id?: string) => managers.find((m) => m.userId === id)?.name ?? "a former manager";

  if (events === undefined) return <p className="text-xs text-muted-foreground">Loading history…</p>;
  const changes = events.filter((e) => e.action === "am_changed" || e.action === "unit_created");
  if (changes.length === 0) {
    return <p className="text-xs text-muted-foreground">No asset manager changes recorded.</p>;
  }
  return (
    <ul className="space-y-1.5 text-xs">
      {changes.map((e) => (
        <li key={e._id} className="flex flex-wrap gap-x-2">
          <span className="tabular-nums text-muted-foreground">{new Date(e.at).toLocaleString()}</span>
          <span>
            {e.action === "unit_created"
              ? `Created by ${e.actorLabel}`
              : `${e.actorLabel} changed asset manager from ${nameOf(e.from)} to ${nameOf(e.to)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
