"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import * as sched from "@/convex/tourSchedule";
import { Btn, IconBtn, PageHeader, Seg, cx } from "@/components/ui";
import { ManagerAvailabilityModal } from "./manager-availability";

type Mode = "week" | "month";
type Tour = FunctionReturnType<typeof api.assetManagers.calendar>["tours"][number];

const HOUR_PX = 56;
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dow(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function dayNum(dateKey: string): number {
  return Number(dateKey.slice(8, 10));
}
function monthTitle(dateKey: string): string {
  const [y, m] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
function addMonths(dateKey: string, delta: number): string {
  const [y, m] = dateKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
function hourLabel(h: number): string {
  return `${h % 12 === 0 ? 12 : h % 12} ${h >= 12 ? "PM" : "AM"}`;
}
function bedLabel(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim().slice(0, 30);
  if (/^studio$/i.test(t)) return "Studio";
  const m = /^(\d+)/.exec(t);
  if (m) return `${Number(m[1])} Bedroom${Number(m[1]) === 1 ? "" : "s"}`;
  return t || null;
}

export function ManagerCalendar({ userId }: { userId: Id<"users"> }) {
  const profile = useQuery(api.assetManagers.profile, { userId });
  const tz = profile?.timeZone;
  const [mode, setMode] = useState<Mode>("week");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [availOpen, setAvailOpen] = useState(false);

  const [nowMs] = useState(() => Date.now());
  const today = tz ? sched.localDateKey(nowMs, tz) : null;
  const anchorKey = anchor ?? today;

  const range = useMemo(() => {
    if (!tz || !anchorKey) return null;
    const first = mode === "week" ? anchorKey : `${anchorKey.slice(0, 8)}01`;
    const gridStart = sched.addDays(first, -dow(first));
    const days = mode === "week" ? 7 : 42;
    return {
      gridStart,
      days,
      from: sched.startOfLocalDay(gridStart, tz),
      to: sched.startOfLocalDay(sched.addDays(gridStart, days), tz),
    };
  }, [tz, anchorKey, mode]);

  const cal = useQuery(api.assetManagers.calendar, range ? { userId, from: range.from, to: range.to } : "skip");

  const firstName = profile?.name.trim().split(/\s+/)[0] ?? "their";
  const step = (dir: 1 | -1) => {
    if (!anchorKey) return;
    setAnchor(mode === "week" ? sched.addDays(anchorKey, 7 * dir) : addMonths(anchorKey, dir));
  };

  return (
    <div className="space-y-5 pb-10">
      <PageHeader title="Calendar" subtitle={`View ${firstName}’s tour bookings and manage their availability.`} />
      <div className="flex flex-wrap items-center gap-3">
        <Btn className="h-10 px-4" onClick={() => setAnchor(null)}>
          Today
        </Btn>
        <div className="flex items-center gap-1">
          <IconBtn label={mode === "week" ? "Previous week" : "Previous month"} onClick={() => step(-1)} className="border-transparent bg-transparent">
            <ChevronLeft />
          </IconBtn>
          <IconBtn label={mode === "week" ? "Next week" : "Next month"} onClick={() => step(1)} className="border-transparent bg-transparent">
            <ChevronRight />
          </IconBtn>
        </div>
        <h2 className="text-[20px] font-semibold tracking-[-0.01em]">{range ? monthTitle(mode === "week" ? sched.addDays(range.gridStart, 3) : (anchorKey ?? "")) : " "}</h2>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <Btn variant="pri" className="h-10 px-4 font-semibold" onClick={() => setAvailOpen(true)}>
            Edit Availability
          </Btn>
          <Seg<Mode>
            label="Calendar view"
            value={mode}
            onChange={setMode}
            options={[
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
            ]}
          />
        </div>
      </div>

      {tz && range && today ? (
        mode === "week" ? (
          <WeekGrid gridStart={range.gridStart} today={today} tz={tz} tours={cal?.tours ?? []} />
        ) : (
          <MonthGrid
            gridStart={range.gridStart}
            monthKey={anchorKey!.slice(0, 7)}
            today={today}
            tz={tz}
            tours={cal?.tours ?? []}
            onPickDay={(d) => {
              setAnchor(d);
              setMode("week");
            }}
          />
        )
      ) : (
        <p className="py-10 text-center text-[13px] text-muted-foreground">Loading…</p>
      )}
      {cal && !cal.teamTimeZoneSet ? (
        <p className="text-xs text-muted-foreground">The team time zone is not set yet, so times are shown in {cal.timeZone}.</p>
      ) : null}
      {availOpen ? <ManagerAvailabilityModal userId={userId} onClose={() => setAvailOpen(false)} /> : null}
    </div>
  );
}

type Placed = { tour: Tour; day: string; top: number; height: number; lane: number; lanes: number; time: string };

function WeekGrid({ gridStart, today, tz, tours }: { gridStart: string; today: string; tz: string; tours: Tour[] }) {
  const days = Array.from({ length: 7 }, (_, i) => sched.addDays(gridStart, i));

  const { startHour, endHour, placed } = useMemo(() => {
    const mins = (ms: number) => {
      const p = sched.zonedParts(ms, tz);
      return p.hour * 60 + p.minute;
    };
    let s = 9;
    let e = 19;
    for (const t of tours) {
      s = Math.min(s, Math.floor(mins(t.start) / 60));
      e = Math.max(e, Math.ceil((mins(t.start) + (t.end - t.start) / 60000) / 60));
    }
    e = Math.min(24, e);
    const byDay = new Map<string, Placed[]>();
    const fmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
    for (const t of tours.slice().sort((a, b) => a.start - b.start)) {
      const day = sched.localDateKey(t.start, tz);
      const list = byDay.get(day) ?? [];
      const top = ((mins(t.start) - s * 60) / 60) * HOUR_PX;
      const height = Math.max(40, ((t.end - t.start) / 3_600_000) * HOUR_PX - 2);
      list.push({ tour: t, day, top, height, lane: 0, lanes: 1, time: fmt.format(t.start) });
      byDay.set(day, list);
    }
    // Overlapping tours sit side by side.
    for (const list of byDay.values()) {
      const laneEnds: number[] = [];
      for (const p of list) {
        let lane = laneEnds.findIndex((end) => end <= p.top);
        if (lane === -1) lane = laneEnds.push(p.top + p.height) - 1;
        else laneEnds[lane] = p.top + p.height;
        p.lane = lane;
      }
      for (const p of list) p.lanes = laneEnds.length;
    }
    return { startHour: s, endHour: e, placed: byDay };
  }, [tours, tz]);

  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  return (
    <div className="overflow-x-auto rounded-[20px] border border-border bg-card p-4">
      <div className="min-w-[760px]">
        <div className="grid grid-cols-[64px_repeat(7,1fr)]">
          <div />
          {days.map((d) => {
            const isToday = d === today;
            return (
              <div key={d} className="pb-2 text-center">
                <div className={cx("text-xs", isToday ? "font-medium text-primary" : "text-muted-foreground")}>{DAY_LABELS[dow(d)]}</div>
                <div
                  className={cx(
                    "mx-auto mt-0.5 inline-flex h-7 min-w-7 items-center justify-center rounded-full text-[14px] font-semibold",
                    isToday && "bg-primary text-primary-foreground",
                  )}
                  aria-current={isToday ? "date" : undefined}
                >
                  {dayNum(d)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-[64px_repeat(7,1fr)] border-t border-border">
          <div>
            {hours.map((h) => (
              <div key={h} style={{ height: HOUR_PX }} className="-mt-0 pr-2 pt-0 text-right text-[11.5px] text-muted-foreground">
                <span className="relative -top-2">{hourLabel(h)}</span>
              </div>
            ))}
          </div>
          {days.map((d) => (
            <div key={d} className={cx("relative border-l border-border", d === today && "bg-accent/30")} style={{ height: hours.length * HOUR_PX }}>
              {hours.map((h, i) => (
                <div key={h} style={{ top: i * HOUR_PX, height: HOUR_PX }} className="absolute inset-x-0 border-b border-border/70" />
              ))}
              {(placed.get(d) ?? []).map((p) => (
                <div
                  key={p.tour.id}
                  style={{
                    top: p.top + 1,
                    height: p.height,
                    left: `calc(${(p.lane / p.lanes) * 100}% + 3px)`,
                    width: `calc(${100 / p.lanes}% - 6px)`,
                  }}
                  className="absolute overflow-hidden rounded-lg border border-accent-line bg-accent px-2 py-1.5 text-[11.5px] leading-snug"
                >
                  <div className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />
                    {p.time}
                  </div>
                  <div className="font-semibold text-foreground">{p.tour.title}</div>
                  {bedLabel(p.tour.bedrooms) ? <div className="text-muted-foreground">{bedLabel(p.tour.bedrooms)}</div> : null}
                  {p.tour.propertyName ? (
                    <div className="mt-0.5 flex items-start gap-1 text-[10.5px] text-faint">
                      <MapPin aria-hidden className="mt-px h-3 w-3 shrink-0" />
                      <span>{p.tour.propertyName}</span>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({
  gridStart,
  monthKey,
  today,
  tz,
  tours,
  onPickDay,
}: {
  gridStart: string;
  monthKey: string;
  today: string;
  tz: string;
  tours: Tour[];
  onPickDay: (day: string) => void;
}) {
  const days = Array.from({ length: 42 }, (_, i) => sched.addDays(gridStart, i));
  const byDay = new Map<string, Tour[]>();
  for (const t of tours.slice().sort((a, b) => a.start - b.start)) {
    const day = sched.localDateKey(t.start, tz);
    byDay.set(day, [...(byDay.get(day) ?? []), t]);
  }
  const fmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  return (
    <div className="overflow-x-auto rounded-[20px] border border-border bg-card p-4">
      <div className="min-w-[700px]">
        <div className="grid grid-cols-7 pb-2 text-center text-xs text-muted-foreground">
          {DAY_LABELS.map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 border-l border-t border-border">
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            const inMonth = d.startsWith(monthKey);
            const isToday = d === today;
            return (
              <button
                key={d}
                type="button"
                onClick={() => onPickDay(d)}
                aria-label={`${d}, ${list.length} tour${list.length === 1 ? "" : "s"}`}
                className={cx(
                  "flex min-h-[96px] flex-col items-stretch gap-1 border-b border-r border-border p-1.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring",
                  !inMonth && "bg-muted/30 text-faint",
                )}
              >
                <span
                  className={cx(
                    "inline-flex h-6 min-w-6 items-center justify-center self-start rounded-full px-1 text-[12.5px] font-semibold",
                    isToday && "bg-primary text-primary-foreground",
                  )}
                >
                  {dayNum(d)}
                </span>
                {list.slice(0, 2).map((t) => (
                  <span key={t.id} className="truncate rounded-md bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-foreground">
                    {fmt.format(t.start)} Tour
                  </span>
                ))}
                {list.length > 2 ? <span className="px-1 text-[11px] text-muted-foreground">+{list.length - 2} more</span> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
