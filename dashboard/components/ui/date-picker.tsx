"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";

const TRIGGER =
  "flex w-full items-center gap-2 rounded-xl border border-input bg-card px-[11px] py-2 text-left text-[13.5px] text-foreground outline-none transition-colors focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sameDay = (a: Date, b: Date) => toISO(a) === toISO(b);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Parses "YYYY-MM-DD" as a LOCAL date (never via Date(string), which is UTC). */
function parseISO(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) || toISO(d) !== value ? null : d;
}

/** Moves by whole months, clamping the day (Jan 31 + 1 month -> Feb 28/29). */
function addMonths(d: Date, n: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last));
}

const POPOVER_W = 296;
const POPOVER_H = 372;

type Coords = { left: number; top?: number; bottom?: number };

/**
 * Design-system date picker: input-styled trigger + portalled calendar popover (flips upward
 * near the viewport bottom, like Listbox). Value is a "YYYY-MM-DD" string, "" when empty.
 */
export function DatePicker({
  value,
  onChange,
  id,
  name,
  disabled,
  placeholder = "Pick a date",
  min,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Earliest selectable day, "YYYY-MM-DD". */
  min?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const autoId = useId();
  const baseId = id ?? autoId;
  const dialogId = `${baseId}-dialog`;
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [focused, setFocused] = useState<Date>(() => new Date());
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const selected = value ? parseISO(value) : null;
  const today = new Date();

  const openPicker = useCallback(() => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect || disabled) return;
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const up = below < POPOVER_H && above > below;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_W - 8));
    setCoords(up ? { left, bottom: window.innerHeight - rect.top + 4 } : { left, top: rect.bottom + 4 });
    setFocused(parseISO(value) ?? new Date());
    setOpen(true);
  }, [disabled, value]);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }, []);

  const pick = (d: Date) => {
    if (min && toISO(d) < min) return;
    onChange(toISO(d));
    close();
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

  // Keep real DOM focus on the active day so the grid is keyboard-driven.
  useEffect(() => {
    if (!open) return;
    popRef.current?.querySelector<HTMLButtonElement>(`[data-day="${toISO(focused)}"]`)?.focus();
  }, [open, focused]);

  const onGridKey = (e: React.KeyboardEvent) => {
    let next: Date | null = null;
    switch (e.key) {
      case "ArrowLeft": next = addDays(focused, -1); break;
      case "ArrowRight": next = addDays(focused, 1); break;
      case "ArrowUp": next = addDays(focused, -7); break;
      case "ArrowDown": next = addDays(focused, 7); break;
      case "PageUp": next = addMonths(focused, -1); break;
      case "PageDown": next = addMonths(focused, 1); break;
      case "Home": next = addDays(focused, -focused.getDay()); break;
      case "End": next = addDays(focused, 6 - focused.getDay()); break;
      case "Enter":
      case " ":
        e.preventDefault();
        pick(focused);
        return;
      case "Escape":
        e.preventDefault();
        e.stopPropagation(); // don't also close a parent modal
        close();
        return;
      case "Tab":
        setOpen(false);
        return;
      default:
        return;
    }
    e.preventDefault();
    setFocused(next);
  };

  // 6 rows x 7 cols starting from the Sunday on/before the 1st of the shown month.
  const first = new Date(focused.getFullYear(), focused.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  const display = selected
    ? selected.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "";
  const navBtn =
    "flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30";

  return (
    <>
      <button
        ref={btnRef}
        id={baseId}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close(false) : openPicker())}
        className={cx(TRIGGER, className)}
      >
        <CalendarIcon aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className={cx("min-w-0 flex-1 truncate", !display && "text-faint")}>{display || placeholder}</span>
      </button>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      {typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {open && coords ? (
                <motion.div
                  key="datepicker"
                  ref={popRef}
                  id={dialogId}
                  role="dialog"
                  aria-label="Choose date"
                  initial={{ opacity: 0, y: coords.bottom !== undefined ? 4 : -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  style={{ position: "fixed", top: coords.top, bottom: coords.bottom, left: coords.left, width: POPOVER_W }}
                  className="z-[90] rounded-2xl border border-border bg-card p-3 shadow-card"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <button
                      type="button"
                      aria-label="Previous month"
                      className={navBtn}
                      onClick={() => setFocused(addMonths(focused, -1))}
                    >
                      <ChevronLeft aria-hidden className="h-4 w-4" />
                    </button>
                    <div aria-live="polite" className="text-[13.5px] font-semibold text-foreground">
                      {MONTHS[focused.getMonth()]} {focused.getFullYear()}
                    </div>
                    <button
                      type="button"
                      aria-label="Next month"
                      className={navBtn}
                      onClick={() => setFocused(addMonths(focused, 1))}
                    >
                      <ChevronRight aria-hidden className="h-4 w-4" />
                    </button>
                  </div>
                  <div role="grid" aria-label={`${MONTHS[focused.getMonth()]} ${focused.getFullYear()}`} onKeyDown={onGridKey}>
                    <div role="row" className="grid grid-cols-7">
                      {WEEKDAYS.map((w) => (
                        <div
                          key={w}
                          role="columnheader"
                          className="py-1 text-center text-[11.5px] font-medium uppercase tracking-wide text-faint"
                        >
                          {w}
                        </div>
                      ))}
                    </div>
                    {Array.from({ length: 6 }, (_, r) => (
                      <div key={r} role="row" className="grid grid-cols-7">
                        {days.slice(r * 7, r * 7 + 7).map((d) => {
                          const iso = toISO(d);
                          const isSel = !!selected && sameDay(d, selected);
                          const isToday = sameDay(d, today);
                          const outside = d.getMonth() !== focused.getMonth();
                          return (
                            <div key={iso} role="gridcell" aria-selected={isSel} className="flex justify-center p-0.5">
                              <button
                                type="button"
                                data-day={iso}
                                disabled={!!min && iso < min}
                                tabIndex={sameDay(d, focused) ? 0 : -1}
                                aria-label={d.toLocaleDateString("en-US", {
                                  weekday: "long",
                                  month: "long",
                                  day: "numeric",
                                  year: "numeric",
                                })}
                                aria-current={isToday ? "date" : undefined}
                                onClick={() => pick(d)}
                                className={cx(
                                  "h-8 w-8 rounded-[10px] text-[13px] outline-none disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
                                  isSel
                                    ? "bg-primary font-semibold text-primary-foreground"
                                    : cx(
                                        "hover:bg-muted",
                                        outside ? "text-faint" : "text-foreground",
                                        isToday && "ring-1 ring-primary",
                                      ),
                                )}
                              >
                                {d.getDate()}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[12.5px] font-medium">
                    <button
                      type="button"
                      onClick={() => pick(new Date())}
                      className="rounded-md px-1.5 py-1 text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onChange("");
                        close();
                      }}
                      className="rounded-md px-1.5 py-1 text-muted-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
                    >
                      Clear
                    </button>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}
