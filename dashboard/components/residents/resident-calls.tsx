"use client";

import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, CheckCircle2, ClipboardList, Gauge } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { readChoice } from "@/components/residents/tenant-list-params";
import { useKept, useTenantUrl } from "@/components/residents/use-tenant-url";
import { errorMessage, useToast } from "@/components/toast";
import { ConversationTranscript } from "@/components/transcript";
import {
  ActBox,
  Btn,
  Card,
  CardHead,
  DataTable,
  Drawer,
  DrawerSection,
  Input,
  KeyValue,
  Kpi,
  KpiRow,
  LabeledField,
  Pagination,
  Pill,
  SearchBox,
  Select,
  SortHeader,
  Textarea,
  ariaSortOf,
  readSort,
  toggleSort,
  useUrlPaging,
  useUrlSearch,
  type Column,
  type Tone,
} from "@/components/ui";
import { SEVERITY_RUBRIC, severityBand, type SeverityBand } from "@/convex/severity";

const BAND_TONE: Record<SeverityBand, Tone> = { high: "bad", medium: "warn", low: "neutral" };

const SORT_KEYS = ["when", "caller", "severity", "duration", "status"] as const;
type SortKey = (typeof SORT_KEYS)[number];
const SORT_DEFAULT = { key: "when", dir: "desc" } as const;
const STATUS_CHOICES = ["open", "resolved", "all"] as const;
const SEVERITY_CHOICES = ["all", "high", "medium", "low"] as const;

const SEVERITY_LABELS: Record<SeverityBand, string> = {
  high: "High (7-10)",
  medium: "Medium (4-6)",
  low: "Low (1-3)",
};

type IssueRow = {
  kind: "request" | "issue";
  key: string;
  issueId?: Id<"tenantIssues">;
  requestId?: string;
  workOrderId?: string;
  mrNumber?: string;
  woNumber?: string;
  conversationId?: Id<"conversations">;
  callerName?: string;
  unit?: string;
  callerNumber?: string;
  callbackNumber?: string;
  reason: string;
  description?: string;
  category?: string;
  severity: number;
  severityLevel?: string;
  severityReason?: string;
  originalSeverity?: number;
  status: "open" | "resolved";
  statusLabel: string;
  createdAt: number;
  channel?: string | null;
  durationSec?: number | null;
  callType?: string;
};

/** Deep link into the work-orders board for the request, or its work order once one exists. */
function workOrderHref(i: IssueRow) {
  if (i.workOrderId) return `/work-orders?open=work_order:${encodeURIComponent(i.workOrderId)}`;
  if (i.requestId) return `/work-orders?open=request:${encodeURIComponent(i.requestId)}`;
  return null;
}

function callTypeOf(issue: { callType?: string; category?: string }) {
  return issue.callType ?? issue.category ?? "";
}

