"use client";

import { useMutation } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { useToast } from "@/components/toast";
import type { DayHours } from "@/convex/tourSchedule";

// Monday first, the way a working week reads. `day` matches Date.getUTCDay().
const WEEK = [
  { day: 1, label: "Monday" },
  { day: 2, label: "Tuesday" },
  { day: 3, label: "Wednesday" },
  { day: 4, label: "Thursday" },
  { day: 5, label: "Friday" },
  { day: 6, label: "Saturday" },
  { day: 0, label: "Sunday" },
];

const timeInput =
  "h-10 rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/20";

export type TourHours = { availableForTours: boolean; weeklyHours: DayHours[] };

/**
 * The signed-in person's own tour hours. Whether they take tours at all is the Tours switch on
 * the Team page — hours can still be set while it is off, ready for when it goes back on.
 *
 * `saved` is the stored value; edits stay in a local draft until Save, so a save from another
 * tab shows through instead of being overwritten. `confirmUnchanged` lets Save go through with
 * no edits — the first-visit prompt uses it so "these defaults are fine" is an answer.
 */
export function TourHoursEditor({
  saved,
  confirmUnchanged = false,
  onSaved,
}: {
  saved: TourHours;
  confirmUnchanged?: boolean;
  onSaved?: () => void;
}) {
  const saveMyHours = useMutation(api.tours.saveMyHours);
  const toast = useToast();
  const [draft, setDraft] = useState<DayHours[] | null>(null);
  const [busy, setBusy] = useState(false);

  const weeklyHours = draft ?? saved.weeklyHours;
  const hoursFor = (day: number) => weeklyHours.find((h) => h.day === day);

  const setDay = (day: number, patch: Partial<DayHours> | null) => {
    const others = weeklyHours.filter((h) => h.day !== day);
    const existing = hoursFor(day) ?? { day, start: "09:00", end: "17:00" };
    setDraft(patch === null ? others : [...others, { ...existing, ...patch }]);
  };

  const save = async () => {
    setBusy(true);
    try {
      await saveMyHours({ weeklyHours });
      setDraft(null);
      toast("Tour hours saved");
      onSaved?.();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save your hours.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {!saved.availableForTours ? (
        <p className="mb-4 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Your tours are switched off, so Sarah will not book you. You can still set your hours; switch tours
          back on from the{" "}
          <Link href="/team" className="font-medium text-foreground underline">
            Team page
          </Link>
          .
        </p>
      ) : null}

      <div className="space-y-2">
        {WEEK.map(({ day, label }) => {
          const hours = hoursFor(day);
          return (
            <div key={day} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border px-3 py-2">
              <label className="flex w-28 items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={Boolean(hours)}
                  onChange={(e) => setDay(day, e.target.checked ? {} : null)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="text-sm">{label}</span>
              </label>
              {hours ? (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    step={1800}
                    value={hours.start}
                    onChange={(e) => setDay(day, { start: e.target.value })}
                    className={timeInput}
                    aria-label={`${label} start`}
                  />
                  <span className="text-sm text-muted-foreground">to</span>
                  <input
                    type="time"
                    step={1800}
                    value={hours.end}
                    onChange={(e) => setDay(day, { end: e.target.value })}
                    className={timeInput}
                    aria-label={`${label} end`}
                  />
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Day off</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={busy || (draft === null && !confirmUnchanged)}
          className="h-11 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
        >
          {busy ? "Saving…" : draft === null && confirmUnchanged ? "Keep these hours" : "Save hours"}
        </button>
        <span className="text-xs text-muted-foreground">
          Tours fit fully inside these hours, and anything busy in your calendar is avoided automatically.
        </span>
      </div>
    </div>
  );
}
