"use client";

import { useState } from "react";
import { Btn, Modal, Select } from "@/components/ui";
import { toast } from "@/components/toast";

export type DayInput = { day: number; start: string | null; end: string | null };

// Monday first, the way a working week reads. `day` matches Date.getUTCDay() (0 = Sunday).
const WEEK = [
  { day: 1, label: "Monday" },
  { day: 2, label: "Tuesday" },
  { day: 3, label: "Wednesday" },
  { day: 4, label: "Thursday" },
  { day: 5, label: "Friday" },
  { day: 6, label: "Saturday" },
  { day: 0, label: "Sunday" },
];

function label12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

const STEPS: string[] = [];
for (let mins = 6 * 60; mins <= 23 * 60 + 30; mins += 15) {
  STEPS.push(`${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`);
}

/** The standard 15-minute options plus the current value if it falls outside the range. */
function withValue(current: string): string[] {
  return current && !STEPS.includes(current) ? [...STEPS, current].sort() : STEPS;
}

type Row = { start: string; end: string }; // start "" = day off

/**
 * Availability Timings modal: seven rows (Monday to Sunday), start / end in 15-minute steps and
 * an "Off" option per day. Used for the admin editing a manager (assetManagers.setAvailability)
 * and for a manager editing their own hours (tours.saveMyHours) through `onSave`.
 * Mount it conditionally: the form starts from `initial` each time it opens.
 */
export function AvailabilityModal({
  title = "Availability Timings",
  initial,
  continueLabel = "Continue",
  onSave,
  onClose,
}: {
  title?: string;
  /** Any subset of days; days missing or with null times start as Off. */
  initial: DayInput[];
  continueLabel?: string;
  /** Receives only the days that are on. Throw to keep the modal open (message is toasted). */
  onSave: (hours: Array<{ day: number; start: string; end: string }>) => Promise<void>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Record<number, Row>>(() => {
    const out: Record<number, Row> = {};
    for (const { day } of WEEK) {
      const h = initial.find((x) => x.day === day);
      out[day] = h && h.start && h.end ? { start: h.start, end: h.end } : { start: "", end: "" };
    }
    return out;
  });
  const [busy, setBusy] = useState(false);

  const setRow = (day: number, patch: Partial<Row>) => setRows((r) => ({ ...r, [day]: { ...r[day], ...patch } }));

  const setStart = (day: number, value: string) => {
    if (value === "") return setRow(day, { start: "", end: "" });
    const cur = rows[day];
    // Turning a day on (or moving start past end) picks a sensible end.
    const end = cur.end && cur.end > value ? cur.end : (STEPS.find((s) => s > value && s >= addMinutes(value, 60)) ?? STEPS[STEPS.length - 1]);
    setRow(day, { start: value, end });
  };

  const sameTimings = () => {
    const monday = rows[1];
    setRows(Object.fromEntries(WEEK.map(({ day }) => [day, { ...monday }])));
  };

  const errors: Record<number, string> = {};
  for (const { day } of WEEK) {
    const r = rows[day];
    if (r.start && (!r.end || r.end <= r.start)) errors[day] = "End must be after start";
  }
  const anyOn = WEEK.some(({ day }) => rows[day].start);
  const invalid = Object.keys(errors).length > 0 || !anyOn;

  async function submit() {
    if (invalid || busy) return;
    setBusy(true);
    try {
      await onSave(WEEK.filter(({ day }) => rows[day].start).map(({ day }) => ({ day, start: rows[day].start, end: rows[day].end })));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={() => (busy ? undefined : onClose())}
      size="md"
      footer={
        <div className="grid w-full grid-cols-2 gap-3">
          <Btn onClick={onClose} disabled={busy} className="h-11">
            Back
          </Btn>
          <Btn variant="pri" onClick={() => void submit()} disabled={invalid || busy} className="h-11">
            {busy ? "Saving…" : continueLabel}
          </Btn>
        </div>
      }
    >
      <div className="mb-3 flex justify-end">
        <button type="button" onClick={sameTimings} className="text-[13px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring">
          Same timings?
        </button>
      </div>
      <div className="space-y-3">
        {WEEK.map(({ day, label }) => {
          const r = rows[day];
          const off = r.start === "";
          return (
            <div key={day}>
              <div className="grid grid-cols-[84px_1fr_auto_1fr] items-center gap-2.5 sm:grid-cols-[96px_1fr_auto_1fr]">
                <span className="text-[13px] text-muted-foreground">{label}</span>
                <Select aria-label={`${label} start`} value={r.start} onChange={(e) => setStart(day, e.target.value)}>
                  <option value="">Off</option>
                  {withValue(r.start).map((t) => (
                    <option key={t} value={t}>
                      {label12(t)}
                    </option>
                  ))}
                </Select>
                <span className="text-xs text-muted-foreground">to</span>
                {off ? (
                  <Select aria-label={`${label} end`} value="" disabled>
                    <option value="">Off</option>
                  </Select>
                ) : (
                  <Select aria-label={`${label} end`} value={r.end} onChange={(e) => setRow(day, { end: e.target.value })}>
                    {withValue(r.end).map((t) => (
                      <option key={t} value={t}>
                        {label12(t)}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
              {errors[day] ? <p className="mt-1 pl-[96px] text-xs text-danger-ink">{errors[day]}</p> : null}
            </div>
          );
        })}
      </div>
      {!anyOn ? <p className="mt-3 text-xs text-danger-ink">Turn on at least one day.</p> : null}
    </Modal>
  );
}

function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Math.min(23 * 60 + 45, h * 60 + m + mins);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
