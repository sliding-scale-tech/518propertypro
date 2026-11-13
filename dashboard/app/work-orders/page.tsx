"use client";

import { useQuery } from "convex/react";
import { Columns3, LayoutList, Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RequireView, rolesOfAccess } from "@/components/require-view";
import { Kanban, StatusChips, WorkOrderTable, type ItemRef } from "@/components/board/board";
import { ExceptionsDrawer } from "@/components/board/exceptions-drawer";
import { NewWorkOrderDrawer } from "@/components/board/new-wo-drawer";
import { PRIORITY_LEVELS, tableStatusFromParam, type Severity, type TableStatus } from "@/components/board/shared";
import { WorkOrderDrawer } from "@/components/board/wo-drawer";
import { Btn, FilterSelect, FilterToolbar, SearchBox, cx, useUrlPaging } from "@/components/ui";
import { KANBAN_STEP } from "@/components/board/board";

type View = "table" | "kanban";
const VIEW_KEY = "wo-view";

function readStoredView(): View | null {
  try {
    const v = window.localStorage.getItem(VIEW_KEY);
    return v === "table" || v === "kanban" ? v : null;
  } catch {
    return null;
  }
}

const viewListeners = new Set<() => void>();
function subscribeView(cb: () => void) {
  viewListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    viewListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function WorkOrdersInner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const access = useQuery(api.team.myAccess);
  // Role set (B31): anyone holding asset manager gets the AM board, whatever else they hold.
  const roles = rolesOfAccess(access);
  const isAdmin = roles.includes("admin");
  const isAm = roles.includes("asset_manager");
  const canCreate = isAdmin || isAm;
  const noBoard = access !== undefined && !canCreate;
  const team = useQuery(api.team.overview);

  // Deep links: ?lane= (old and new values), ?am=, ?view=, ?open=request:{id}|work_order:{id}.
  const laneParam = params.get("lane");
  const status: TableStatus = tableStatusFromParam(laneParam);
  const amParam = params.get("am");
  const amMember = isAdmin ? team?.members.find((m) => m.userId === amParam) : undefined;
  const deepMatch = /^(request|work_order):([A-Za-z0-9_-]{10,64})$/.exec(params.get("open") ?? "");
  const deepItem: ItemRef | null = deepMatch ? { kind: deepMatch[1] as ItemRef["kind"], id: deepMatch[2] } : null;

  const viewParam = params.get("view");
  const stored = useSyncExternalStore(subscribeView, readStoredView, () => null);
  const view: View =
    viewParam === "table" || viewParam === "kanban" ? viewParam : laneParam ? "table" : (stored ?? "kanban");

  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<"all" | Severity>("all");
  const [techId, setTechId] = useState("all");
  // Table page and size live in the URL (?page= / ?size=, default 50).
  const paging = useUrlPaging();
  const { page, pageSize } = paging;
  // Kanban: cards shown per column (each starts at KANBAN_STEP; "Show 20 more" raises one column).
  const [moreCards, setMoreCards] = useState<{ key: string; limits: Record<string, number> }>({ key: "", limits: {} });
  const [item, setItem] = useState<ItemRef | null>(null);
  const [itemOpen, setItemOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [excOpen, setExcOpen] = useState(false);

  // The latest paging controls (they close over the current URL), read inside the timer so a lane,
  // view or drawer change made while it waits is not overwritten with stale params.
  const latestPaging = useRef(paging);
  useEffect(() => {
    latestPaging.current = paging;
  });

  useEffect(() => {
    // Nothing to apply (e.g. on mount, or the text already matches): leave ?page= alone.
    if (searchText.trim() === search) return;
    const t = setTimeout(() => {
      setSearch(searchText.trim());
      latestPaging.current.resetPage();
    }, 300);
    return () => clearTimeout(t);
    // Only typed text and the applied search matter; `paging` is read from a ref.
  }, [searchText, search]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const chooseView = (v: View) => {
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      // storage unavailable: the choice just won't persist
    }
    for (const l of viewListeners) l();
    setParam("view", v);
  };

  const technicians = (team?.members ?? []).filter((m) => m.appRoles.includes("technician"));
  const filters = {
    search: search || undefined,
    priority: priority === "all" ? undefined : priority,
    technicianUserId: isAdmin && techId !== "all" ? (techId as Id<"users">) : undefined,
    assetManagerUserId: amMember ? (amMember.userId as Id<"users">) : undefined,
  };

  // Column limits belong to one set of filters: a different filter starts every column at 20 again.
  const filterKey = JSON.stringify(filters);
  const limits = moreCards.key === filterKey ? moreCards.limits : {};
  const kanban = useQuery(api.board.kanban, view === "kanban" ? { ...filters, limits } : "skip");
  const table = useQuery(api.board.table, view === "table" ? { ...filters, status, page, pageSize } : "skip");
  const data = view === "kanban" ? kanban : table;
  const exceptionCount = kanban?.exceptions.count ?? 0;

  const leads = (team?.members ?? []).filter((m) => m.jobRoles.includes("maintenance_lead"));
  const leadName = leads.length === 1 ? leads[0].name : "maintenance lead";

  const openItem = (ref: ItemRef) => {
    setItem(ref);
    setItemOpen(true);
  };


  return (
    <div className="pb-10">
      <header className="mb-6">
        <h1 className="text-[28px] font-bold tracking-[-0.03em] text-slate-900">Work Orders</h1>
        <p className="mt-1 text-[13.5px] text-slate-500">
          {isAm
            ? "Track the maintenance work orders for your units from review to completion."
            : "Track maintenance work orders from review to completion."}
        </p>
        {isAdmin && exceptionCount > 0 ? (
          <button
            type="button"
            onClick={() => setExcOpen(true)}
            className="mt-1 text-[13px] font-medium text-rose-600 hover:underline"
          >
            {exceptionCount} {exceptionCount === 1 ? "request needs" : "requests need"} routing
          </button>
        ) : null}
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterToolbar
          className="min-w-0 flex-[1_1_480px]"
          active={searchText.trim() !== "" || priority !== "all" || techId !== "all"}
          onClear={() => {
            setSearchText("");
            setPriority("all");
            setTechId("all");
            paging.resetPage();
          }}
          search={
            <SearchBox
              id="wo-search"
              label="Search records"
              value={searchText}
              onChange={setSearchText}
              onClear={() => setSearchText("")}
              placeholder="Search records"
            />
          }
        >
          <FilterSelect
            label="Priority"
            active={priority !== "all"}
            value={priority}
            onChange={(e) => {
              setPriority((e.target.value || "all") as typeof priority);
              paging.resetPage();
            }}
          >
            <option value="all">All</option>
            {PRIORITY_LEVELS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </FilterSelect>
          {isAdmin ? (
            <FilterSelect
              label="Technician"
              active={techId !== "all"}
              value={techId}
              onChange={(e) => {
                setTechId(e.target.value || "all");
                paging.resetPage();
              }}
              className="sm:w-52"
            >
              <option value="all">All</option>
              {technicians.map((t) => (
                <option key={t.userId as string} value={t.userId as string}>
                  {t.name}
                </option>
              ))}
            </FilterSelect>
          ) : null}
        </FilterToolbar>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <div role="group" aria-label="View" className="inline-flex rounded-[10px] border border-slate-200 bg-white p-[3px]">
            {(
              [
                { v: "table", label: "Table", Icon: LayoutList },
                { v: "kanban", label: "Kanban", Icon: Columns3 },
              ] as const
            ).map(({ v, label, Icon }) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => chooseView(v)}
                className={cx(
                  "inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium",
                  view === v ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:bg-slate-50",
                )}
              >
                <Icon aria-hidden className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
          {canCreate ? (
            <Btn variant="pri" className="h-[38px] rounded-[10px] px-4" onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4" /> New Work Order
            </Btn>
          ) : null}
        </div>
      </div>

      {view === "table" && table && !noBoard ? (
        <StatusChips
          value={status}
          counts={table.counts}
          onChange={(v) => {
            const next = new URLSearchParams(params.toString());
            next.delete("page");
            if (v === "all") next.delete("lane");
            else next.set("lane", v);
            const qs = next.toString();
            router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
          }}
        />
      ) : null}

      {noBoard ? (
        <NoBoard />
      ) : data === undefined ? (
        <div className="py-16 text-center text-sm text-slate-500">Loading…</div>
      ) : view === "kanban" && kanban ? (
        kanban.scope === "none" ? (
          <NoBoard />
        ) : (
          <Kanban
            columns={kanban.columns}
            onOpen={openItem}
            capped={kanban.capped}
            cap={kanban.cap}
            onMore={(columnKey, shown) =>
              setMoreCards((m) => ({
                key: filterKey,
                limits: { ...(m.key === filterKey ? m.limits : {}), [columnKey]: shown + KANBAN_STEP },
              }))
            }
          />
        )
      ) : table ? (
        <WorkOrderTable
          data={table}
          onPage={paging.setPage}
          onPageSize={paging.setPageSize}
          onOpen={openItem}
        />
      ) : null}

      <WorkOrderDrawer
        item={deepItem ?? item}
        open={deepItem !== null || itemOpen}
        onClose={() => {
          setItemOpen(false);
          if (deepItem) setParam("open", null);
        }}
        leadName={leadName}
        onSwitch={(ref) => {
          setItem(ref);
          setItemOpen(true);
          if (deepItem) setParam("open", null);
        }}
      />
      {canCreate ? <NewWorkOrderDrawer open={newOpen} onClose={() => setNewOpen(false)} leadName={leadName} /> : null}
      {isAdmin ? <ExceptionsDrawer open={excOpen} onClose={() => setExcOpen(false)} /> : null}
    </div>
  );
}

function NoBoard() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center text-sm text-slate-500">
      There is no work order board for your role.
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
