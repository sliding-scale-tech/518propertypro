"use client";

import type { FunctionReturnType } from "convex/server";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { api } from "@/convex/_generated/api";
import { toast } from "@/components/ui/toast";
import { Avatar, cx } from "@/components/ui";
import { DesignSelect } from "./design-select";
import { PriorityChip, StatusPill } from "./chips";
import { ago, fmtDay, fmtStamp, shortPerson, STATUS_LABELS, type StatusKey, type TableStatus } from "./shared";

export type KanbanData = FunctionReturnType<typeof api.board.kanban>;
export type KanbanColumn = KanbanData["columns"][number];
export type KanbanCardData = KanbanColumn["cards"][number];
export type TableData = FunctionReturnType<typeof api.board.table>;
export type TableRow = TableData["rows"][number];
export type ItemRef = { kind: "request" | "work_order"; id: string };

const AVATAR_TONE = { asset_manager: "acc", technician: "ok" } as const;

export const TABLE_CHIPS: Array<{ value: TableStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "am_review", label: "Asset Manager Review" },
  { value: "admin_review", label: "Admin Review" },
  { value: "escalated", label: "Escalated" },
  { value: "in_progress", label: "Work in Progress" },
  { value: "completed", label: "Completed (Needs Sign Off)" },
  { value: "closed", label: "Closed" },
];

// --- Kanban ---------------------------------------------------------------------------------

const COLUMN_STYLE: Record<string, { wash: string; icon: LucideIcon; iconWrap: string }> = {
  am_review: { wash: "border-slate-200 bg-slate-50/80", icon: Eye, iconWrap: "bg-slate-100 text-slate-600" },
  admin_review: { wash: "border-violet-100 bg-violet-50/70", icon: ShieldCheck, iconWrap: "bg-violet-100 text-violet-600" },
  escalated: { wash: "border-amber-100 bg-amber-50/80", icon: AlertTriangle, iconWrap: "bg-amber-100 text-amber-600" },
  in_progress: { wash: "border-sky-100 bg-sky-50/80", icon: Clock3, iconWrap: "bg-sky-100 text-sky-600" },
  completed: { wash: "border-emerald-100 bg-emerald-50/70", icon: CheckCircle2, iconWrap: "bg-emerald-100 text-emerald-600" },
};

function place(card: { propertyName: string | null; unitNumber: string | null }): string {
  const property = card.propertyName || "Unknown property";
  return card.unitNumber ? `${property} • Unit ${card.unitNumber}` : property;
}

export function BoardCard({ card, onOpen }: { card: KanbanCardData; onOpen: (ref: ItemRef) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen({ kind: card.kind, id: card.id })}
      className={cx(
        "flex w-full flex-col rounded-[14px] border border-slate-200/80 border-l-[4px] bg-white px-3.5 py-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        priorityBorder(card.priorityLevel),
      )}
    >
      <div className="flex items-center justify-between gap-2 text-[12px] text-slate-500">
        <span className="font-medium text-slate-700">{card.number}</span>
        <span className="inline-flex items-center gap-1">
          <Clock3 aria-hidden className="h-3 w-3" />
          {ago(card.createdAt)}
        </span>
      </div>
      <div className="mt-1.5 text-[14px] font-semibold leading-snug text-slate-900">{card.title}</div>
      <div className="mt-0.5 truncate text-[12px] text-slate-400">{place(card)}</div>
      <div className="mt-2.5">
        <PriorityChip level={card.priorityLevel} score={card.severityScore} />
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-2.5 text-[12px] text-slate-600">
        {card.assignee ? (
          <>
            <Avatar name={card.assignee.name} tone={AVATAR_TONE[card.assignee.role]} size="sm" />
            <span className="truncate">{shortPerson(card.assignee.name)}</span>
          </>
        ) : (
          <span className="text-slate-500">Unassigned</span>
        )}
        <span className="ml-auto inline-flex items-center gap-1 text-slate-400">
          <MessageSquare aria-hidden className="h-3.5 w-3.5" />
          {card.commentCount}
        </span>
        <span className="inline-flex items-center gap-1 text-slate-400">
          <Paperclip aria-hidden className="h-3.5 w-3.5" />
          {card.attachmentCount}
        </span>
        <ChevronRight aria-hidden className="h-3.5 w-3.5 text-slate-300" />
      </div>
    </button>
  );
}

