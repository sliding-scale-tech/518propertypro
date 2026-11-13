"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { CheckCheck, ChevronRight, CircleCheck, Lock, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { MAX_BULK_MARK, TEAM_LABELS, landsOnText, statementMonthFor, type Team } from "@/convex/rentPaymentsPolicy";
import { formatCurrency, formatDate, formatMonth, isMonth } from "@/convex/rosFormat";
import {
  Btn,
  Card,
  Field,
  PageHeader,
  Pagination,
  Pill,
  RowMenu,
  SearchBox,
  Select,
  cx,
  paginate,
  readPage,
  readPageSize,
  useUrlSearch,
} from "@/components/ui";
import { ChangeRentDialog } from "@/components/units/change-rent";
import { useNow } from "./finance-nav";
import { Checkbox, Spinner } from "./form-bits";
import { currentMonth, rentMonthOptions } from "./months";
import {
  BulkMarkDialog,
  EditPaymentDialog,
  MarkDialog,
  UndoPaymentDialog,
  type PaymentInit,
  type PaymentUnit,
} from "./payment-dialogs";
import {
  BUILDING_PAGE_SIZES,
  DEFAULT_BUILDING_PAGE_SIZE,
  applyPaymentsView,
  groupByProperty,
  normalizeSearch,
  paidProgressByProperty,
  reasonsSummary,
  selectableOnPage,
  type PaymentStatusFilter,
  type PropertyGroup,
} from "./payments-search";

type ListData = FunctionReturnType<typeof api.rentPayments.list>;
type Row = ListData["rows"][number];
type StatusFilter = PaymentStatusFilter;

type Dialog =
  | { kind: "mark"; unit: PaymentUnit }
  | { kind: "bulk"; units: PaymentUnit[]; title?: string; note?: string }
  | { kind: "edit"; payment: PaymentInit }
  | { kind: "undo"; payment: PaymentInit }
  | { kind: "rent"; unitId: string; label: string };

const TEAMS = Object.keys(TEAM_LABELS) as Team[];
const STATUS_OPTIONS: StatusFilter[] = ["", "unpaid", "paid", "not_markable"];
/** URL keys that are filters: changing one goes back to page 1. */
const FILTER_KEYS = new Set(["month", "team", "owner", "property", "status", "q", "size"]);
/** Table columns: checkbox, unit, tenant, rent, status / action. */
const COLS = 5;

/** Clicks on a control inside a row (a button, link, checkbox, menu…) are the control's, not the row's. */
const ROW_CONTROL = "button, a, input, select, textarea, label, [role='menu'], [role='menuitem'], [data-no-row-click]";
function fromControl(target: EventTarget, row: EventTarget): boolean {
  if (target === row || !(target instanceof Element)) return false;
  const hit = target.closest(ROW_CONTROL);
  return hit !== null && hit !== row;
}

function unitOf(r: Row): PaymentUnit {
  return { unitId: r.unitId, unit: r.unit, propertyName: r.propertyName, tenants: r.tenants, rentCents: r.rentCents };
}

function paymentOf(r: Row): PaymentInit | null {
  const p = r.payment;
  if (!p || p.kind !== "payment") return null;
  return {
    ...unitOf(r),
    entryId: p.entryId,
    amountCents: p.amountCents,
    receivedDate: p.receivedDate,
    method: p.method,
    note: p.note,
  };
}

function tenantOf(r: Row): string {
  return r.payment?.counterparty || r.tenants.join(" & ");
}

function rentOf(r: Row): number | null {
  return r.payment ? r.payment.amountCents : r.rentCents;
}

/** "11/12/2026" -> "11/12". */
function shortDate(iso: string): string {
  return formatDate(iso).slice(0, 5);
}

/** "→ Nov statement" (cash basis: the month received); the year only when it isn't the rent month's. */
function statementShort(receivedDate: string, rentMonth: string): string {
  const m = statementMonthFor(receivedDate);
  const name = formatMonth(m).slice(0, 3);
  return `→ ${m.slice(0, 4) === rentMonth.slice(0, 4) ? name : `${name} ${m.slice(0, 4)}`} statement`;
}

