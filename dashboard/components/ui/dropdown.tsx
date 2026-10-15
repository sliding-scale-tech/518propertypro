"use client";

import type { ReactNode } from "react";
import { Listbox } from "./select";

/** Options-array wrapper over the design-system listbox (see select.tsx). */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  buttonClassName,
  disabled,
  placeholder,
  "aria-label": ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string; sublabel?: string; icon?: ReactNode; disabled?: boolean }>;
  onChange: (value: T) => void;
  buttonClassName?: string;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
}) {
  return (
    <Listbox
      value={value}
      options={options}
      onValueChange={(v) => onChange(v as T)}
      className={buttonClassName}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
    />
  );
}
