"use client";

import { useConvex, useQuery } from "convex/react";
import { Download, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { RequireView } from "@/components/require-view";
import { Dropdown } from "@/components/ui/dropdown";
import { btnOutline, cleanError, formatWhen, inputClass } from "@/components/maintenance/shared";

type Row = Doc<"auditEvents">;
type Entity = Row["entity"];

const ENTITIES: Entity[] = [
  "request",
  "work_order",
  "unit",
  "payment",
  "ros",
  "config",
  "membership",
  "resident",
  "property",
  "conversation",
];

function entityHref(row: Row): string | null {
  if (row.entity === "request") return `/maintenance/${row.entityId}`;
  if (row.entity === "work_order") return `/work-orders/${row.entityId}`;
  if (row.entity === "unit") return "/units";
  return null;
}

/** Spreadsheet apps run cells starting with = + - @ as formulas; a leading apostrophe makes them text. */
function csvCell(value: string | undefined): string {
  let v = value ?? "";
  if (/^[=+\-@]/.test(v)) v = "'" + v;
  return `"${v.replace(/"/g, '""')}"`;
}

function exportCsv(rows: Row[]) {
  const header = ["Time", "Actor", "Action", "Entity", "Entity ID", "From", "To", "Note"];
  const lines = rows.map((r) =>
    [new Date(r.at).toISOString(), r.actorLabel, r.action, r.entity, r.entityId, r.from, r.to, r.note]
      .map((c) => csvCell(c))
      .join(","),
  );
  const blob = new Blob([[header.map(csvCell).join(","), ...lines].join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "audit-log.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function AuditInner() {
  const convex = useConvex();
  const team = useQuery(api.team.overview);
  const [entity, setEntity] = useState<Entity | "all">("all");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0);

  const filterKey = `${entity}|${action.trim()}|${actor}|${fromDate}|${toDate}`;

  const loadMore = useCallback(
    async (reset: boolean) => {
      const myGen = reset ? ++gen.current : gen.current;
      setLoading(true);
      setError(null);
      try {
        let cur: string | null = reset ? null : cursor;
        let collected: Row[] = [];
        let done = false;
        // Filtered pages can come back short or empty: keep paging until something shows or the log ends.
        while (!done && collected.length === 0) {
          const res = await convex.query(api.audit.list, {
            entity: entity === "all" ? undefined : entity,
            action: action.trim() || undefined,
            actorUserId: actor === "all" ? undefined : (actor as Id<"users">),
            from: fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : undefined,
            to: toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : undefined,
            cursor: cur,
          });
          if (myGen !== gen.current) return;
          collected = res.page;
          cur = res.continueCursor;
          done = res.isDone;
        }
        setRows((prev) => (reset ? collected : [...prev, ...collected]));
        setCursor(cur);
        setIsDone(done);
      } catch (e) {
        if (myGen === gen.current) setError(cleanError(e));
      } finally {
        if (myGen === gen.current) setLoading(false);
      }
    },
    [convex, cursor, entity, action, actor, fromDate, toDate],
  );

  // Reload from the top whenever a filter changes (debounced for the action text).
  const loadRef = useRef(loadMore);
  useEffect(() => {
    loadRef.current = loadMore;
  });
  useEffect(() => {
    const t = setTimeout(() => void loadRef.current(true), 300);
    return () => clearTimeout(t);
  }, [filterKey]);

  const actorOptions = [
    { value: "all", label: "Anyone" },
    ...(team?.members ?? []).map((m) => ({ value: m.userId as string, label: m.name })),
  ];
  const entityOptions = [
    { value: "all" as const, label: "All entities" },
    ...ENTITIES.map((e) => ({ value: e, label: e.replace("_", " ") })),
  ];

  return (
    <div className="space-y-5 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Audit log</h1>
          <p className="mt-1 text-xs text-muted-foreground">Every change, newest first.</p>
        </div>
        <button
          type="button"
          className={btnOutline}
          disabled={rows.length === 0}
          onClick={() => exportCsv(rows)}
        >
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Dropdown value={entity} options={entityOptions} onChange={setEntity} buttonClassName="w-full" />
        <input
          className={inputClass}
          placeholder="Action (exact)"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
        <Dropdown value={actor} options={actorOptions} onChange={setActor} buttonClassName="w-full" />
        <input
          className={inputClass}
          type="date"
          aria-label="From date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
        />
        <input
          className={inputClass}
          type="date"
          aria-label="To date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
        />
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-border/90 bg-card">
        <table className="w-full min-w-[760px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-slate-100 text-muted-foreground-subtle">
              {["Time", "Actor", "Action", "Entity", "From → To", "Note"].map((h) => (
                <th key={h} className="px-4 py-3 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const href = entityHref(r);
              return (
                <tr key={r._id} className="border-b border-slate-100 align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatWhen(r.at)}</td>
                  <td className="px-4 py-3 text-foreground">{r.actorLabel}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{r.action}</td>
                  <td className="px-4 py-3">
                    {href ? (
                      <Link href={href} className="font-medium text-primary hover:underline">
                        {r.entity.replace("_", " ")}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{r.entity.replace("_", " ")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.from || r.to ? `${r.from ?? "—"} → ${r.to ?? "—"}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{r.note ?? ""}</td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  No events match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex justify-center">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        ) : !isDone ? (
          <button type="button" className={btnOutline} onClick={() => void loadMore(false)}>
            Load more
          </button>
        ) : rows.length > 0 ? (
          <span className="text-xs text-muted-foreground-subtle">End of log</span>
        ) : null}
      </div>
    </div>
  );
}

export default function AuditPage() {
  return (
    <RequireView views={["admin"]}>
      <AuditInner />
    </RequireView>
  );
}