/** `/payments` (Finance → Payments): mark rent received per unit per rent month (spec 6.8). */
export function PaymentsView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const now = useNow();
  const thisMonth = currentMonth(now);
  const rawMonth = params.get("month");
  // Next month (rent paid early), this month and 24 before it; an older month from a link is added.
  const months = useMemo(() => rentMonthOptions(now, rawMonth), [now, rawMonth]);
  const month = rawMonth && isMonth(rawMonth) && months.some((m) => m.value === rawMonth) ? rawMonth : thisMonth;
  const rawTeam = params.get("team") ?? "";
  const team = (TEAMS as string[]).includes(rawTeam) ? rawTeam : "";
  const ownerId = params.get("owner") ?? "";
  // No property select any more (search finds a building): a statement link may still set ?property=.
  const propertyId = params.get("property") ?? "";
  const rawStatus = params.get("status") ?? "";
  const status: StatusFilter = (STATUS_OPTIONS as string[]).includes(rawStatus) ? (rawStatus as StatusFilter) : "";
  const urlQ = params.get("q") ?? "";
  const q = normalizeSearch(urlQ);
  // Pages count BUILDINGS (10 / 25 / 50): a building is never split across pages.
  const pageSize = readPageSize(params.get("size"), BUILDING_PAGE_SIZES, DEFAULT_BUILDING_PAGE_SIZE);
  const requestedPage = readPage(params.get("page"));

  // The status filter and the search run here, over every unit of the month the list returns, so
  // the summary counts follow the search too.
  const data = useQuery(api.rentPayments.list, {
    month,
    category: team || null,
    ownerId: ownerId || null,
    propertyId: propertyId || null,
    status: null,
  });

  /** Set several URL params at once ("" removes one); a filter change goes back to page 1. */
  const setParams = (updates: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
      if (FILTER_KEYS.has(key)) next.delete("page");
      // A property filter from another team would hide everything.
      if (key === "team") next.delete("property");
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };
  const setParam = (key: string, value: string) => setParams({ [key]: value });

  // Search box: live as you type (debounced), kept in the URL as ?q= (a new search goes back to page 1).
  const search = useUrlSearch();
  const clearSearch = search.clear;

  const view = applyPaymentsView(data?.rows ?? [], { q, status });
  const groups = groupByProperty(view.visible);
  const progress = paidProgressByProperty(view.matched);
  const paged = paginate(groups, requestedPage, pageSize);
  const pageGroups = paged.rows;
  const pageRows = pageGroups.flatMap((g) => g.rows);

  // Selection is per page: it starts empty whenever the month, a filter, the search or the page changes.
  const viewKey = `${month}|${team}|${ownerId}|${propertyId}|${status}|${q}|${paged.page}|${pageSize}`;
  const [selection, setSelection] = useState<{ key: string; ids: Set<string> }>({ key: viewKey, ids: new Set() });
  const selected = selection.key === viewKey ? selection.ids : new Set<string>();
  const setSelected = (ids: Set<string>) => setSelection({ key: viewKey, ids });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // Buildings folded by the user, and buildings whose greyed-out units are unfolded.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [showGrey, setShowGrey] = useState<Set<string>>(() => new Set());
  const flip = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  // "Select all" = the markable unpaid units of THIS page (at most 100, the bulk cap).
  const selectable = selectableOnPage(pageRows, MAX_BULK_MARK);
  const selectedRows = pageRows.filter((r) => r.canMark && selected.has(r.unitId));
  const selectedCents = selectedRows.reduce((sum, r) => sum + (r.rentCents ?? 0), 0);
  const allOn = selectable.length > 0 && selectable.every((id) => selected.has(id));
  const atCap = selected.size >= MAX_BULK_MARK;

  const toggle = (unitId: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(unitId);
    else next.delete(unitId);
    setSelected(next);
  };
  const toggleRow = (r: Row) => {
    const on = selected.has(r.unitId);
    if (!on && atCap) return;
    toggle(r.unitId, !on);
  };

  const markAll = (g: PropertyGroup<Row>) => {
    const units = g.active.filter((r) => r.canMark);
    if (units.length === 0) return;
    const name = units[0].propertyName;
    const capped = units.length > MAX_BULK_MARK;
    setDialog({
      kind: "bulk",
      units: units.slice(0, MAX_BULK_MARK).map(unitOf),
      title: `Mark all paid · ${name}`,
      note: capped
        ? `${name} has ${units.length} unpaid units. At most ${MAX_BULK_MARK} can be marked at a time: these first ${MAX_BULK_MARK} are marked now, then mark the rest.`
        : undefined,
    });
  };

  const summary = view.summary;
  const anyFilter = Boolean(team || ownerId || propertyId || status);
  const propertyName = propertyId ? (data?.filters.properties.find((p) => p.propertyId === propertyId)?.name ?? "This building") : null;
  const truncatedNote = data?.truncated
    ? propertyId
      ? `Only the first ${data.maxUnits.toLocaleString("en-US")} units of this building are shown, and the totals count only those.`
      : team || ownerId
        ? `Only the first ${data.maxUnits.toLocaleString("en-US")} units are shown, and the totals count only those. Search for a building to see every unit of it.`
        : `Only the first ${data.maxUnits.toLocaleString("en-US")} units are shown, and the totals count only those. Pick a team or owner, or search for a building, to see every unit of it.`
    : null;

  const statusLabel: Record<StatusFilter, string> = {
    "": `Any status (${summary.total})`,
    unpaid: `Unpaid (${summary.unpaid})`,
    paid: `Paid (${summary.paid})`,
    not_markable: `Not markable (${summary.notMarkable})`,
  };
  /** Click a part of the summary line: that status filter (click the active one again: all). */
  const pickStatus = (s: StatusFilter) => setParam("status", status === s ? "" : s);

  return (
    <div className="pb-10">
      <PageHeader
        title="Payments"
        subtitle="Mark rent received for each unit and month. A payment goes on the owner statement for the month it was received (cash basis), always for the unit's full rent for that month. Change a unit's rent from its ⋯ menu."
      />

      <Card className="px-4 py-4 sm:px-[22px] sm:py-5">
        {/* Toolbar: search + four compact filters on one row (wraps on narrow screens). */}
        <div className="flex flex-wrap items-end gap-2.5">
          <div className="min-w-[220px] flex-[1_1_260px]">
            <SearchBox
              id="pay-search"
              label="Search payments"
              value={search.input}
              onChange={search.setInput}
              onClear={clearSearch}
              placeholder="Search building, address, unit, tenant or owner"
            />
          </div>
          <Field label="Rent month" htmlFor="pay-month" className="w-[calc(50%-5px)] sm:w-[168px]">
            <Select id="pay-month" value={month} onChange={(e) => setParam("month", e.target.value || "")}>
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Team" htmlFor="pay-team" className="w-[calc(50%-5px)] sm:w-[132px]">
            <Select id="pay-team" value={team} onChange={(e) => setParam("team", e.target.value || "")}>
              <option value="">All teams</option>
              {TEAMS.map((t) => (
                <option key={t} value={t}>
                  {TEAM_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Owner" htmlFor="pay-owner" className="w-[calc(50%-5px)] sm:w-[210px]">
            <Select id="pay-owner" value={ownerId} onChange={(e) => setParam("owner", e.target.value || "")}>
              <option value="">All owners</option>
              {(data?.filters.owners ?? []).map((o) => (
                <option key={o.ownerId} value={o.ownerId}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="pay-status" className="w-[calc(50%-5px)] sm:w-[176px]">
            <Select id="pay-status" value={status} onChange={(e) => setParam("status", e.target.value || "")}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s || "all"} value={s}>
                  {statusLabel[s]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {data === undefined ? (
          <Spinner label="Loading rent payments…" />
        ) : (
          <>
            {/* One slim summary line; each part applies its status filter. */}
            <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1.5 text-[13px] text-muted-foreground">
              <SummaryPart active={status === "paid"} onClick={() => pickStatus("paid")} label={`Show the ${summary.paid} paid units`}>
                <b className="font-semibold text-success-ink">{summary.paid} paid</b> · {formatCurrency(summary.receivedCents)} received
              </SummaryPart>
              <Dot />
              <SummaryPart active={status === "unpaid"} onClick={() => pickStatus("unpaid")} label={`Show the ${summary.unpaid} unpaid units`}>
                <b className={cx("font-semibold", summary.unpaid > 0 ? "text-warning-ink" : "text-foreground")}>{summary.unpaid} unpaid</b> ·{" "}
                {formatCurrency(summary.unpaidCents)} expected
              </SummaryPart>
              <Dot />
              <SummaryPart
                active={status === "not_markable"}
                onClick={() => pickStatus("not_markable")}
                label={`Show the ${summary.notMarkable} units that can't be marked`}
              >
                {summary.notMarkable} not markable
              </SummaryPart>
              {propertyName ? (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 py-0.5 pl-2.5 pr-1 text-[12px] text-foreground">
                  Building: {propertyName}
                  <button
                    type="button"
                    aria-label="Show every building"
                    onClick={() => setParam("property", "")}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <X aria-hidden className="h-3 w-3" />
                  </button>
                </span>
              ) : null}
              {status ? (
                <button
                  type="button"
                  onClick={() => setParam("status", "")}
                  className="ml-1 rounded px-1 text-[12.5px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  Show all
                </button>
              ) : null}
              {pageGroups.length > 1 ? (
                <span className="ml-auto hidden items-center gap-1 text-[12.5px] sm:inline-flex">
                  <button
                    type="button"
                    onClick={() => setCollapsed(new Set())}
                    className="rounded px-1 font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    Expand all
                  </button>
                  <Dot />
                  <button
                    type="button"
                    onClick={() => setCollapsed(new Set(pageGroups.map((g) => g.propertyId)))}
                    className="rounded px-1 font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    Collapse all
                  </button>
                </span>
              ) : null}
            </div>

            {data.monthClosed ? (
              <p className="mt-3 rounded-xl border border-border bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">
                {data.monthClosed} This month is shown for reference only.
              </p>
            ) : null}
            {truncatedNote ? (
              <p className="mt-3 rounded-xl border border-warning-ink/30 bg-warning-soft px-3 py-2 text-[12.5px] text-warning-ink">
                {truncatedNote}
              </p>
            ) : null}

            <div className="mt-3">
              <div className="overflow-x-auto rounded-2xl border border-border">
                <table className="w-full min-w-[680px] table-fixed border-collapse text-[13.5px]">
                  <caption className="sr-only">{`Rent payments for ${data.monthLabel}, by building`}</caption>
                  <colgroup>
                    <col className="w-11" />
                    <col className="w-[120px] sm:w-[150px]" />
                    <col />
                    <col className="w-[112px]" />
                    <col className="w-[300px]" />
                  </colgroup>
                  <thead>
                    <tr className="bg-muted text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                      <th scope="col" className="py-2.5 pl-3.5 pr-0 text-left">
                        <label className="inline-flex items-center">
                          <span className="sr-only">Select every unpaid unit on this page</span>
                          <Checkbox
                            checked={allOn}
                            disabled={selectable.length === 0}
                            onChange={(on) => setSelected(on ? new Set(selectable) : new Set())}
                          />
                        </label>
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-left">
                        Unit
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-left">
                        Tenant
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-right">
                        Rent
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-left">
                        Status
                      </th>
                    </tr>
                  </thead>
                  {pageGroups.length === 0 ? (
                    <tbody>
                      <tr>
                        <td colSpan={COLS} className="border-t border-border px-3.5 py-8 text-center text-[12.5px] text-faint">
                          {q ? (
                            <span>
                              No units match &ldquo;{urlQ.trim()}&rdquo;.{" "}
                              <button type="button" onClick={clearSearch} className="font-medium text-primary hover:underline">
                                Clear search
                              </button>
                            </span>
                          ) : anyFilter ? (
                            "No units match these filters."
                          ) : (
                            "No units yet. Units come from the property rosters."
                          )}
                        </td>
                      </tr>
                    </tbody>
                  ) : (
                    pageGroups.map((g) => (
                      <BuildingRows
                        key={g.propertyId}
                        g={g}
                        month={data.month}
                        progress={progress.get(g.propertyId) ?? { paid: 0, due: 0 }}
                        open={!collapsed.has(g.propertyId)}
                        onToggle={() => setCollapsed((s) => flip(s, g.propertyId))}
                        // With the "Not markable" filter the greyed-out units are the list: never folded.
                        greyForced={status === "not_markable"}
                        greyOpen={showGrey.has(g.propertyId)}
                        onToggleGrey={() => setShowGrey((s) => flip(s, g.propertyId))}
                        selected={selected}
                        atCap={atCap}
                        onToggleRow={toggleRow}
                        onMarkAll={() => markAll(g)}
                        onDialog={setDialog}
                      />
                    ))
                  )}
                </table>
              </div>

              {selectedRows.length > 0 ? (
                <BulkBar
                  count={selectedRows.length}
                  cents={selectedCents}
                  atCap={atCap}
                  onMark={() => setDialog({ kind: "bulk", units: selectedRows.map(unitOf) })}
                  onClear={() => setSelected(new Set())}
                />
              ) : null}

              <Pagination
                label="Rent payments pages"
                page={paged.page}
                pageSize={pageSize}
                total={paged.total}
                pageSizes={BUILDING_PAGE_SIZES}
                sizeLabel="Buildings per page"
                noun={paged.total === 1 ? "building" : "buildings"}
                onPage={(p) => setParams({ page: p > 1 ? String(p) : "" })}
                onPageSize={(n) => setParams({ size: String(n) })}
              />
            </div>
          </>
        )}
      </Card>

      {data && dialog?.kind === "mark" ? (
        <MarkDialog
          unit={dialog.unit}
          month={data.month}
          today={data.today}
          earliest={data.earliestReceivedDate}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {data && dialog?.kind === "bulk" ? (
        <BulkMarkDialog
          units={dialog.units}
          month={data.month}
          today={data.today}
          earliest={data.earliestReceivedDate}
          title={dialog.title}
          note={dialog.note}
          onClose={() => setDialog(null)}
          onDone={() => setSelected(new Set())}
        />
      ) : null}
      {data && dialog?.kind === "edit" ? (
        <EditPaymentDialog
          payment={dialog.payment}
          month={data.month}
          today={data.today}
          earliest={data.earliestReceivedDate}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {data && dialog?.kind === "undo" ? (
        <UndoPaymentDialog payment={dialog.payment} month={data.month} onClose={() => setDialog(null)} />
      ) : null}
      {data && dialog?.kind === "rent" ? (
        // The new rent starts in the page's rent month by default.
        <ChangeRentDialog target={{ unitId: dialog.unitId, label: dialog.label }} defaultMonth={data.month} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

function Dot() {
  return (
    <span aria-hidden className="px-0.5 text-faint">
      ·
    </span>
  );
}

function SummaryPart({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={active ? "Show every status" : label}
      onClick={onClick}
      className={cx(
        "rounded-lg px-1.5 py-0.5 tabular-nums transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        active && "bg-accent text-accent-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** One building: its header row, its unit rows and the folded line of units that can't be marked. */
function BuildingRows({
  g,
  month,
  progress,
  open,
  onToggle,
  greyForced,
  greyOpen,
  onToggleGrey,
  selected,
  atCap,
  onToggleRow,
  onMarkAll,
  onDialog,
}: {
  g: PropertyGroup<Row>;
  month: string;
  progress: { paid: number; due: number };
  open: boolean;
  onToggle: () => void;
  greyForced: boolean;
  greyOpen: boolean;
  onToggleGrey: () => void;
  selected: Set<string>;
  atCap: boolean;
  onToggleRow: (r: Row) => void;
  onMarkAll: () => void;
  onDialog: (d: Dialog) => void;
}) {
  const first = g.rows[0];
  const markable = g.active.filter((r) => r.canMark);
  const markableCents = markable.reduce((sum, r) => sum + (r.rentCents ?? 0), 0);
  const ownerProblem = g.rows.find((r) => r.ownerProblem)?.ownerProblem ?? null;
  const owner = first.ownerName ?? (ownerProblem ? null : "No owner");
  const pct = progress.due > 0 ? Math.round((progress.paid / progress.due) * 100) : 0;
  const greyOnly = g.active.length === 0;

  return (
    <tbody>
      {/* Building header: click anywhere (except its button) to fold / unfold. */}
      <tr
        onClick={(e) => {
          if (!fromControl(e.target, e.currentTarget)) onToggle();
        }}
        className="cursor-pointer border-t border-border bg-muted/45 hover:bg-muted"
      >
        <td colSpan={COLS} className="px-3 py-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-expanded={open}
              aria-label={`${first.propertyName}: ${open ? "hide" : "show"} its units`}
              onClick={onToggle}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <ChevronRight
                aria-hidden
                className={cx("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
              />
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-semibold text-foreground" title={first.propertyName}>
                    {first.propertyName}
                  </span>
                  <Pill className="shrink-0">{first.teamLabel}</Pill>
                  {owner ? (
                    <span className="hidden min-w-0 truncate text-[12.5px] text-muted-foreground sm:inline" title={owner}>
                      {owner}
                    </span>
                  ) : null}
                </span>
                {owner ? <span className="block truncate text-[12px] text-muted-foreground sm:hidden">{owner}</span> : null}
              </span>
            </button>

            {ownerProblem ? (
              <Link
                href="/owner-statements/owners"
                title={ownerProblem}
                className="shrink-0 whitespace-nowrap rounded-lg px-1 text-[12px] font-medium text-danger-ink hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {first.ownerName ? "Co-owned" : "No owner"} · fix on Owners
              </Link>
            ) : null}

            {greyOnly ? (
              <span className="shrink-0 whitespace-nowrap text-[12px] text-muted-foreground">Nothing to mark</span>
            ) : (
              <span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[12px] tabular-nums text-muted-foreground">
                <span aria-hidden className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-border md:block">
                  <span className="block h-full rounded-full bg-success-ink" style={{ width: `${pct}%` }} />
                </span>
                <span>
                  <b className="font-semibold text-foreground">{progress.paid}</b> of {progress.due} paid
                </span>
              </span>
            )}

            {markable.length > 0 ? (
              <Btn
                sm
                className="shrink-0 whitespace-nowrap"
                title={`Mark the ${markable.length} unpaid ${markable.length === 1 ? "unit" : "units"} here received (${formatCurrency(markableCents)})`}
                onClick={onMarkAll}
              >
                <CheckCheck aria-hidden className="h-3.5 w-3.5" />
                Mark all paid
              </Btn>
            ) : null}
          </div>
        </td>
      </tr>

      {open
        ? g.active.map((r) => (
            <UnitRow
              key={r.unitId}
              r={r}
              month={month}
              selected={selected.has(r.unitId)}
              disabled={!selected.has(r.unitId) && atCap}
              onToggle={() => onToggleRow(r)}
              onDialog={onDialog}
            />
          ))
        : null}

      {open && g.notMarkable.length > 0 ? (
        <>
          {/* Folded into one line; the "Not markable" filter lists them unfolded with no toggle. */}
          {greyForced ? null : (
            <GreyToggle count={g.notMarkable.length} reasons={reasonsSummary(g.notMarkable)} open={greyOpen} onClick={onToggleGrey} />
          )}
          {greyForced || greyOpen ? g.notMarkable.map((r) => <GreyRow key={r.unitId} r={r} onDialog={onDialog} />) : null}
        </>
      ) : null}
    </tbody>
  );
}

/** The folded line under a building: "3 units not markable (vacant on the roster, …)  Show ▸". */
function GreyToggle({
  count,
  reasons,
  open,
  onClick,
}: {
  count: number;
  reasons: string;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <tr className="border-t border-border">
      <td />
      <td colSpan={COLS - 1} className="px-3 py-1.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={onClick}
          className="flex w-full min-w-0 items-center gap-1.5 rounded-lg text-left text-[12.5px] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span className="shrink-0">
            {count} {count === 1 ? "unit" : "units"} not markable
          </span>
          {reasons && !open ? (
            <span className="min-w-0 truncate text-faint" title={reasons}>
              ({reasons})
            </span>
          ) : null}
          <span className="ml-1 inline-flex shrink-0 items-center gap-0.5 font-medium text-primary">
            {open ? "Hide" : "Show"}
            <ChevronRight aria-hidden className={cx("h-3.5 w-3.5 transition-transform", open && "-rotate-90")} />
          </span>
        </button>
      </td>
    </tr>
  );
}

/** The "Change rent…" menu item: a new rent from a month on (the page's month by default). */
function changeRentItem(r: Row, onDialog: (d: Dialog) => void) {
  return { label: "Change rent…", onSelect: () => onDialog({ kind: "rent", unitId: r.unitId, label: `Unit ${r.unit} · ${r.propertyName}` }) };
}

/** A unit that can't be marked (dim, with the reason). Its ⋯ menu still offers Change rent (e.g. no rent set). */
function GreyRow({ r, onDialog }: { r: Row; onDialog: (d: Dialog) => void }) {
  const tenant = tenantOf(r);
  const rent = rentOf(r);
  return (
    <tr className="border-t border-border bg-muted/20 text-muted-foreground">
      <td className="py-2 pl-3.5" />
      <td className="truncate px-3 py-2 opacity-70" title={`Unit ${r.unit}`}>
        {r.unit}
      </td>
      <td className="truncate px-3 py-2 opacity-70" title={tenant || undefined}>
        {tenant || <span className="text-faint">—</span>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums opacity-70">{rent !== null ? formatCurrency(rent) : "—"}</td>
      <td className="px-3 py-1.5 text-[12.5px]">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate" title={r.reason ?? undefined}>
            Not markable{r.reason ? ` · ${r.reason}` : ""}
          </span>
          <RowMenu label={`Actions for Unit ${r.unit} at ${r.propertyName}`} items={[changeRentItem(r, onDialog)]} />
        </div>
      </td>
    </tr>
  );
}

/** A paid or unpaid unit: one line. A markable unpaid row toggles its checkbox when clicked. */
function UnitRow({
  r,
  month,
  selected,
  disabled,
  onToggle,
  onDialog,
}: {
  r: Row;
  month: string;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  onDialog: (d: Dialog) => void;
}) {
  const tenant = tenantOf(r);
  const rent = rentOf(r);
  const clickable = r.canMark;
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  };
  return (
    <tr
      onClick={
        clickable
          ? (e: MouseEvent<HTMLTableRowElement>) => {
              if (!fromControl(e.target, e.currentTarget)) onToggle();
            }
          : undefined
      }
      onKeyDown={clickable ? onKey : undefined}
      tabIndex={clickable ? 0 : undefined}
      className={cx(
        "border-t border-border",
        clickable &&
          "cursor-pointer hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
        selected && "bg-accent/60 hover:bg-accent/70",
      )}
    >
      <td className="py-2 pl-3.5">
        {r.canMark ? (
          <label className="inline-flex items-center">
            <span className="sr-only">{`Select Unit ${r.unit} at ${r.propertyName}`}</span>
            <Checkbox checked={selected} disabled={disabled} onChange={() => onToggle()} />
          </label>
        ) : null}
      </td>
      <td className="truncate px-3 py-2 font-medium" title={`Unit ${r.unit}`}>
        {r.unit}
      </td>
      <td className="truncate px-3 py-2" title={tenant || undefined}>
        {tenant || <span className="text-faint">—</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{rent !== null ? formatCurrency(rent) : "—"}</td>
      <td className="px-3 py-1.5">
        <StatusCell r={r} month={month} onDialog={onDialog} />
      </td>
    </tr>
  );
}

function StatusCell({ r, month, onDialog }: { r: Row; month: string; onDialog: (d: Dialog) => void }) {
  if (r.status === "unpaid") {
    return (
      <div className="flex items-center justify-between gap-2 whitespace-nowrap">
        <span
          className="inline-flex items-center gap-1.5 text-[12.5px] text-warning-ink"
          title={r.ownerProblem ?? (r.canMark ? undefined : "Rent can't be marked for this month.")}
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          Unpaid
        </span>
        {r.canMark ? (
          <Btn
            sm
            // Outlined in the primary colour (`!`: the default variant sets its own border and text colour).
            className="whitespace-nowrap !border-primary/40 !text-primary hover:!bg-accent"
            aria-label={`Mark Unit ${r.unit} at ${r.propertyName} paid`}
            onClick={() => onDialog({ kind: "mark", unit: unitOf(r) })}
          >
            Mark paid
          </Btn>
        ) : null}
        <RowMenu label={`Actions for Unit ${r.unit} at ${r.propertyName}`} items={[changeRentItem(r, onDialog)]} />
      </div>
    );
  }
  if (r.status !== "paid" || !r.payment) return null;
  const p = r.payment;
  const how = p.kind === "ledger" ? "In the ledger" : p.methodLabel;
  const detail = [
    `Received ${formatDate(p.receivedDate)}`,
    p.methodLabel,
    p.note ? `Note: ${p.note}` : null,
    landsOnText(p.receivedDate),
  ]
    .filter(Boolean)
    .join(" · ");
  const payment = paymentOf(r);
  return (
    <div className="flex items-center justify-between gap-2 whitespace-nowrap">
      <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground" title={detail}>
        <CircleCheck aria-hidden className="h-4 w-4 shrink-0 text-success-ink" />
        <span className="font-medium text-success-ink">Paid</span>
        <span className="min-w-0 truncate tabular-nums">
          {shortDate(p.receivedDate)}
          {how ? ` · ${how}` : ""} {statementShort(p.receivedDate, month)}
        </span>
        <span className="sr-only">{detail}</span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5">
        {p.kind === "ledger" ? (
          <LockMark reason={p.lockedReason} href="/owner-statements/ledger" linkText="Open the Ledger page" />
        ) : p.locked ? (
          <LockMark
            reason={p.lockedReason}
            href={p.statementId ? `/owner-statements/${p.statementId}` : null}
            linkText="Open the statement"
          />
        ) : null}
        <RowMenu
          label={`Actions for Unit ${r.unit} at ${r.propertyName}`}
          items={[
            ...(payment && p.kind === "payment" && !p.locked
              ? [
                  { label: "Edit payment", onSelect: () => onDialog({ kind: "edit", payment }) },
                  { label: "Undo payment…", danger: true, onSelect: () => onDialog({ kind: "undo", payment }) },
                ]
              : []),
            changeRentItem(r, onDialog),
          ]}
        />
      </span>
    </div>
  );
}

/** A locked payment: a lock with the reason as its tooltip (a link to where it can be changed, if any). */
function LockMark({ reason, href, linkText }: { reason: string | null; href: string | null; linkText: string }) {
  const text = reason ?? "This payment can't be changed here.";
  const cls =
    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring";
  return href ? (
    <Link href={href} title={`${text} ${linkText}.`} aria-label={`Locked: ${text} ${linkText}`} className={cx(cls, "hover:bg-muted hover:text-foreground")}>
      <Lock aria-hidden className="h-3.5 w-3.5" />
    </Link>
  ) : (
    <span title={text} role="img" aria-label={`Locked: ${text}`} className={cls}>
      <Lock aria-hidden className="h-3.5 w-3.5" />
    </span>
  );
}

/** Sticky bar while units are ticked: "3 selected · $2,850.00  [Mark selected paid] [Clear]". */
function BulkBar({
  count,
  cents,
  atCap,
  onMark,
  onClear,
}: {
  count: number;
  cents: number;
  atCap: boolean;
  onMark: () => void;
  onClear: () => void;
}) {
  return (
    <div className="sticky bottom-3 z-30 mt-3">
      <div
        role="region"
        aria-label="Selected units"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-primary/30 bg-card px-4 py-2.5 shadow-card"
      >
        <span className="text-[13.5px] tabular-nums" aria-live="polite">
          <b className="font-semibold">{count} selected</b>
          <span className="text-muted-foreground"> · {formatCurrency(cents)}</span>
        </span>
        {atCap ? (
          <span className="text-[12px] text-muted-foreground">
            At most {MAX_BULK_MARK} at a time. Mark these, then select the rest.
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Btn sm onClick={onClear}>
            Clear
          </Btn>
          <Btn sm variant="pri" className="whitespace-nowrap" onClick={onMark}>
            <CheckCheck aria-hidden className="h-3.5 w-3.5" />
            Mark selected paid
          </Btn>
        </div>
      </div>
    </div>
  );
}