function labelize(value: string) {
  const t = value.replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function formatWhen(ms: number) {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatDuration(seconds?: number | null) {
  if (seconds === undefined || seconds === null) return "—";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Tenant-issue severity is a 1-10 number, shown as "n/10" with a tone from its band. */
function ScorePill({ severity }: { severity: number }) {
  return (
    <Pill tone={BAND_TONE[severityBand(severity)]} className="tabular-nums">
      {severity}/10
    </Pill>
  );
}

/** Non-maintenance resident calls: filters, severity override, resolve, admin-only delete. */
export function ResidentCalls() {
  const toast = useToast();
  const stats = useQuery(api.tenants.stats);
  const updateIssue = useMutation(api.tenants.updateIssue);
  const removeIssue = useMutation(api.tenants.removeIssue);
  const access = useQuery(api.team.myAccess);
  const isAdmin = access?.isAdmin === true;
  // tenants.updateIssue is admin-view only on the server; AMs get a read-only drawer.
  const canEdit = access?.view === "admin";

  const url = useTenantUrl();
  const search = useUrlSearch();
  const paging = useUrlPaging();
  const statusFilter = readChoice(url.params.get("status"), STATUS_CHOICES, "open");
  const severityFilter = readChoice(url.params.get("severity"), SEVERITY_CHOICES, "all");
  const typeFilter = url.params.get("type") ?? "all";
  const sort = readSort(url.params.get("sort"), url.params.get("dir"), SORT_KEYS, SORT_DEFAULT);
  // The open drawer keeps its own copy of the row, so it stays put if a save moves the row off this page.
  const [selected, setSelected] = useState<IssueRow | null>(null);

  const result = useQuery(api.tenants.issuesPage, {
    status: statusFilter,
    severity: severityFilter === "all" ? undefined : severityFilter,
    type: typeFilter === "all" ? undefined : typeFilter,
    search: search.q.trim() || undefined,
    sortKey: sort.key,
    sortDir: sort.dir,
    page: paging.page,
    pageSize: paging.pageSize,
  });
  const { value: data, stale } = useKept(result);

  const types = data?.types ?? [];
  const typeOptions = typeFilter !== "all" && !types.includes(typeFilter) ? [...types, typeFilter].sort() : types;
  const current = (selected && data?.rows.find((i) => i.key === selected.key)) || selected;

  const onSort = (key: SortKey) => {
    const next = toggleSort(sort, key);
    const isDefault = next.key === SORT_DEFAULT.key && next.dir === SORT_DEFAULT.dir;
    url.set({ sort: isDefault ? null : next.key, dir: isDefault ? null : next.dir });
  };
  const sortable = (key: SortKey, label: string) => ({
    header: <SortHeader label={label} sortKey={key} sort={sort} onSort={onSort} />,
    sort: ariaSortOf(sort, key),
  });
  const filtersActive =
    search.q.trim() !== "" || statusFilter !== "open" || severityFilter !== "all" || typeFilter !== "all";
  const clearAll = () => {
    search.setInput("");
    url.set({ q: null, status: null, severity: null, type: null });
  };

  const columns: Column<IssueRow>[] = [
    { key: "when", ...sortable("when", "When"), className: "whitespace-nowrap text-muted-foreground", render: (i) => formatWhen(i.createdAt) },
    {
      key: "caller",
      ...sortable("caller", "Caller"),
      render: (i) => (
        <div>
          <div className="font-medium">{i.callerName ?? "—"}</div>
          {i.unit ? <div className="text-xs text-muted-foreground">Unit {i.unit}</div> : null}
        </div>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      className: "max-w-xs",
      render: (i) => (
        <div>
          <div className="truncate">{i.reason}</div>
          {callTypeOf(i) ? <div className="text-xs text-muted-foreground">{labelize(callTypeOf(i))}</div> : null}
        </div>
      ),
    },
    { key: "sev", ...sortable("severity", "Severity"), render: (i) => <ScorePill severity={i.severity} /> },
    { key: "dur", ...sortable("duration", "Duration"), className: "tabular-nums", render: (i) => formatDuration(i.durationSec) },
    {
      key: "status",
      ...sortable("status", "Status"),
      render: (i) => <Pill tone={i.status === "open" ? "warn" : "ok"}>{i.statusLabel}</Pill>,
    },
    {
      key: "link",
      header: "Request",
      className: "whitespace-nowrap",
      render: (i) => {
        const href = workOrderHref(i);
        if (!href) return "—";
        return (
          <Link
            href={href}
            onClick={(e) => e.stopPropagation()}
            className="text-[12.5px] font-medium text-primary underline-offset-2 hover:underline"
          >
            {i.woNumber ?? i.mrNumber}
          </Link>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <p className="text-[12.5px] text-muted-foreground">
        Every resident call: maintenance requests raised from calls (open them under Work orders) and other resident calls. Names and units are recorded as the caller gave them and are not verified.
        Severity is Sarah&apos;s judgment; you can change it and the original is kept.
      </p>

      {stats ? (
        <KpiRow>
          <Kpi icon={<ClipboardList />} label="Open issues" value={stats.openIssues} />
          <Kpi icon={<AlertTriangle />} label="High severity" value={stats.highSeverityOpen} />
          <Kpi icon={<CheckCircle2 />} label="Resolved" value={stats.resolvedIssues} />
        </KpiRow>
      ) : null}

      <Card>
        <div className="mb-3">
          <SearchBox
            id="calls-search"
            label="Search resident calls"
            value={search.input}
            onChange={search.setInput}
            onClear={search.clear}
            placeholder="Search caller, unit, reason, phone or request number"
          />
        </div>
        <div className="mb-3.5 flex flex-wrap gap-2">
          <Select
            aria-label="Filter by severity"
            className="w-44"
            value={severityFilter}
            onChange={(e) => url.set({ severity: e.target.value === "all" ? null : e.target.value })}
          >
            <option value="all">All severities</option>
            {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by call type"
            className="w-44"
            value={typeFilter}
            onChange={(e) => url.set({ type: e.target.value === "all" ? null : e.target.value })}
          >
            <option value="all">All call types</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {labelize(t)}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by status"
            className="w-36"
            value={statusFilter}
            onChange={(e) => url.set({ status: e.target.value === "open" ? null : e.target.value })}
          >
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </Select>
        </div>
        {data === undefined ? (
          <p className="text-sm text-muted-foreground">Loading resident calls…</p>
        ) : (
          <div className={stale ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={stale}>
            <DataTable
              caption="Resident calls"
              columns={columns}
              rows={data.rows}
              rowKey={(i) => i.key}
              onRowClick={(i) => setSelected(i)}
              empty={
                data.overall === 0 ? (
                  "No resident calls logged yet. Sarah adds them here as they call in."
                ) : search.q.trim() !== "" ? (
                  <span>
                    No resident calls match &ldquo;{search.q.trim()}&rdquo;.{" "}
                    <button type="button" onClick={clearAll} className="font-medium text-primary hover:underline">
                      Clear search and filters
                    </button>
                  </span>
                ) : (
                  <span>
                    No issues match this filter.{" "}
                    {filtersActive ? (
                      <button type="button" onClick={clearAll} className="font-medium text-primary hover:underline">
                        Clear filters
                      </button>
                    ) : null}
                  </span>
                )
              }
            />
            <Pagination
              label="Resident calls pages"
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPage={paging.setPage}
              onPageSize={paging.setPageSize}
            />
          </div>
        )}
      </Card>

      <Card>
        <CardHead
          title="Severity scale"
          icon={<Gauge />}
          hint="Sarah scores every resident call against this exact scale. It is written into her instructions from the same source as this list, so the two can never drift apart. She scores the issue, not how upset the caller sounds."
        />
        <div className="space-y-2">
          {SEVERITY_RUBRIC.map((r) => (
            <div key={r.band} className="flex items-start gap-3 rounded-xl border border-border bg-muted/50 p-3">
              <Pill tone="acc" className="tabular-nums">
                {r.band}
              </Pill>
              <div className="min-w-0">
                <div className="text-sm font-medium">{r.label}</div>
                <div className="text-xs text-muted-foreground">{r.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Drawer
        open={current !== null}
        onClose={() => setSelected(null)}
        title={current?.callerName ?? "Resident call"}
        eyebrow={current ? <ScorePill severity={current.severity} /> : undefined}
      >
        {current ? (
          <IssueDetail
            key={current.key + current.status + current.severity}
            issue={current}
            canDelete={isAdmin && current.kind === "issue"}
            canEdit={canEdit && current.kind === "issue"}
            onSave={async (patch) => {
              try {
                if (!current.issueId) return;
                await updateIssue({ issueId: current.issueId, ...patch });
                toast("Issue updated");
              } catch (err) {
                toast(errorMessage(err), "error");
              }
            }}
            onDelete={async () => {
              try {
                if (!current.issueId) return;
                await removeIssue({ issueId: current.issueId });
                setSelected(null);
                toast("Issue deleted");
              } catch (err) {
                toast(errorMessage(err), "error");
              }
            }}
          />
        ) : null}
      </Drawer>
    </div>
  );
}

function IssueDetail({
  issue,
  canDelete,
  canEdit,
  onSave,
  onDelete,
}: {
  issue: IssueRow;
  canDelete: boolean;
  canEdit: boolean;
  onSave: (patch: {
    severity?: number;
    reason?: string;
    callerName?: string;
    unit?: string;
    status?: "open" | "resolved";
  }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [severity, setSeverity] = useState(issue.severity);
  const [reason, setReason] = useState(issue.reason);
  const [callerName, setCallerName] = useState(issue.callerName ?? "");
  const [unit, setUnit] = useState(issue.unit ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async (status?: "open" | "resolved") => {
    setBusy(true);
    await onSave({ severity, reason, callerName, unit, ...(status ? { status } : {}) });
    setBusy(false);
  };

  const info = [
    { label: "Request", value: issue.mrNumber },
    { label: "Work order", value: issue.woNumber },
    { label: "Status", value: issue.kind === "request" ? issue.statusLabel : undefined },
    { label: "Severity level", value: issue.severityLevel ? labelize(issue.severityLevel) : undefined },
    { label: "Call type", value: issue.callType ? labelize(issue.callType) : undefined },
    { label: "Category", value: issue.category },
    { label: "Channel", value: issue.channel ?? undefined },
    { label: "Called from", value: issue.callerNumber },
    {
      label: "Callback number",
      value: issue.callbackNumber && issue.callbackNumber !== issue.callerNumber ? issue.callbackNumber : undefined,
    },
    { label: "Sarah scored", value: issue.originalSeverity !== undefined ? `${issue.originalSeverity}/10` : undefined },
    { label: "Duration", value: issue.durationSec != null ? formatDuration(issue.durationSec) : undefined },
    { label: "When", value: formatWhen(issue.createdAt) },
  ].filter((r): r is { label: string; value: string } => !!r.value);

  return (
    <>
      {canEdit ? (
      <ActBox
        lead={issue.status === "open" ? "Review this call" : "Resolved"}
        note={issue.severityReason ? `Sarah's reasoning: ${issue.severityReason}` : undefined}
      >
        <div className="grid grid-cols-2 gap-3">
          <LabeledField label="Caller">{(id) => <Input id={id} value={callerName} onChange={(e) => setCallerName(e.target.value)} />}</LabeledField>
          <LabeledField label="Unit">{(id) => <Input id={id} value={unit} onChange={(e) => setUnit(e.target.value)} />}</LabeledField>
        </div>
        <LabeledField label="Reason for calling">
          {(id) => <Textarea id={id} value={reason} rows={3} onChange={(e) => setReason(e.target.value)} />}
        </LabeledField>
        <LabeledField
          label="Severity (1-10)"
          hint={issue.originalSeverity !== undefined ? `Sarah originally scored this ${issue.originalSeverity}/10.` : undefined}
        >
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={10}
              value={severity}
              onChange={(e) => setSeverity(Math.min(10, Math.max(1, Math.round(Number(e.target.value) || 1))))}
            />
          )}
        </LabeledField>
        <div className="flex flex-wrap gap-2">
          <Btn variant="pri" disabled={busy || !reason.trim()} onClick={() => save()}>
            Save changes
          </Btn>
          {issue.status === "open" ? (
            <Btn variant="ok" disabled={busy || !reason.trim()} onClick={() => save("resolved")}>
              Mark resolved
            </Btn>
          ) : (
            <Btn disabled={busy} onClick={() => save("open")}>
              Reopen
            </Btn>
          )}
          {canDelete ? (
            confirmDelete ? (
              <Btn variant="dng" disabled={busy} onClick={onDelete}>
                Confirm delete
              </Btn>
            ) : (
              <Btn variant="dng" onClick={() => setConfirmDelete(true)}>
                Delete
              </Btn>
            )
          ) : null}
        </div>
      </ActBox>
      ) : (
        <DrawerSection title={issue.kind === "request" ? "Issue" : "Reason for calling"}>
          <p className="text-sm font-medium">{issue.reason}</p>
          {issue.kind === "request" && issue.description && issue.description !== issue.reason ? (
            <p className="mt-1 text-sm text-muted-foreground">{issue.description}</p>
          ) : null}
          {issue.severityReason ? (
            <p className="mt-2 text-xs text-muted-foreground">Sarah&apos;s reasoning: {issue.severityReason}</p>
          ) : null}
          {workOrderHref(issue) ? (
            <Link href={workOrderHref(issue)!} className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
              Open {issue.woNumber ?? issue.mrNumber} in Work orders
            </Link>
          ) : null}
        </DrawerSection>
      )}

      <DrawerSection title="Call">
        <KeyValue items={info} />
      </DrawerSection>

      <DrawerSection title="Transcript">
        {issue.conversationId ? (
          <ConversationTranscript conversationId={issue.conversationId} />
        ) : (
          <p className="text-sm text-muted-foreground">Transcript arrives once the call has finished processing.</p>
        )}
      </DrawerSection>
    </>
  );
}
