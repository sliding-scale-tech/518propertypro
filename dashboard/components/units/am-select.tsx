"use client";

import type { Id } from "@/convex/_generated/dataModel";
import { inputClass, type Manager } from "./types";

export function AmSelect({
  managers,
  value,
  onChange,
  disabled,
  label,
  placeholder,
  compact,
}: {
  managers: Manager[];
  value: string;
  onChange: (userId: Id<"users">) => void;
  disabled?: boolean;
  label: string;
  placeholder?: string;
  compact?: boolean;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => e.target.value && onChange(e.target.value as Id<"users">)}
      className={`${inputClass} ${compact ? "h-9 min-w-40" : ""}`}
    >
      {placeholder ? (
        <option value="" disabled>
          {placeholder}
        </option>
      ) : null}
      {managers.map((m) => (
        <option key={m.userId} value={m.userId}>
          {m.name}
        </option>
      ))}
    </select>
  );
}
