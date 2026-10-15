"use client";

import { useQuery } from "convex/react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RequireView } from "@/components/require-view";
import { Board, ClosedTable, type ItemRef } from "@/components/board/board";
import { ExceptionsDrawer } from "@/components/board/exceptions-drawer";
import { ItemDrawer } from "@/components/board/item-drawer";
import { NewWorkOrderDrawer } from "@/components/board/new-wo-drawer";
import { LANES, type Lane } from "@/components/board/shared";
import { Btn, Chips, PageHeader, Pill, Select } from "@/components/ui";

const LANE_LABEL: Record<Lane | "all", string> = {
  all: "All lanes",
  review: "Asset manager review",
  pat: "Waiting on lead",
  tech: "With technician",
  signoff: "Needs sign-off",
};

function WorkOrdersInner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const laneParam = params.get("lane");
  const lane: Lane | null = LANES.includes(laneParam as Lane) ? (laneParam as Lane) : null;
  const amParam = params.get("am");

  const access = useQuery(api.team.myAccess);
  const team = useQuery(api.team.overview);
  const properties = useQuery(api.properties.list);
  const isAdmin = access?.view === "admin";
  const canCreate = access?.view === "admin" || access?.view === "asset_manager";

  // Only pass an `am` that is a real team member: the query arg is a typed id, and a hand-edited
  // URL must not crash the page. (Asset managers are scoped server-side regardless.)
  const amMember = isAdmin ? team?.members.find((m) => m.userId === amParam) : undefined;
  const [propertyId, setPropertyId] = useState("");

  const data = useQuery(api.board.lanes, {
    propertyId: propertyId ? (propertyId as Id<"properties">) : undefined,
    assetManagerUserId: amMember ? (amMember.userId as Id<"users">) : undefined,
  });

  const [item, setItem] = useState<ItemRef | null>(null);
  const [itemOpen, setItemOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [excOpen, setExcOpen] = useState(false);

  // Deep link: ?open=request:{id} or ?open=work_order:{id} opens that item's drawer.
  const deepMatch = /^(request|work_order):([A-Za-z0-9_-]{10,64})$/.exec(params.get("open") ?? "");
  const deepItem: ItemRef | null = deepMatch ? { kind: deepMatch[1] as ItemRef["kind"], id: deepMatch[2] } : null;

  const setQuery = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const leads = data?.maintenanceLeads ?? [];
  const leadName = leads.length === 1 ? leads[0].name : "maintenance lead";
  const exceptionCount = data?.exceptions.count ?? 0;

  return (
    <div className="pb-10">
      <PageHeader
        title="Work orders"
        subtitle={
          isAdmin
            ? "Sarah turns maintenance calls into requests. Asset managers validate them, you create the work order, technicians close it out from their phones."
            : access?.view === "accountant"
              ? "Read-only view of completed and closed work, with hours and materials."
              : "Requests for the units you manage. Approve what’s real, ask for photos when it’s unclear."
        }
        actions={
          canCreate ? (
            <Btn variant="pri" onClick={() => setNewOpen(true)}>
              ＋ New work order
            </Btn>
          ) : null
        }
      />

      {isAdmin && exceptionCount > 0 ? (
        <button
          type="button"
          onClick={() => setExcOpen(true)}
          className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-danger-ink/30 bg-danger-soft px-4 py-3 text-left text-danger-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-[13.5px] font-medium">
            {exceptionCount} {exceptionCount === 1 ? "request needs" : "requests need"} routing
          </span>
          <span className="inline-flex items-center gap-1 text-[13px]">
            Review <ChevronRight aria-hidden className="h-4 w-4" />
          </span>
        </button>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Chips
          label="Lane"
          value={(lane ?? "all") as Lane | "all"}
          options={(["all", ...LANES] as Array<Lane | "all">).map((l) => ({ value: l, label: LANE_LABEL[l] }))}
          onChange={(v) => setQuery("lane", v === "all" ? null : v)}
        />
        {(properties ?? []).length > 1 ? (
          <Select
            aria-label="Property"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className="!w-auto min-w-44"
          >
            <option value="">All properties</option>
            {(properties ?? []).map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </Select>
        ) : null}
        {amMember ? (
          <Pill tone="acc">
            Asset manager: {amMember.name}
            <button
              type="button"
              onClick={() => setQuery("am", null)}
              aria-label="Clear asset manager filter"
              className="ml-1 font-semibold hover:underline"
            >
              Clear
            </button>
          </Pill>
        ) : null}
      </div>

      {data === undefined ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : data.scope === "none" ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center text-sm text-muted-foreground">
          There is no work order board for your role.
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <Board
            data={data}
            lane={lane}
            onOpen={(ref) => {
              setItem(ref);
              setItemOpen(true);
            }}
          />
          <ClosedTable
            data={data.closedThisMonth}
            onOpen={(ref) => {
              setItem(ref);
              setItemOpen(true);
            }}
          />
        </div>
      )}

      <ItemDrawer
        item={deepItem ?? item}
        open={deepItem !== null || itemOpen}
        onClose={() => {
          setItemOpen(false);
          if (deepItem) setQuery("open", null);
        }}
        leadName={leadName}
      />
      {canCreate ? (
        <NewWorkOrderDrawer open={newOpen} onClose={() => setNewOpen(false)} leadName={leadName} />
      ) : null}
      {isAdmin ? <ExceptionsDrawer open={excOpen} onClose={() => setExcOpen(false)} /> : null}
    </div>
  );
}

export default function WorkOrdersPage() {
  return (
    <RequireView views={["admin", "asset_manager", "accountant"]}>
      <Suspense fallback={null}>
        <WorkOrdersInner />
      </Suspense>
    </RequireView>
  );
}
