"use client";

import { useQuery } from "convex/react";
import { Camera, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Dropdown } from "@/components/ui/dropdown";
import { RequireView } from "@/components/require-view";
import { NewRequestModal } from "@/components/maintenance/new-request-modal";
import {
  SeverityBadge,
  StatusPill,
  btnPrimary,
  inputClass,
  mrNumber,
  timeAgo,
  type Severity,
  type Status,
} from "@/components/maintenance/shared";

type Tab = "new" | "waiting" | "forwarded" | "closed" | "all";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "new", label: "New" },
  { id: "waiting", label: "Waiting on tenant" },
  { id: "forwarded", label: "Forwarded to Pat" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
];

const SEVERITY_FILTER = [
  { value: "all", label: "All severities" },
  { value: "emergency", label: "🔴 Emergency" },
  { value: "urgent", label: "🟠 Urgent" },
  { value: "routine", label: "🟡 Routine" },
  { value: "informational", label: "⚪ Info" },
];

function Counter({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-4">
      <div className={`text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Inbox() {
  const router = useRouter();
  const access = useQuery(api.team.myAccess);
  const isAdmin = access?.view === "admin";
  const counts = useQuery(api.maintenance.counts);

  const [tab, setTab] = useState<Tab>("new");
  const [severity, setSeverity] = useState("all");
  const [propertyId, setPropertyId] = useState("all");
  const [amId, setAmId] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const properties = useQuery(api.properties.list);
  const team = useQuery(api.team.overview, isAdmin ? {} : "skip");

  const rows = useQuery(api.maintenance.list, {
    tab,
    severity: severity === "all" ? undefined : (severity as Severity),
    propertyId: propertyId === "all" ? undefined : (propertyId as Id<"properties">),
    assetManagerUserId: isAdmin && amId !== "all" ? (amId as Id<"users">) : undefined,
    search: search.trim() || undefined,
  });

  const propertyOptions = useMemo(
    () => [{ value: "all", label: "All properties" }, ...(properties ?? []).map((p) => ({ value: p._id as string, label: p.name }))],
    [properties],
  );
  const amOptions = useMemo(
    () => [
      { value: "all", label: "All asset managers" },
      ...(team?.members ?? [])
        .filter((m) => m.jobRoles.includes("asset_manager"))
        .map((m) => ({ value: m.userId as string, label: m.name })),
    ],
    [team],
  );

  const title = isAdmin ? "Maintenance" : "My inbox";
  const newBadge = counts ? counts.new : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin ? "Every request the team has taken." : "Requests for your units."}
          </p>
        </div>
        <button className={btnPrimary} onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New request
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Counter label="New" value={newBadge} />
        <Counter label="More info needed" value={counts?.waiting ?? 0} />
        <Counter label="Forwarded" value={counts?.forwarded ?? 0} />
        <Counter label="Closed (7d)" value={counts?.closed7d ?? 0} />
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className={`${inputClass} h-11 rounded-xl pl-9`}
            placeholder="Search MR number, caller, issue…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Dropdown value={severity} options={SEVERITY_FILTER} onChange={setSeverity} />
        {isAdmin && <Dropdown value={propertyId} options={propertyOptions} onChange={setPropertyId} />}
        {isAdmin && <Dropdown value={amId} options={amOptions} onChange={setAmId} />}
      </div>

      {rows === undefined ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
          {isAdmin ? "No requests here 🎉" : "No requests for your units 🎉"}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-2xl border border-border bg-card shadow-sm sm:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Severity</th>
                  <th className="px-4 py-2.5 font-medium">Request</th>
                  <th className="px-4 py-2.5 font-medium">Where</th>
                  <th className="px-4 py-2.5 font-medium">Issue</th>
                  <th className="px-4 py-2.5 font-medium">Caller</th>
                  <th className="px-4 py-2.5 font-medium">Age</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r._id}
                    onClick={() => router.push(`/maintenance/${r._id}`)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/40"
                  >
                    <td className="px-4 py-3">
                      <SeverityBadge severity={r.severity} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2 font-medium">
                        {r.isUnread && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Unread" />}
                        <Link href={`/maintenance/${r._id}`} onClick={(e) => e.stopPropagation()}>
                          {mrNumber(r.number)}
                        </Link>
                        {r.possibleDuplicateOf && (
                          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-normal text-warning-foreground">
                            Possible duplicate
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.propertyName ?? "No property"}
                      {r.unitNumber ? ` · ${r.unitNumber}` : ""}
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <div className="text-xs capitalize text-muted-foreground">{r.issueType}</div>
                      <div className="truncate">{r.description}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.callerName ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        {timeAgo(r.createdAt, now)}
                        {r.mediaCount > 0 && <Camera className="h-3.5 w-3.5" aria-label="Has media" />}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={r.status as Status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 sm:hidden">
            {rows.map((r) => (
              <Link
                key={r._id}
                href={`/maintenance/${r._id}`}
                className="block rounded-2xl border border-border bg-card p-4 shadow-sm"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <SeverityBadge severity={r.severity} />
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {r.mediaCount > 0 && <Camera className="h-3.5 w-3.5" />}
                    {timeAgo(r.createdAt, now)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  {r.isUnread && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Unread" />}
                  {mrNumber(r.number)} · {r.propertyName ?? "No property"}
                  {r.unitNumber ? ` ${r.unitNumber}` : ""}
                </div>
                <div className="mt-1 text-xs capitalize text-muted-foreground">{r.issueType}</div>
                <div className="mt-1 line-clamp-2 text-sm">{r.description}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <StatusPill status={r.status as Status} />
                  {r.callerName && <span>{r.callerName}</span>}
                  {r.possibleDuplicateOf && (
                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-warning-foreground">Possible duplicate</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      {creating && (
        <NewRequestModal onClose={() => setCreating(false)} onCreated={(id) => router.push(`/maintenance/${id}`)} />
      )}
    </div>
  );
}

export default function MaintenancePage() {
  return (
    <RequireView views={["admin", "asset_manager"]}>
      <Inbox />
    </RequireView>
  );
}
