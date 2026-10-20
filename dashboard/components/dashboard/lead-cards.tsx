"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";
import { PhoneIncoming, UserCheck, Users } from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { Kpi, KpiRow } from "@/components/ui";
import { isUnassigned } from "@/components/leads/lead-assignment";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Newest leads (the same query the Leads page reads), kept to the last 7 days. */
function useRecentLeads() {
  const { results, status } = usePaginatedQuery(api.conversations.history, {}, { initialNumItems: 50 });
  const [since] = useState(() => Date.now() - WEEK_MS);
  return { loading: status === "LoadingFirstPage", rows: (results ?? []).filter((c) => c.startedAt >= since) };
}

/** Admin: how many of this week's leads have an owner. */
export function AdminLeadsCard() {
  const { loading, rows } = useRecentLeads();
  const unassigned = rows.filter(isUnassigned).length;
  return (
    <KpiRow>
      <Link href="/leads" className="block">
        <Kpi
          icon={<Users />}
          label="Leads this week"
          value={loading ? "—" : rows.length}
          sub={loading ? undefined : `${rows.length - unassigned} assigned · ${unassigned} unassigned`}
          subTone={!loading && unassigned > 0 ? "down" : "muted"}
        />
      </Link>
    </KpiRow>
  );
}

/** Asset manager: callbacks still to make, and leads assigned to them this week. */
export function AmLeadCards() {
  const callbacks = useQuery(api.leads.callbacks, { status: "open" });
  const { loading, rows } = useRecentLeads();
  const mine = rows.filter((r) => r.assignedToMe).length;
  return (
    <KpiRow>
      <Link href="/tenants?tab=callbacks" className="block">
        <Kpi
          icon={<PhoneIncoming />}
          label="Callbacks to make"
          value={callbacks?.length ?? "—"}
          sub={callbacks ? (callbacks.length > 0 ? "From callers Sarah couldn't match" : "All caught up") : undefined}
          subTone={callbacks && callbacks.length > 0 ? "down" : "muted"}
        />
      </Link>
      <Link href="/leads?filter=mine" className="block">
        <Kpi
          icon={<UserCheck />}
          label="New leads assigned to you"
          value={loading ? "—" : mine}
          sub="Last 7 days"
        />
      </Link>
    </KpiRow>
  );
}
