"use client";

import { Chips, Input } from "@/components/ui";

/** Appointment-window presets offered to Pat; free text is always allowed (server caps it at 100 chars). */
export const WINDOW_PRESETS = ["Today, 1–3 PM", "Today, 3–5 PM", "Tomorrow, 9–11 AM", "Tomorrow, 1–3 PM"] as const;

/** Time window picker: preset chips plus a free-text box that holds the actual value. */
export function WindowField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const preset = (WINDOW_PRESETS as readonly string[]).includes(value) ? value : "";
  return (
    <div className="space-y-2">
      <fieldset disabled={disabled} className="border-0 p-0">
        <Chips
          label="Time window presets"
          value={preset}
          onChange={(next) => onChange(next === value ? "" : next)}
          options={WINDOW_PRESETS.map((w) => ({ value: w as string, label: w }))}
        />
      </fieldset>
      <Input
        value={value}
        maxLength={100}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Or type a window, e.g. Friday 10 AM–12 PM"
        aria-label="Time window"
      />
    </div>
  );
}
