import type { ReactNode } from "react";
import { cx } from "./cx";

export function Card({
  children,
  className,
  accentLine = false,
}: {
  children: ReactNode;
  className?: string;
  accentLine?: boolean;
}) {
  return (
    <section
      className={cx(
        "rounded-[20px] border bg-card px-[22px] py-5 text-card-foreground",
        accentLine ? "border-accent-line" : "border-border",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** Card heading row: icon + title on the left, `right` (link, hint, count) pushed to the end. */
export function CardHead({
  title,
  icon,
  right,
  hint,
  badge,
}: {
  title: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  hint?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <>
      <div className={cx("flex flex-wrap items-center gap-2.5", hint ? "mb-1.5" : "mb-3.5")}>
        <h3 className="flex items-center gap-2 text-[15px] font-semibold [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-muted-foreground">
          {icon}
          {title}
        </h3>
        {badge}
        {right ? <div className="ml-auto text-[13px] text-muted-foreground">{right}</div> : null}
      </div>
      {hint ? <p className="mb-3.5 text-[12.5px] text-muted-foreground">{hint}</p> : null}
    </>
  );
}

export function Kpi({
  label,
  value,
  sub,
  subTone = "muted",
  icon,
  progress,
  onClick,
  active,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  subTone?: "muted" | "up" | "down";
  icon?: ReactNode;
  /** 0..1 fills the progress bar. */
  progress?: number;
  /** Makes the card a button (e.g. to apply a filter). */
  onClick?: () => void;
  /** With `onClick`: marks the card as the one currently applied. */
  active?: boolean;
}) {
  const pct = progress === undefined ? undefined : Math.max(0, Math.min(1, progress)) * 100;
  const box = "flex flex-col gap-0.5 rounded-[18px] border bg-card px-4 py-3.5";
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-semibold tracking-[-0.01em] tabular-nums">{value}</div>
      {pct !== undefined ? (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          aria-label={label}
          className="my-1 h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {sub ? (
        <div
          className={cx(
            "text-xs",
            subTone === "up" && "text-success-ink",
            subTone === "down" && "text-danger-ink",
            subTone === "muted" && "text-muted-foreground",
          )}
        >
          {sub}
        </div>
      ) : null}
    </>
  );
  if (!onClick) return <div className={cx(box, "border-border")}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active ?? false}
      className={cx(
        box,
        "text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        active ? "border-primary bg-accent/60" : "border-border hover:bg-muted/50",
      )}
    >
      {body}
    </button>
  );
}

/** Auto-fit KPI grid wrapper. */
export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">{children}</div>;
}

/** Two-up responsive grid (cards side by side once there is room for 300px each). */
export function Grid2({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-5">{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-start gap-4">
      <div className="min-w-[240px] flex-1">
        {eyebrow ? (
          <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.07em] text-primary">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-balance text-[30px] font-bold leading-[1.2] tracking-[-0.02em]">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-[640px] text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
