"use client";

import { useConvex, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { errorMessage } from "@/components/ui/toast";
import { Download } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Btn, Card, CardHead, DatePicker, Input, Pagination, Select } from "@/components/ui";
import { formatWhen } from "@/components/maintenance/shared";
import { useCursorPaging } from "@/lib/use-cursor-paging";
import { Spinner } from "@/components/finance/form-bits";

type Row = Doc<"auditEvents">;
type Entity = Row["entity"];
type AuditPage = FunctionReturnType<typeof api.audit.list>;

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
  if (row.entity === "unit") return "/properties";
  return null;
}

/** Spreadsheet apps run cells starting with = + - @ as formulas; a leading apostrophe makes them text. */
function csvCell(value: string | undefined): string {
  let v = value ?? "";
  if (/^[=+\-@]/.test(v)) v = "'" + v;
  return `"${v.replace(/"/g, '""')}"`;
}

/** Most rows "Export all matching" reads before it stops. */
const EXPORT_ALL_CAP = 20_000;

function exportCsv(rows: Row[], fileName = "audit-log.csv") {
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
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** Audit log tab for /team?tab=audit. The page only mounts it for admins. */
export function AuditTab() {
  const convex = useConvex();
  const team = useQuery(api.team.overview);
  const [entity, setEntity] = useState<Entity | "all">("all");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // One page at a time (50 rows; the server fixes the size): Previous / Next, filters kept.
  const paging = useCursorPaging();
  const [rows, setRows] = useState<Row[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0);

  const filterKey = `${entity}|${action.trim()}|${actor}|${fromDate}|${toDate}`;
  const loadedFilter = useRef<string | null>(null);

  // The audit.list filters for the current form values.
  const currentFilters = useCallback(
    () => ({
      entity: entity === "all" ? undefined : entity,
      action: action.trim() || undefined,
      actorUserId: actor === "all" ? undefined : (actor as Id<"users">),
      from: fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : undefined,
      to: toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : undefined,
    }),
    [entity, action, actor, fromDate, toDate],
  );

  const loadPage = useCallback(
    async (cursor: string | null) => {
      const myGen = ++gen.current;
      setLoading(true);
      setError(null);
      try {
        let cur: string | null = cursor;
        let collected: Row[] = [];
        let done = false;
        // Filtered pages can come back short or empty: keep reading until something shows or the log ends.
        while (!done && collected.length === 0) {
          const res: AuditPage = await convex.query(api.audit.list, { ...currentFilters(), cursor: cur });
          if (myGen !== gen.current) return;
          collected = res.page;
          cur = res.continueCursor;
          done = res.isDone;
        }
        if (myGen !== gen.current) return;
        setRows(collected);
        setNextCursor(cur);
        setIsDone(done);
      } catch (e) {
        if (myGen === gen.current) setError(errorMessage(e));
      } finally {
        if (myGen === gen.current) setLoading(false);
      }
    },
    [convex, currentFilters],
  );

  // Load the page shown whenever the page or a filter changes (the action text waits for a pause in typing).
  const loadRef = useRef(loadPage);
  useEffect(() => {
    loadRef.current = loadPage;
  });
  const { cursor } = paging;
  useEffect(() => {
    const filterChanged = loadedFilter.current !== filterKey;
    loadedFilter.current = filterKey;
    const t = setTimeout(() => void loadRef.current(cursor), filterChanged ? 300 : 0);
    return () => clearTimeout(t);
  }, [filterKey, cursor]);

  // Export every row matching the current filters: read all pages client-side, then download once.
  const [exportCount, setExportCount] = useState<number | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const exportRun = useRef(0);
  useEffect(
    () => () => {
      exportRun.current++; // leaving the tab cancels a running export
    },
    [],
  );

  const exportAll = async () => {
    const myRun = ++exportRun.current;
    const filters = currentFilters(); // filters as they were when the export started
    const all: Row[] = [];
    let cur: string | null = null;
    let done = false;
    let capped = false;
    setExportNote(null);
    setExportCount(0);
    try {
      while (!done) {
        const res: AuditPage = await convex.query(api.audit.list, { ...filters, cursor: cur });
        if (myRun !== exportRun.current) return; // cancelled
        all.push(...res.page);
        cur = res.continueCursor;
        done = res.isDone;
        setExportCount(Math.min(all.length, EXPORT_ALL_CAP));
        if (all.length >= EXPORT_ALL_CAP && !done) {
          capped = true;
          break;
        }
      }
      exportCsv(all.slice(0, EXPORT_ALL_CAP), "audit-log-all.csv");
      setExportNote(
        capped
          ? `Stopped at ${EXPORT_ALL_CAP.toLocaleString("en-US")} rows. Narrow the date range or filters to export the rest.`
          : `Exported ${all.length.toLocaleString("en-US")} rows.`,
      );
    } catch (e) {
      if (myRun === exportRun.current) setExportNote(`Export failed: ${errorMessage(e)}`);
    } finally {
      if (myRun === exportRun.current) setExportCount(null);
    }
  };
  const cancelExport = () => {
    exportRun.current++;
    setExportCount(null);
    setExportNote("Export cancelled.");
  };
  const exporting = exportCount !== null;

  // A changed filter goes back to page 1.
  const filter = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    paging.reset();
  };

  const actorOptions = [
    { value: "all", label: "Anyone" },
    ...(team?.members ?? []).map((m) => ({ value: m.userId as string, label: m.name })),
  ];
  const entityOptions = [
    { value: "all" as const, label: "All entities" },
    ...ENTITIES.map((e) => ({ value: e, label: e.replace("_", " ") })),
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHead
          title="Audit log"
          hint="Every change, newest first."
          right={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {exporting ? (
                <>
                  <span role="status" className="text-xs text-muted-foreground">
                    Exporting… {exportCount.toLocaleString("en-US")} rows
                  </span>
                  <Btn sm onClick={cancelExport}>
                    Cancel
                  </Btn>
                </>
              ) : (
                <>
                  {exportNote ? (
                    <span role="status" className="text-xs text-muted-foreground">
                      {exportNote}
                    </span>
                  ) : null}
                  <Btn
                    sm
                    disabled={loading || rows.length === 0}
                    onClick={() => void exportAll()}
                    title="Reads every page matching the filters, up to 20,000 rows"
                  >
                    <Download className="h-3.5 w-3.5" /> Export all matching (CSV)
                  </Btn>
                </>
              )}
              <Btn sm disabled={rows.length === 0} onClick={() => exportCsv(rows)} title="Exports the rows on this page">
                <Download className="h-3.5 w-3.5" /> Export this page (CSV)
              </Btn>
            </div>
          }
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Select
            aria-label="Entity"
            value={entity}
            onChange={(e) => filter(setEntity)(e.target.value as Entity | "all")}
          >
            {entityOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Input
            placeholder="Action (exact)"
            aria-label="Action"
            value={action}
            onChange={(e) => filter(setAction)(e.target.value)}
          />
          <Select aria-label="Actor" value={actor} onChange={(e) => filter(setActor)(e.target.value)}>
            {actorOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <DatePicker aria-label="From date" value={fromDate} onChange={filter(setFromDate)} />
          <DatePicker aria-label="To date" value={toDate} onChange={filter(setToDate)} />
        </div>
      </Card>

      {error ? <p className="text-xs text-danger-ink">{error}</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[760px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-muted text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              {["Time", "Actor", "Action", "Entity", "From → To", "Note"].map((h) => (
                <th key={h} className="px-4 py-2.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const href = entityHref(r);
              return (
                <tr key={r._id} className="border-b border-border align-top last:border-0">
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
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <Spinner label="Loading the audit log…" />
                </td>
              </tr>
            ) : null}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  {filterKey === "all||all||" ? "No events yet." : "No events match these filters."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* A disabled fieldset disables Previous / Next while a page loads. */}
      <fieldset disabled={loading} className="m-0 min-w-0 border-0 p-0">
        <Pagination
          label="Audit log pages"
          className="pt-0"
          page={paging.page}
          pageSize={paging.pageSize}
          rowsOnPage={rows.length}
          rowsBefore={paging.rowsBefore}
          hasNext={!isDone}
          onPage={(p) => {
            if (loading) return;
            paging.goTo(p, { rowsOnPage: rows.length, hasNext: !isDone, continueCursor: nextCursor });
          }}
        />
      </fieldset>
    </div>
  );
}
