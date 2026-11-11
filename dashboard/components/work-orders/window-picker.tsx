"use client";

import { useQuery } from "convex/react";
import { CalendarClock, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { api } from "@/convex/_generated/api";
import { addDays, addMonths, localDateKey, monthGridRange, monthKeyOf, zonedParts, zonedToUtc } from "@/convex/tourSchedule";
import { resolveTimeZone, tenantPreferredTimeText, windowLabel } from "@/convex/workOrderWindow";
import { browserTimeZone } from "@/components/dashboard/format";
import { cx } from "@/components/ui";

/** A picked appointment window, epoch ms. */
export type WindowValue = { start: number; end: number };

const DAY_START = 6 * 60;
const DAY_END = 22 * 60;
const STEP = 30;
const DEFAULT_LENGTH = 120;
const MAX_LENGTH = 12 * 60;
const QUICK = [
  { label: "Today 1–3 PM", inDays: 0, start: 13 * 60, end: 15 * 60 },
  { label: "Today 3–5 PM", inDays: 0, start: 15 * 60, end: 17 * 60 },
  { label: "Tomorrow 9–11 AM", inDays: 1, start: 9 * 60, end: 11 * 60 },
  { label: "Tomorrow 1–3 PM", inDays: 1, start: 13 * 60, end: 15 * 60 },
];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const POPOVER_W = 320;
const POPOVER_H = 520;
const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const TRIGGER = {
  field:
    "h-[34px] w-full gap-2 rounded-[8px] border border-[#e2e8f0] bg-white px-[11px] text-[12px] font-medium leading-4 text-[#1e293b] focus-visible:ring-2 focus-visible:ring-[#2563eb]/30 disabled:bg-[#f7f7f7]",
  input:
    "w-full gap-2 rounded-xl border border-input bg-card px-[11px] py-2 text-[13.5px] text-foreground transition-colors focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60",
};

/** The team's time zone (the browser's until an admin sets one), or null while it loads. */
export function useWindowTimeZone(): string | null {
  const settings = useQuery(api.tours.availabilitySettings);
  if (settings === undefined) return null;
  return resolveTimeZone(settings?.timeZone, browserTimeZone());
}

type Draft = { day: string | null; start: number; end: number };

function instant(dateKey: string, minutes: number, timeZone: string): number {
  const day = addDays(dateKey, Math.floor(minutes / 1440));
  const m = minutes % 1440;
  const [year, month, date] = day.split("-").map(Number);
  return zonedToUtc({ year, month, day: date, hour: Math.floor(m / 60), minute: m % 60 }, timeZone);
}

function draftOf(value: WindowValue | null, timeZone: string): Draft {
  if (!value) return { day: null, start: 9 * 60, end: 9 * 60 + DEFAULT_LENGTH };
  const p = zonedParts(value.start, timeZone);
  const start = p.hour * 60 + p.minute;
  return { day: localDateKey(value.start, timeZone), start, end: start + Math.round((value.end - value.start) / 60_000) };
}

function clockText(minutes: number): string {
  const m = minutes % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}${minutes >= 1440 ? " (next day)" : ""}`;
}

function steps(from: number, to: number, keep: number): number[] {
  const out: number[] = [];
  for (let m = from; m <= to; m += STEP) out.push(m);
  if (!out.includes(keep)) out.push(keep);
  return out.sort((a, b) => a - b);
}

function utcDate(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
const monthTitle = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const dayName = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * What the tenant asked for, in their own words, shown under the picker so staff see it while
 * scheduling. Renders nothing when there is no answer. It never fills in the window.
 */
export function TenantPreferredTime({ value }: { value: string | null | undefined }) {
  const text = tenantPreferredTimeText(value);
  if (!text) return null;
  return (
    <span className="block break-words text-[12px] leading-snug text-muted-foreground">
      <span className="font-medium text-foreground">Tenant&apos;s preferred time:</span> {text}
    </span>
  );
}

/**
 * Appointment-window picker: a month calendar with start and end times in 30-minute steps, a few
 * quick picks, and "No window set". Times are the team's (useWindowTimeZone). `legacyLabel` shows
 * an older free-text window that has no start / end.
 */
export function WindowPicker({
  value,
  onChange,
  legacyLabel,
  disabled,
  variant = "field",
  ariaLabel = "Time window",
  placeholder = "No window set",
}: {
  value: WindowValue | null;
  onChange?: (next: WindowValue | null) => void;
  legacyLabel?: string | null;
  disabled?: boolean;
  variant?: "field" | "input";
  ariaLabel?: string;
  placeholder?: string;
}) {
  const dialogId = useId();
  const timeZone = useWindowTimeZone();
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number; width: number; maxH: number } | null>(null);
  const [draft, setDraft] = useState<Draft>({ day: null, start: 9 * 60, end: 11 * 60 });
  const [month, setMonth] = useState("");
  const [focusDay, setFocusDay] = useState("");
  // Refreshed each time the popover opens, so "today" and the quick picks are current.
  const [now, setNow] = useState(() => Date.now());

  const inactive = disabled || !onChange || !timeZone;
  const display = value && timeZone ? windowLabel(value.start, value.end, timeZone, now) : (legacyLabel ?? null);

  const openPicker = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect || inactive || !timeZone) return;
    const width = Math.min(POPOVER_W, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    let top: number;
    let maxH: number;
    if (below >= POPOVER_H || below >= above) {
      top = rect.bottom + 4;
      maxH = Math.max(below, 200);
    } else {
      maxH = above;
      top = Math.max(8, rect.top - 4 - Math.min(POPOVER_H, above));
    }
    const next = draftOf(value, timeZone);
    const at = Date.now();
    const today = localDateKey(at, timeZone);
    setNow(at);
    setDraft(next);
    setMonth(monthKeyOf(next.day ?? today));
    setFocusDay(next.day ?? today);
    setCoords({ left, top, width, maxH: Math.min(maxH, window.innerHeight - 16) });
    setOpen(true);
  };

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !focusDay) return;
    popRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [open, focusDay]);

  if (!timeZone) {
    return (
      <button type="button" disabled aria-label={ariaLabel} className={cx("inline-flex items-center text-left outline-none", TRIGGER[variant])}>
        <span className="min-w-0 flex-1 truncate">{legacyLabel ?? placeholder}</span>
      </button>
    );
  }

  const today = localDateKey(now, timeZone);
  const lastDay = addDays(today, 365);
  const minMonth = monthKeyOf(draft.day && draft.day < today ? draft.day : today);
  const maxMonth = monthKeyOf(lastDay);
  const grid = month ? monthGridRange(month) : null;
  const days = grid ? Array.from({ length: grid.days }, (_, i) => addDays(grid.start, i)) : [];

  const startOptions = steps(DAY_START, DAY_END - STEP, draft.start);
  const endOptions = steps(draft.start + STEP, Math.min(draft.start + MAX_LENGTH, Math.max(DAY_END, draft.start + STEP)), draft.end).filter(
    (m) => m > draft.start,
  );
  const quick = QUICK.map((q) => ({ ...q, day: addDays(today, q.inDays) })).filter((q) => instant(q.day, q.end, timeZone) > now);
  const picked = draft.day ? { start: instant(draft.day, draft.start, timeZone), end: instant(draft.day, draft.end, timeZone) } : null;

  const setStart = (start: number) => {
    const length = draft.end - draft.start;
    let end = start + (length > 0 && length <= MAX_LENGTH ? length : DEFAULT_LENGTH);
    if (end > DAY_END) end = Math.max(start + STEP, DAY_END);
    setDraft({ ...draft, start, end });
  };

  const pickDay = (day: string) => {
    setDraft({ ...draft, day });
    setFocusDay(day);
  };

  const moveFocus = (delta: number) => {
    const next = addDays(focusDay || today, delta);
    if (next < today || next > lastDay) return;
    setFocusDay(next);
    if (monthKeyOf(next) !== month) setMonth(monthKeyOf(next));
  };

  const onGridKey = (e: KeyboardEvent) => {
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    moveFocus(delta);
  };

  const onPopoverKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation(); // the drawer listens on document too
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const nodes = Array.from(popRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (nodes.length === 0) return;
    const i = nodes.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (i <= 0 ? nodes.length - 1 : i - 1) : i === nodes.length - 1 ? 0 : i + 1;
    e.preventDefault();
    nodes[next]?.focus();
  };

  const navBtn =
    "flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-35 disabled:hover:bg-transparent";
  const timeSelect =
    "h-9 w-full rounded-lg border border-input bg-card px-2 text-[13px] text-foreground outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-label={display ? `${ariaLabel}: ${display}` : ariaLabel}
        disabled={inactive}
        onClick={() => (open ? close(false) : openPicker())}
        className={cx("inline-flex items-center text-left outline-none disabled:cursor-default", TRIGGER[variant])}
      >
        <CalendarClock aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className={cx("min-w-0 flex-1 truncate", !display && "text-muted-foreground")}>{display ?? placeholder}</span>
        {!inactive ? <ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-[#64748b]" /> : null}
      </button>
      {open && coords && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popRef}
              id={dialogId}
              role="dialog"
              aria-label="Choose a time window"
              onKeyDown={onPopoverKey}
              style={{ position: "fixed", left: coords.left, top: coords.top, width: coords.width, maxHeight: coords.maxH }}
              className="z-[90] flex flex-col gap-3 overflow-y-auto rounded-2xl border border-border bg-card p-3 text-foreground shadow-card"
            >
              {quick.length > 0 ? (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick picks">
                  {quick.map((q) => {
                    const on = draft.day === q.day && draft.start === q.start && draft.end === q.end;
                    return (
                      <button
                        key={q.label}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          setDraft({ day: q.day, start: q.start, end: q.end });
                          setMonth(monthKeyOf(q.day));
                          setFocusDay(q.day);
                        }}
                        className={cx(
                          "rounded-full border px-2.5 py-1 text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30",
                          on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {q.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <button type="button" aria-label="Previous month" className={navBtn} disabled={month <= minMonth} onClick={() => setMonth(addMonths(month, -1))}>
                    <ChevronLeft aria-hidden className="h-4 w-4" />
                  </button>
                  <div aria-live="polite" className="text-[13.5px] font-semibold">
                    {month ? monthTitle.format(utcDate(`${month}-01`)) : ""}
                  </div>
                  <button type="button" aria-label="Next month" className={navBtn} disabled={month >= maxMonth} onClick={() => setMonth(addMonths(month, 1))}>
                    <ChevronRight aria-hidden className="h-4 w-4" />
                  </button>
                </div>
                <div role="grid" onKeyDown={onGridKey}>
                  <div role="row" className="grid grid-cols-7">
                    {WEEKDAYS.map((w) => (
                      <div key={w} role="columnheader" className="py-1 text-center text-[11px] font-medium uppercase tracking-wide text-faint">
                        {w}
                      </div>
                    ))}
                  </div>
                  {Array.from({ length: days.length / 7 }, (_, r) => (
                    <div key={r} role="row" className="grid grid-cols-7">
                      {days.slice(r * 7, r * 7 + 7).map((d) => {
                        const isSel = d === draft.day;
                        const isToday = d === today;
                        const off = d < today || d > lastDay;
                        return (
                          <div key={d} role="gridcell" aria-selected={isSel} className="flex justify-center p-0.5">
                            <button
                              type="button"
                              data-day={d}
                              disabled={off}
                              tabIndex={d === focusDay ? 0 : -1}
                              aria-label={dayName.format(utcDate(d))}
                              aria-current={isToday ? "date" : undefined}
                              onClick={() => pickDay(d)}
                              className={cx(
                                "h-8 w-8 rounded-[10px] text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent",
                                isSel
                                  ? "bg-primary font-semibold text-primary-foreground disabled:opacity-60"
                                  : cx("hover:bg-muted", monthKeyOf(d) !== month ? "text-faint" : "text-foreground", isToday && "font-semibold ring-1 ring-primary"),
                              )}
                            >
                              {Number(d.slice(8))}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] font-medium text-muted-foreground">Start</span>
                  <select value={draft.start} onChange={(e) => setStart(Number(e.target.value))} className={timeSelect}>
                    {startOptions.map((m) => (
                      <option key={m} value={m}>
                        {clockText(m)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] font-medium text-muted-foreground">End</span>
                  <select value={draft.end} onChange={(e) => setDraft({ ...draft, end: Number(e.target.value) })} className={timeSelect}>
                    {endOptions.map((m) => (
                      <option key={m} value={m}>
                        {clockText(m)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="rounded-lg bg-muted px-2.5 py-2 text-[12.5px]">
                <div className="font-medium">{picked ? windowLabel(picked.start, picked.end, timeZone, now) : "Pick a day on the calendar."}</div>
                <div className="mt-0.5 text-[11.5px] text-muted-foreground">Times are in {timeZone.replace(/_/g, " ")}.</div>
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-border pt-2.5">
                <button
                  type="button"
                  onClick={() => {
                    onChange?.(null);
                    close();
                  }}
                  className="rounded-md px-1.5 py-1 text-[12.5px] font-medium text-muted-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  No window set
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => close()}
                    className="h-8 rounded-lg border border-border px-3 text-[12.5px] font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!picked}
                    onClick={() => {
                      if (!picked) return;
                      onChange?.(picked);
                      close();
                    }}
                    className="h-8 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