function priorityBorder(level: string): string {
  if (level === "emergency") return "border-l-rose-500";
  if (level === "urgent") return "border-l-orange-500";
  if (level === "informational") return "border-l-slate-300";
  return "border-l-sky-500";
}

export function Kanban({ columns, onOpen }: { columns: KanbanColumn[]; onOpen: (ref: ItemRef) => void }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-3">
      <div className="flex min-w-max items-start gap-4">
        {columns.map((col) => {
          const style = COLUMN_STYLE[col.key] ?? COLUMN_STYLE.am_review!;
          const Icon = style.icon;
          return (
            <section key={col.key} aria-label={col.title} className="w-[290px] shrink-0 xl:w-auto xl:min-w-[260px] xl:flex-1">
              <div className={cx("rounded-[18px] border p-3.5", style.wash)}>
                <div className="flex items-center gap-2 text-[13.5px] font-semibold text-slate-900">
                  <span className={cx("inline-flex h-6 w-6 items-center justify-center rounded-md", style.iconWrap)}>
                    <Icon aria-hidden className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{col.title}</span>
                  <span className="rounded-full bg-white/80 px-2 text-[11.5px] font-medium tabular-nums text-slate-500">
                    {col.count}
                  </span>
                </div>
                <p className="mt-1.5 text-[12px] leading-snug text-slate-500">{col.subtitle}</p>
              </div>
              <div className="mt-3 flex flex-col gap-3">
                {col.cards.length === 0 ? (
                  <div className="rounded-[14px] border border-dashed border-slate-200 bg-white/70 py-8 text-center text-[12.5px] text-slate-400">
                    Nothing here
                  </div>
                ) : (
                  col.cards.map((c) => <BoardCard key={c.id} card={c} onOpen={onOpen} />)
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// --- Table ----------------------------------------------------------------------------------

export function StatusChips({
  value,
  counts,
  onChange,
}: {
  value: TableStatus;
  counts: TableData["counts"];
  onChange: (v: TableStatus) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {TABLE_CHIPS.map((f) => {
        const on = value === f.value;
        return (
          <button
            key={f.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(f.value)}
            className={cx(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium transition-colors",
              on ? "bg-blue-600 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            {f.label}
            <span
              className={cx(
                "tabular-nums",
                on ? "rounded-full bg-white/20 px-1.5 text-white" : "text-slate-400",
              )}
            >
              {counts[f.value] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const PAGE_SIZES = [15, 30, 50];

function pageList(current: number, count: number): Array<number | "gap-l" | "gap-r"> {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const out: Array<number | "gap-l" | "gap-r"> = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(count - 1, current + 1);
  if (from > 2) out.push("gap-l");
  for (let i = from; i <= to; i++) out.push(i);
  if (to < count - 1) out.push("gap-r");
  out.push(count);
  return out;
}

export function WorkOrderTable({
  data,
  onPage,
  onPageSize,
  onOpen,
}: {
  data: TableData;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  onOpen: (ref: ItemRef) => void;
}) {
  const { rows, total, page, pageSize, pageCount } = data;
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ row: TableRow; left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const allOn = rows.length > 0 && rows.every((r) => picked[r.id]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onPointer = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  const copyLink = async (row: TableRow) => {
    const url = `${window.location.origin}/work-orders?open=${row.kind}:${row.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy the link.");
    }
  };

  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="w-10 px-4 py-3.5">
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={allOn}
                  onChange={() => {
                    const next = { ...picked };
                    for (const row of rows) next[row.id] = !allOn;
                    setPicked(next);
                  }}
                />
              </th>
              <th className="px-2 py-3.5">#ID</th>
              <th className="px-2 py-3.5">Unit</th>
              <th className="px-2 py-3.5">Property</th>
              <th className="px-2 py-3.5">Issue</th>
              <th className="px-2 py-3.5">Priority</th>
              <th className="px-2 py-3.5">Status</th>
              <th className="px-2 py-3.5">Assigned To</th>
              <th className="px-2 py-3.5">Due Date</th>
              <th className="px-2 py-3.5">Created</th>
              <th className="w-10 px-2 py-3.5" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-14 text-center text-slate-400">
                  No work orders match these filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const openRef: ItemRef = { kind: row.kind, id: row.id };
                const key = row.statusKey as StatusKey;
                return (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-b border-slate-50 hover:bg-slate-50/80"
                    onClick={() => onOpen(openRef)}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.number}`}
                        checked={!!picked[row.id]}
                        onChange={() => setPicked((p) => ({ ...p, [row.id]: !p[row.id] }))}
                      />
                    </td>
                    <td className="whitespace-nowrap px-2 py-3 font-medium text-slate-800">{row.number}</td>
                    <td className="px-2 py-3 text-slate-600">{row.unitNumber ?? "—"}</td>
                    <td className="max-w-[140px] px-2 py-3 text-slate-600">{row.propertyName ?? "—"}</td>
                    <td className="max-w-[200px] px-2 py-3 font-medium text-slate-800">
                      <span className="line-clamp-2">{row.issue}</span>
                    </td>
                    <td className="px-2 py-3">
                      <PriorityChip level={row.priorityLevel} score={row.severityScore} />
                    </td>
                    <td className="px-2 py-3">
                      <StatusPill statusKey={key} label={row.statusLabel || STATUS_LABELS[key]} />
                    </td>
                    <td className="px-2 py-3">
                      {row.assignee ? (
                        <span className="inline-flex items-center gap-1.5 text-slate-700">
                          <Avatar name={row.assignee.name} tone={AVATAR_TONE[row.assignee.role]} size="sm" />
                          {shortPerson(row.assignee.name)}
                        </span>
                      ) : (
                        <span className="text-slate-400">Unassigned</span>
                      )}
                    </td>
                    <td className="px-2 py-3 text-slate-600">{row.dueDate ? fmtDay(row.dueDate) : "—"}</td>
                    <td className="px-2 py-3 text-slate-500">{fmtStamp(row.createdAt)}</td>
                    <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        aria-label={`Actions for ${row.number}`}
                        aria-haspopup="menu"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setMenu(
                            menu?.row.id === row.id
                              ? null
                              : { row, left: Math.max(8, rect.right - 140), top: Math.min(rect.bottom + 4, window.innerHeight - 100) },
                          );
                        }}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {menu ? (
        <div
          ref={menuRef}
          role="menu"
          style={{ position: "fixed", left: menu.left, top: menu.top, width: 140 }}
          className="z-40 rounded-lg border border-slate-200 bg-white py-1 text-[13px] shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-2 text-left hover:bg-slate-50"
            onClick={() => {
              const ref = { kind: menu.row.kind, id: menu.row.id };
              setMenu(null);
              onOpen(ref);
            }}
          >
            Open
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-2 text-left hover:bg-slate-50"
            onClick={() => {
              const row = menu.row;
              setMenu(null);
              void copyLink(row);
            }}
          >
            Copy link
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3.5 text-[12.5px] text-slate-500">
        <span>
          {total === 0 ? (
            "Showing 0 work orders"
          ) : (
            <>
              Showing <b className="font-semibold text-slate-700">{first}–{last}</b> of{" "}
              <b className="font-semibold text-slate-700">{total}</b> work orders
            </>
          )}
        </span>
        <div className="flex items-center gap-1">
          <PageBtn label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </PageBtn>
          {pageList(page, pageCount).map((p) =>
            typeof p === "number" ? (
              <button
                key={p}
                type="button"
                aria-label={`Page ${p}`}
                aria-current={p === page ? "page" : undefined}
                onClick={() => onPage(p)}
                className={cx(
                  "inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2",
                  p === page ? "border border-sky-200 bg-sky-50 font-medium text-sky-700" : "text-slate-600 hover:bg-slate-100",
                )}
              >
                {p}
              </button>
            ) : (
              <span key={p} className="px-1 text-slate-400">
                …
              </span>
            ),
          )}
          <PageBtn label="Next page" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
            <ChevronRight className="h-4 w-4" />
          </PageBtn>
          <span className="ml-2">
            <DesignSelect
              ariaLabel="Rows per page"
              variant="page"
              value={String(pageSize)}
              onChange={(v) => onPageSize(Number(v))}
              options={PAGE_SIZES.map((n) => ({ value: String(n), label: `${n} / page` }))}
            />
          </span>
        </div>
      </div>
    </div>
  );
}

function PageBtn({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

