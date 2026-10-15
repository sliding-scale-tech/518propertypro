"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AlertTriangle, Download, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { RequireView } from "@/components/require-view";
import { PriorityBadge, STATUS_META, StatusPill, type WoStatus } from "@/components/work-orders/shared";

type Row = FunctionReturnType<typeof api.workOrders.list>[number];

const selectClass =
  "h-10 rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/20";

const BOARD: Array<{ status: WoStatus; label: string }> = [
  { status: "created", label: "Created" },
  { status: "assigned", label: "Assigned" },
  { status: "in_progress", label: "In progress" },
  { status: "completed", label: "Completed" },
  { status: "reviewed_closed", label: "Closed" },
];

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Quotes a CSV cell and neutralises spreadsheet formulas (=, +, -, @). */
function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function exportCsv(rows: Row[]) {
  const header = ["WO number", "Property", "Unit", "Title", "Technician", "Priority", "Status", "Checklist", "Overdue", "Due", "Updated"];
  const lines = rows.map((r) =>
    [
      `WO-${r.number}`,
      r.propertyName ?? "",
      r.unitNumber ?? "",
      r.title,
      r.technicianName ?? "",
      r.priority,
      STATUS_META[r.status].label,
      `${r.checklistDone}/${r.checklistTotal}`,
      r.isOverdue ? "Yes" : "No",
      r.dueDate ? new Date(r.dueDate).toISOString().slice(0, 10) : "",
      new Date(r.updatedAt).toISOString(),
    ]
      .map(csvCell)
      .join(","),
  );
  const blob = new Blob([[header.map(csvCell).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "work-orders.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function WorkOrdersInner() {
  const rows = useQuery(api.workOrders.list, {}) as Row[] | undefined;
  const access = useQuery(api.team.myAccess);
  const team = useQuery(api.team.overview);

  const [status, setStatus] = useState("");
  const [technician, setTechnician] = useState("");
  const [property, setProperty] = useState("");
  const [priority, setPriority] = useState("");
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"table" | "board">("table");

  const canCreate = access?.view === "admin" || access?.view === "asset_manager";
  const technicians = (team?.members ?? []).filter((m) => m.appRole === "technician");
  const properties = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows ?? []) map.set(r.propertyId, r.propertyName ?? "Unknown");
    return [...map.entries()];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/^wo-?/, "");
    return (rows ?? []).filter((r) => {
      if (status && r.status !== status) return false;
      if (technician && r.technicianUserId !== technician) return false;
      if (property && r.propertyId !== property) return false;
      if (priority && r.priority !== priority) return false;
      if (q && !String(r.number).includes(q) && !(r.unitNumber ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, status, technician, property, priority, search]);

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Work orders</h1>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
            Track every job from creation to review and close-out.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => exportCsv(filtered)}
            disabled={filtered.length === 0}
            className="flex h-11 items-center gap-2 rounded-lg border border-input bg-card px-4 text-sm font-medium hover:bg-accent disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
          {canCreate ? (
            <Link
              href="/work-orders/new"
              className="flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              New work order
            </Link>
          ) : null}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="WO number or unit"
            aria-label="Search work orders"
            className={`${selectClass} w-52 pl-9`}
          />
        </div>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
          <option value="">All statuses</option>
          {(Object.keys(STATUS_META) as WoStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </select>
        <select aria-label="Technician" value={technician} onChange={(e) => setTechnician(e.target.value)} className={selectClass}>
          <option value="">All technicians</option>
          {technicians.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
        <select aria-label="Property" value={property} onChange={(e) => setProperty(e.target.value)} className={selectClass}>
          <option value="">All properties</option>
          {properties.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={selectClass}>
          <option value="">All priorities</option>
          <option value="emergency">Emergency</option>
          <option value="urgent">Urgent</option>
          <option value="routine">Routine</option>
        </select>
        <div className="ml-auto flex rounded-lg border border-input bg-card p-0.5 text-sm">
          {(["table", "board"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1.5 font-medium capitalize ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {rows === undefined ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center text-sm text-muted-foreground">
          No work orders match.
        </div>
      ) : mode === "table" ? (
        <TableView rows={filtered} />
      ) : (
        <BoardView rows={filtered} />
      )}
    </div>
  );
}

function ChecklistCount({ row }: { row: Row }) {
  return (
    <span className="tabular-nums text-muted-foreground">
      {row.checklistDone}/{row.checklistTotal}
    </span>
  );
}

function Overdue() {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700">
      <AlertTriangle className="h-3 w-3" />
      Overdue
    </span>
  );
}

function TableView({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
          <tr>
            {["WO", "Unit", "Title", "Technician", "Priority", "Status", "Checklist", "Updated"].map((h) => (
              <th key={h} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r._id} className="border-t border-border/70 hover:bg-muted/30">
              <td className="px-4 py-3 font-semibold">
                <Link href={`/work-orders/${r._id}`} className="text-primary hover:underline">
                  WO-{r.number}
                </Link>
              </td>
              <td className="px-4 py-3">
                <div>{r.unitNumber}</div>
                <div className="text-xs text-muted-foreground">{r.propertyName}</div>
              </td>
              <td className="max-w-[260px] truncate px-4 py-3">{r.title}</td>
              <td className="px-4 py-3">{r.technicianName ?? <span className="text-muted-foreground">Unassigned</span>}</td>
              <td className="px-4 py-3">
                <PriorityBadge priority={r.priority} />
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusPill status={r.status} />
                  {r.isOverdue ? <Overdue /> : null}
                </div>
              </td>
              <td className="px-4 py-3">
                <ChecklistCount row={r} />
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{fmtDate(r.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoardView({ rows }: { rows: Row[] }) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {BOARD.map((col) => {
        const items = rows.filter((r) => r.status === col.status);
        return (
          <div key={col.status} className="w-72 shrink-0 rounded-2xl border border-border bg-muted/30">
            <div className="flex items-center justify-between px-4 py-3 text-sm font-semibold">
              {col.label}
              <span className="text-muted-foreground">{items.length}</span>
            </div>
            <div className="space-y-2 px-2 pb-2">
              {items.map((r) => (
                <Link
                  key={r._id}
                  href={`/work-orders/${r._id}`}
                  className="block space-y-2 rounded-xl border border-border bg-card p-3 shadow-sm hover:border-primary/40"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-primary">WO-{r.number}</span>
                    <PriorityBadge priority={r.priority} />
                  </div>
                  <div className="truncate text-sm">{r.title}</div>
                  <div className="text-xs text-muted-foreground">
                    Unit {r.unitNumber} · {r.technicianName ?? "Unassigned"}
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <ChecklistCount row={r} />
                    {r.isOverdue ? <Overdue /> : null}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function WorkOrdersPage() {
  return (
    <RequireView views={["admin", "asset_manager", "accountant"]}>
      <WorkOrdersInner />
    </RequireView>
  );
}
