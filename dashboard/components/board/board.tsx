"use client";

import type { FunctionReturnType } from "convex/server";
import { Building2 } from "lucide-react";
import type { api } from "@/convex/_generated/api";
import { Avatar, Card, CardHead, DataTable, Pill, SevChip, cx, type Column } from "@/components/ui";
import { fmtDateTime, fmtMoney, hoursText, mrId, woId, type Lane } from "./shared";

export type BoardData = FunctionReturnType<typeof api.board.lanes>;
export type BoardCardData = BoardData["lanes"][Lane][number];
export type ClosedRow = BoardData["closedThisMonth"]["rows"][number];
export type ItemRef = { kind: "request" | "work_order"; id: string };

const AVATAR_TONE = { asset_manager: "acc", technician: "ok" } as const;

function firstTwoWords(s: string): string {
  return s.split(/\s+/).slice(0, 2).join(" ");
}

export function BoardCard({ card, onOpen }: { card: BoardCardData; onOpen: (ref: ItemRef) => void }) {
  const showBar = card.kind === "work_order" && card.checklistTotal > 0;
  return (
    <button
      type="button"
      onClick={() => onOpen({ kind: card.kind, id: card.id })}
      className="flex w-full flex-col gap-[7px] rounded-[14px] border border-border bg-card px-3 py-[11px] text-left transition-shadow hover:border-accent-line hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
        <span className="font-mono">{card.kind === "request" ? mrId(card.number) : woId(card.number)}</span>
        <SevChip level={card.severity} score={card.severityScore ?? undefined} />
        {card.covering ? <Pill tone="neutral">Covering</Pill> : null}
        {card.needsPhotos ? (
          <Pill tone="warn" className="ml-auto">
            Photos requested
          </Pill>
        ) : null}
      </div>
      <div className="font-medium leading-[1.35]">{card.title}</div>
      {showBar ? (
        <div
          role="progressbar"
          aria-label="Checklist progress"
          aria-valuemin={0}
          aria-valuemax={card.checklistTotal}
          aria-valuenow={card.checklistDone}
          className="h-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-success-ink"
            style={{ width: `${(card.checklistDone / card.checklistTotal) * 100}%` }}
          />
        </div>
      ) : null}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Building2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          {card.propertyName ? firstTwoWords(card.propertyName) : "Unknown property"}
          {card.unitNumber ? ` · ${card.unitNumber}` : ""}
        </span>
        {card.avatar ? (
          <Avatar name={card.avatar.name} tone={AVATAR_TONE[card.avatar.role]} size="sm" className="ml-auto" />
        ) : null}
      </div>
    </button>
  );
}

export function BoardColumn({
  title,
  who,
  cards,
  onOpen,
}: {
  title: string;
  who: string;
  cards: BoardCardData[];
  onOpen: (ref: ItemRef) => void;
}) {
  return (
    <section aria-label={title} className="flex min-h-[180px] flex-col gap-2 rounded-[18px] bg-muted p-2.5">
      <div className="flex items-center px-1.5 pt-1 text-[13px] font-semibold">
        {title}
        <span className="ml-auto text-xs font-medium text-muted-foreground">{cards.length}</span>
      </div>
      <div className="-mt-1.5 px-1.5 pb-1 text-[11.5px] text-muted-foreground">{who}</div>
      {cards.length === 0 ? (
        <div className="py-[18px] text-center text-[12.5px] text-faint">Nothing here</div>
      ) : (
        cards.map((c) => <BoardCard key={c.id} card={c} onOpen={onOpen} />)
      )}
    </section>
  );
}

function names(cards: BoardCardData[], fallback: string): string {
  const set = [...new Set(cards.map((c) => c.avatar?.name).filter((n): n is string => !!n))];
  return set.length ? set.join(", ") : fallback;
}

export function Board({
  data,
  lane,
  onOpen,
}: {
  data: BoardData;
  lane: Lane | null;
  onOpen: (ref: ItemRef) => void;
}) {
  const leads = data.maintenanceLeads;
  // A15: name the person only when there is exactly one maintenance lead.
  const leadName = leads.length === 1 ? leads[0].name : null;
  const columns: Array<{ lane: Lane; title: string; who: string }> = [
    { lane: "review", title: "Asset manager review", who: names(data.lanes.review, "Asset managers") },
    {
      lane: "pat",
      title: leadName ? `Waiting on ${leadName}` : "Waiting on maintenance lead",
      who: "Creates the work order and assigns",
    },
    { lane: "tech", title: "With technician", who: names(data.lanes.tech, "Technicians") },
    {
      lane: "signoff",
      title: "Completed · needs sign-off",
      who: `${leadName ?? "The maintenance lead"} reviews the evidence`,
    },
  ];
  const shown = lane ? columns.filter((c) => c.lane === lane) : columns;
  return (
    <div
      className={cx(
        "grid gap-3.5 overflow-x-auto pb-1.5",
        shown.length === 4 ? "grid-cols-[repeat(4,minmax(250px,1fr))]" : "grid-cols-[minmax(250px,1fr)]",
      )}
    >
      {shown.map((c) => (
        <BoardColumn key={c.lane} title={c.title} who={c.who} cards={data.lanes[c.lane]} onOpen={onOpen} />
      ))}
    </div>
  );
}

export function ClosedTable({ data, onOpen }: { data: BoardData["closedThisMonth"]; onOpen: (ref: ItemRef) => void }) {
  const columns: Column<ClosedRow>[] = [
    {
      key: "wo",
      header: "Work order",
      render: (r) => (
        <div>
          <div className="font-medium">{r.title}</div>
          <div className="font-mono text-xs text-muted-foreground">
            {r.kind === "request" ? mrId(r.number) : woId(r.number)}
          </div>
        </div>
      ),
    },
    {
      key: "unit",
      header: "Unit",
      render: (r) => (
        <span>
          {r.propertyName ?? "Unknown"}
          {r.unitNumber ? ` · ${r.unitNumber}` : ""}
        </span>
      ),
    },
    {
      key: "outcome",
      header: "Outcome",
      render: (r) => (
        <Pill tone={r.outcome === "Closed" ? "ok" : "bad"}>
          {r.outcome === "Closed" ? `Closed ${fmtDateTime(r.closedAt).split(",")[0]}` : r.outcome}
        </Pill>
      ),
    },
    { key: "hours", header: "Hours", align: "right", render: (r) => (r.hours > 0 ? hoursText(r.hours) : "—") },
    {
      key: "materials",
      header: "Materials",
      align: "right",
      render: (r) => (r.materialsCents > 0 ? fmtMoney(r.materialsCents) : "—"),
    },
  ];
  return (
    <Card>
      <CardHead title="Closed and rejected this month" right={`${data.totals.count}`} />
      <DataTable
        caption="Closed and rejected this month"
        columns={columns}
        rows={data.rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => onOpen({ kind: r.kind, id: r.id })}
        empty="Nothing closed or rejected yet this month."
      />
    </Card>
  );
}
