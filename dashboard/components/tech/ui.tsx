"use client";

/**
 * Technician-only primitives, styled to the Figma technician screens. These are deliberately
 * separate from components/ui/* (shared with the admin pages) so the two can drift apart.
 */

import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ---------- Typography ---------- */

export function TechPageTitle({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="break-words text-[26px] font-bold leading-[38px]">{title}</h1>
      {subtitle ? <p className="break-words text-sm text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}

export function TechHeading({ children }: { children: ReactNode }) {
  return <h2 className="text-base font-semibold">{children}</h2>;
}

/* ---------- Card ---------- */

export function TechCard({ children, className, as: Tag = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "li" }) {
  return <Tag className={cx("flex flex-col gap-4 rounded-xl border border-border bg-card p-5", className)}>{children}</Tag>;
}

/* ---------- Buttons ---------- */

type Variant = "primary" | "secondary";

export function techBtnCls(variant: Variant = "secondary", extra?: string): string {
  return cx(
    "inline-flex h-11 w-full items-center justify-center gap-2 rounded-[8px] px-4 text-sm font-medium transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "aria-disabled:pointer-events-none aria-disabled:opacity-50 disabled:cursor-not-allowed disabled:opacity-50",
    variant === "primary"
      ? "bg-primary text-white hover:bg-primary/90"
      : "border border-border bg-card text-foreground hover:bg-muted",
    extra,
  );
}

type BtnProps = {
  variant?: Variant;
  loading?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">;

export function TechButton({ variant = "secondary", loading, disabled, className, children, type = "button", ...rest }: BtnProps) {
  return (
    <button type={type} disabled={disabled || loading} className={techBtnCls(variant, className)} {...rest}>
      {loading ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

export function TechLinkButton({
  href,
  variant = "secondary",
  children,
  className,
}: {
  href: string;
  variant?: Variant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={techBtnCls(variant, className)}>
      {children}
    </Link>
  );
}

/* ---------- Badge ---------- */

export type BadgeTone = "info" | "success" | "danger" | "neutral" | "warning";

const BADGE_TONE: Record<BadgeTone, string> = {
  info: "bg-accent text-primary",
  success: "bg-success-soft text-success-ink",
  danger: "bg-danger-soft text-danger-ink",
  neutral: "bg-muted text-muted-foreground",
  warning: "bg-warning-soft text-warning-ink",
};

export function TechBadge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-[8px] px-2.5 text-xs font-medium", BADGE_TONE[tone], className)}>
      {children}
    </span>
  );
}

/** Priority badge: emergency/urgent read as danger, routine as neutral. Real level names kept. */
export function PriorityBadge({ level }: { level: string }) {
  const label = level === "emergency" ? "Emergency" : level === "urgent" ? "Urgent" : level === "routine" ? "Routine" : level;
  return <TechBadge tone={level === "emergency" || level === "urgent" ? "danger" : "neutral"}>{label}</TechBadge>;
}

/* ---------- Fields ---------- */

export function techInputCls(invalid?: boolean, extra?: string): string {
  return cx(
    "w-full rounded-[8px] border bg-card px-3 py-3.5 text-sm outline-none placeholder:text-muted-foreground-subtle",
    "min-h-11 focus:border-ring disabled:opacity-50",
    invalid ? "border-danger-ink" : "border-border",
    extra,
  );
}

export function TechField({
  label,
  htmlFor,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-2 block text-xs text-muted-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-danger-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ---------- Callout ---------- */

export type CalloutTone = "info" | "success" | "danger" | "warning";

const CALLOUT_TONE: Record<CalloutTone, string> = {
  info: "bg-accent text-primary",
  success: "bg-success-soft text-success-ink",
  danger: "bg-danger-soft text-danger-ink",
  warning: "bg-warning-soft text-warning-ink",
};

export function TechCallout({
  tone = "info",
  title,
  icon,
  children,
  role,
}: {
  tone?: CalloutTone;
  title?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div role={role} className={cx("rounded-[8px] p-4", CALLOUT_TONE[tone])}>
      {title ? (
        <p className="flex items-start gap-2 text-sm font-medium">
          {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
          <span className="min-w-0 break-words">{title}</span>
        </p>
      ) : null}
      {children ? <div className={cx("text-xs", title ? "mt-1" : undefined)}>{children}</div> : null}
    </div>
  );
}

/* ---------- Segmented toggle ---------- */

export function TechSeg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-2 gap-1 rounded-[8px] bg-muted p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cx(
              "h-11 rounded-[6px] text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              on ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Summary row (label over value) ---------- */

export function TechRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-medium">{value}</p>
    </div>
  );
}
