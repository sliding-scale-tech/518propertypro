"use client";

import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cx } from "./cx";

export type BtnVariant = "default" | "pri" | "ok" | "dng";

const BTN_VARIANT: Record<BtnVariant, string> = {
  default: "border-border bg-card text-foreground hover:bg-muted",
  pri: "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
  ok: "border-success-ink bg-success-ink text-white hover:opacity-90",
  dng: "border-border bg-card text-danger-ink hover:bg-danger-soft",
};

export function Btn({
  variant = "default",
  sm = false,
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; sm?: boolean }) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 border font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45",
        sm ? "rounded-[10px] px-2.5 py-[5px] text-[12.5px]" : "rounded-xl px-3.5 py-2 text-[13.5px]",
        BTN_VARIANT[variant],
        className,
      )}
      {...rest}
    />
  );
}

/** Square icon-only button; `label` is the required accessible name. */
export function IconBtn({
  label,
  className,
  children,
  type = "button",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & { label: string }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-border bg-card text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:h-4 [&_svg]:w-4",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export type SegOption<T extends string> = { value: T; label: ReactNode };

/** Segmented control (tabs-like). */
export function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: SegOption<T>[];
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-xl bg-muted p-[3px]">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cx(
              "rounded-[9px] px-3 py-1.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              on ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Pill-shaped filter chips; the active one is filled dark. */
export function Chips<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: SegOption<T>[];
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cx(
              "rounded-full border px-3 py-1 text-[12.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              on
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** On/off switch. Needs an accessible name via `label`. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45",
        checked ? "bg-primary" : "bg-border-strong",
      )}
    >
      <span
        aria-hidden
        className={cx(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left]",
          checked ? "left-[18px]" : "left-0.5",
        )}
      />
    </button>
  );
}

const CONTROL =
  "w-full rounded-xl border border-input bg-card px-[11px] py-2 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-faint focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60";

/** Label + control wrapper. Pass the control as children (Input / Select / Textarea). */
export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-[5px]", className)}>
      <label htmlFor={htmlFor} className="text-[12.5px] font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Convenience: a Field with an auto-generated id wired to its control via render prop. */
export function LabeledField({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  className?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      {children(id)}
    </Field>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(CONTROL, className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(CONTROL, "min-h-[84px] resize-y leading-[1.45]", className)} {...rest} />;
}
