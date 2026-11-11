"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { cx, Input } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { serverError } from "@/lib/form-errors";

/**
 * Shared form plumbing for the owner-statement (finance) screens, spec 6 "Form rules":
 * every failing field gets aria-invalid, a red border (`border-danger-ink`) and a message under it;
 * the first message is toasted and its field focused. Server errors go through serverError().
 */

/** Red border on an invalid control. `!` because the kit's controls set their own border colour. */
export const INVALID = "border-danger-ink !border-danger-ink";

export type FieldErrors = Record<string, string>;

export function FieldError({ id, message }: { id: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-danger-ink">
      {message}
    </p>
  );
}

/** Spinner for a loading card or page. */
export function Spinner({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cx("flex items-center justify-center gap-2 py-10 text-[13px] text-muted-foreground", className)}>
      <Loader2 aria-hidden className="h-5 w-5 animate-spin text-primary" />
      <span>{label}</span>
    </div>
  );
}

/** Focus a control by id (after the error state renders). */
export function focusId(id: string | undefined) {
  if (!id) return;
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (el) el.focus();
  });
}

/**
 * Field-error state for one form. `ids` maps a server field name to the control's DOM id.
 * - `check(all, order)`: client validation result (field -> message). Marks every field, toasts the
 *   first in `order`, focuses it. Returns true when the form is clean.
 * - `fromServer(e, known)`: a caught mutation error. Toasts the message; marks and focuses the field
 *   when the server named one this form shows.
 */
export function useFieldErrors(ids: Record<string, string>) {
  const [errors, setErrors] = useState<FieldErrors>({});

  const clear = useCallback((field: string) => {
    setErrors((e) => {
      if (!e[field]) return e;
      const next = { ...e };
      delete next[field];
      return next;
    });
  }, []);

  const check = useCallback(
    (all: FieldErrors, order: readonly string[]): boolean => {
      setErrors(all);
      const first = order.find((k) => all[k]) ?? Object.keys(all)[0];
      if (!first) return true;
      toast.error(all[first]);
      focusId(ids[first]);
      return false;
    },
    [ids],
  );

  const fromServer = useCallback(
    (e: unknown) => {
      const err = serverError(e);
      toast.error(err.message);
      if (err.field && ids[err.field]) {
        setErrors((prev) => ({ ...prev, [err.field as string]: err.message }));
        focusId(ids[err.field]);
      }
    },
    [ids],
  );

  /** Props for a control: aria-invalid, aria-describedby and the red border class. */
  const control = (field: string, className?: string) => ({
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? `${ids[field]}-err` : undefined,
    className: cx(className, errors[field] && INVALID),
  });

  const message = (field: string): ReactNode => <FieldError id={`${ids[field]}-err`} message={errors[field]} />;

  return { errors, setErrors, clear, check, fromServer, control, message };
}

/** A money text input with a `$` prefix (spec 6: inputMode decimal, parsed with parseDollarsToCents). */
export function MoneyInput({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  disabled,
  placeholder = "0.00",
  ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className="pointer-events-none absolute left-[11px] top-1/2 -translate-y-1/2 text-[13.5px] text-muted-foreground"
      >
        $
      </span>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cx("!pl-6 tabular-nums", invalid && INVALID)}
      />
    </div>
  );
}

/** Cents -> the text a money input starts with ("1250.00", "-12.00"); "" when not set. */
export function centsToInput(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isSafeInteger(cents)) return "";
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

/** Native checkbox styled for the kit. */
export function Checkbox({
  id,
  checked,
  onChange,
  disabled,
  invalid,
  describedBy,
}: {
  id?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.checked)}
      className={cx(
        "mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border-strong accent-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50",
        invalid && "outline outline-2 outline-danger-ink",
      )}
    />
  );
}

/** A link that looks like a small kit Btn (avoids nesting a <button> inside an <a>). */
export function LinkBtn({
  href,
  children,
  primary = false,
  className,
}: {
  href: string;
  children: ReactNode;
  primary?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-[10px] border px-2.5 py-[5px] text-[12.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        primary
          ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
          : "border-border bg-card text-foreground hover:bg-muted",
        className,
      )}
    >
      {children}
    </Link>
  );
}
